import { getQuotaWindowsForAuth } from "@paperclipai/adapter-codex-local/server";
import type { Db } from "@paperclipai/db";
import type { ProviderQuotaResult } from "@paperclipai/shared";
import { listServerAdapters } from "../adapters/registry.js";
import { aiConnectionService } from "./ai-connections.js";

const QUOTA_PROVIDER_TIMEOUT_MS = 20_000;

function providerSlugForAdapterType(type: string): string {
  switch (type) {
    case "claude_local":
      return "anthropic";
    case "codex_local":
      return "openai";
    default:
      return type;
  }
}

/**
 * Asks each registered adapter for its provider quota windows and aggregates the results.
 * Adapters that don't implement getQuotaWindows() are silently skipped.
 * Individual adapter failures are caught and returned as error results rather than
 * letting one provider's outage block the entire response.
 */
export async function fetchAllQuotaWindows(): Promise<ProviderQuotaResult[]> {
  const adapters = listServerAdapters().filter((a) => a.getQuotaWindows != null);

  const settled = await Promise.allSettled(
    adapters.map((adapter) => withQuotaTimeout(adapter.type, adapter.getQuotaWindows!())),
  );

  return settled.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    const adapterType = adapters[i]!.type;
    return {
      provider: providerSlugForAdapterType(adapterType),
      ok: false,
      error: String(result.reason),
      windows: [],
    };
  });
}

type AccountQuotaResult = { name: string; result: ProviderQuotaResult };

/**
 * The Costs page shows one quota result per provider, so the accounts of one provider are folded into one
 * result: windows of several successful accounts are labelled with the account name, and when none succeeds
 * the errors of all of them are kept.
 */
function foldAccountQuotas(accounts: AccountQuotaResult[]): ProviderQuotaResult {
  const ok = accounts.filter((account) => account.result.ok);
  if (ok.length === 1) return ok[0]!.result;
  if (ok.length > 1) {
    return {
      ...ok[0]!.result,
      windows: ok.flatMap(({ name, result }) =>
        result.windows.map((window) => ({ ...window, label: `${name} · ${window.label}` })),
      ),
    };
  }
  if (accounts.length === 1) return accounts[0]!.result;
  return {
    ...accounts[0]!.result,
    error: accounts.map(({ name, result }) => `${name}: ${result.error ?? "unavailable"}`).join("; "),
  };
}

/**
 * Adds the quota of the managed OpenAI subscription accounts the user may use in this company. Agents on
 * managed AI connections have no login in the server's own Codex home, so the local probe fails for them.
 */
export async function fetchCompanyQuotaWindows(
  db: Db,
  companyId: string,
  userId: string,
): Promise<ProviderQuotaResult[]> {
  const [local, accounts] = await Promise.all([
    fetchAllQuotaWindows(),
    aiConnectionService(db).subscriptionCredentials(companyId, userId, "openai"),
  ]);
  const managed = await Promise.all(
    accounts.map(async (account): Promise<AccountQuotaResult> => ({
      name: account.name,
      result: await withQuotaTimeout(
        "codex_local",
        account.value().then(getQuotaWindowsForAuth, (error: unknown) => ({
          provider: "openai",
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          windows: [],
        })),
      ),
    })),
  );
  if (managed.length === 0) return local;
  const openai = [
    ...local.filter((r) => r.provider === "openai").map((result) => ({ name: "Local Codex login", result })),
    ...managed,
  ];
  return [...local.filter((r) => r.provider !== "openai"), foldAccountQuotas(openai)];
}

async function withQuotaTimeout(
  adapterType: string,
  task: Promise<ProviderQuotaResult>,
): Promise<ProviderQuotaResult> {
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<ProviderQuotaResult>((resolve) => {
        timeoutId = setTimeout(() => {
          resolve({
            provider: providerSlugForAdapterType(adapterType),
            ok: false,
            error: `quota polling timed out after ${Math.round(QUOTA_PROVIDER_TIMEOUT_MS / 1000)}s`,
            windows: [],
          });
        }, QUOTA_PROVIDER_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
