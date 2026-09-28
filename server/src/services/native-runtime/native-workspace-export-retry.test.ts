import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { agents, companies, completionContracts, createDb, environmentLeases, environments, heartbeatRuns, issues, issueRecoveryActions, nativeRunFinalizations, nativeRunResults, agentWakeupRequests, activityLog } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { remoteTerminationReceipt } from "../remote-execution-termination.js";
import { withNativeWorkspaceFinalizationOwnership } from "./native-workspace-finalization-ownership.js";
const probe = vi.hoisted(() => vi.fn());
vi.mock("../environment-execution-target.js", () => ({ resolveEnvironmentExecutionTarget: async () => ({ kind: "remote", transport: "sandbox", remoteCwd: "/work", runner: { execute: probe } }) }));
import { restoreNativeWorkspaceExportRepairs } from "./native-workspace-export-recovery.js";
import { recordNativeFinalizationFailure } from "./native-run-finalizer.js";
import { recoveryService } from "../recovery/service.js";
import { retryNativeWorkspaceExport } from "./native-workspace-export-retry.js";

describe("board retry of accepted workspace export", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  const companyId = randomUUID(), agentId = randomUUID(), environmentId = randomUUID();
  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("workspace-export-retry-"); db = createDb(temporary.connectionString);
    await db.insert(companies).values({ id: companyId, name: "Export repair", issuePrefix: "EXP" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Exporter", adapterType: "paperclip_runner" });
    await db.insert(environments).values({ id: environmentId, name: `Retained ${environmentId}`, driver: "sandbox" });
  }, 30_000);
  afterAll(async () => { await temporary.cleanup(); });
  async function seed() {
    probe.mockReset().mockResolvedValue({ exitCode: 0, timedOut: false });
    const issueId = randomUUID(), runId = randomUUID(), resultId = randomUUID(), contractId = randomUUID(), leaseId = randomUUID(), actionId = randomUUID(), providerLeaseId = randomUUID();
    await db.insert(issues).values({ id: issueId, companyId, title: "Preserve accepted work", status: "blocked", assigneeAgentId: agentId });
    await db.insert(completionContracts).values({ id: contractId, companyId, issueId, revision: 1, schemaVersion: "paperclip.completion-contract.v1", policyVersion: "test", risk: "standard", completionAuthority: "server_arbiter", incompleteCriteriaPolicy: "preserve_non_terminal", contractJson: { objective: "Preserve accepted work" }, canonicalSha256: contractId, createdByActorType: "system", createdByActorId: "test" });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status: "failed", runtimeMode: "native", nativeIssueId: issueId, nativePhase: "terminal_failure", completionContractId: contractId,
      runnerProfileJson: { nativeWorkspaceSync: { schema: "paperclip.native-workspace-sync/v1", state: "prepared", descriptorSha256: "a".repeat(64), baselineSha256: "b".repeat(64), finalHostSha256: null, workspaceId: randomUUID(), leaseId, providerLeaseId, remoteCwd: "/work", resourceDisposition: "keep_running" } } });
    await db.insert(nativeRunResults).values({ id: resultId, companyId, issueId, runId, completionContractId: contractId, serverFingerprint: resultId, schemaStatus: "accepted", resultJson: { work: "already finished" }, canonicalSha256: resultId });
    await db.insert(nativeRunFinalizations).values({ runId, companyId, issueId, phase: "terminal_failure", resultId, failureCode: "native_workspace_sync_out_unsafe_archive", failureDetail: { workspaceFinalizeAttempt: 1 } });
    const identity = { id: leaseId, companyId, heartbeatRunId: runId, provider: "daytona", providerLeaseId };
    await db.insert(environmentLeases).values({ ...identity, environmentId, issueId, status: "released", releasedAt: new Date(), cleanupStatus: "success", leasePolicy: "reuse_by_environment", metadata: { remoteExecutionTermination: remoteTerminationReceipt(identity, { providerLeaseId, state: "stopped" }) } });
    await db.insert(issueRecoveryActions).values({ id: actionId, companyId, sourceIssueId: issueId, kind: "active_run_watchdog", ownerType: "board", returnOwnerAgentId: agentId, cause: "native_workspace_sync_out_unsafe_archive", fingerprint: runId, evidence: { runId }, nextAction: "Repair saved files" });
    const request = { db, companyId, issueId, actionId, runId, actorId: "board", repairNote: "Removed only the known unsafe fixture link and preserved the saved work.", environmentRuntime: {} as never };
    return { ...request, request, resultId, leaseId };
  }
  it("queues only the existing result and lease, audits once, and deduplicates a pending click", async () => {
    const f = await seed();
    const accepted = await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, f.runId));
    expect(await retryNativeWorkspaceExport(f.request)).toMatchObject({ runId: f.runId, resultId: f.resultId, leaseId: f.leaseId, status: "queued" });
    await retryNativeWorkspaceExport(f.request);
    expect(probe).toHaveBeenCalledOnce();
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ args: ["-c", "true"], bypassSession: true }));
    expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, f.runId))).toEqual(accepted);
    expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, companyId))).toHaveLength(0);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.nativeIssueId, f.issueId))).toHaveLength(1);
    expect((await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, f.runId)))[0]).toMatchObject({ phase: "result_accepted", resultId: f.resultId, nextAttemptAt: null });
    expect((await db.select().from(environmentLeases).where(eq(environmentLeases.id, f.leaseId)))[0]).toMatchObject({ status: "active", releasedAt: null });
    expect(await db.select().from(activityLog).where(eq(activityLog.entityId, f.issueId))).toHaveLength(1);
  });
  it("fences an old failure whose transaction arrives after explicit repair admission", async () => {
    const f = await seed();
    let release!: () => void, captured!: () => void;
    const ready = new Promise<void>(resolve => { captured = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const transaction = db.transaction.bind(db);
    const interception = vi.spyOn(db, "transaction").mockImplementationOnce(async (...args) => {
      captured(); await wait; return transaction(...args);
    });
    const lateFailure = recordNativeFinalizationFailure({ db, runId: f.runId,
      error: new Error("native_workspace_sync_out_failed"), failureScope: "workspace", projectRunStatus: true });
    await ready;
    try { await retryNativeWorkspaceExport(f.request); } finally { release(); }
    await lateFailure; interception.mockRestore();
    expect((await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, f.runId)))[0]).toMatchObject({ phase: "result_accepted", failureCode: null, nextAttemptAt: null });
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId)))[0]).toMatchObject({ status: "running", nativePhase: "result_accepted" });
  });
  it.each(["foreign_company", "missing_result", "newer_run", "lease_rebound", "other_lease", "unconfirmed_stop", "destroyed"])("rejects %s before probing or changing finalization", async (kind) => {
    const f = await seed();
    if (kind === "foreign_company") f.request.companyId = randomUUID();
    if (kind === "missing_result") await db.update(nativeRunFinalizations).set({ resultId: null }).where(eq(nativeRunFinalizations.runId, f.runId));
    if (kind === "newer_run") await db.insert(heartbeatRuns).values({ companyId, agentId, nativeIssueId: f.issueId, status: "failed", createdAt: new Date(Date.now() + 1000) });
    if (kind === "other_lease") {
      const [lease] = await db.select().from(environmentLeases).where(eq(environmentLeases.id, f.leaseId));
      await db.insert(environmentLeases).values({ companyId, environmentId, issueId: f.issueId, status: "active", provider: lease.provider, providerLeaseId: lease.providerLeaseId });
    }
    if (kind === "lease_rebound") await db.update(environmentLeases).set({ heartbeatRunId: null }).where(eq(environmentLeases.id, f.leaseId));
    if (kind === "unconfirmed_stop" || kind === "destroyed") {
      const [lease] = await db.select().from(environmentLeases).where(eq(environmentLeases.id, f.leaseId));
      await db.update(environmentLeases).set({ metadata: kind === "unconfirmed_stop" ? {} : { remoteExecutionTermination: remoteTerminationReceipt(lease, { providerLeaseId: lease.providerLeaseId, state: "destroyed" }) } }).where(eq(environmentLeases.id, f.leaseId));
    }
    await expect(retryNativeWorkspaceExport(f.request)).rejects.toThrow();
    expect(probe).not.toHaveBeenCalled();
    expect((await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, f.runId)))[0].phase).toBe("terminal_failure");
  });
  it("leaves repair intact when the exact sandbox is not running", async () => {
    const f = await seed(); probe.mockRejectedValueOnce(new Error("stopped"));
    await expect(retryNativeWorkspaceExport(f.request)).rejects.toThrow("Resume and repair");
    expect((await db.select().from(environmentLeases).where(eq(environmentLeases.id, f.leaseId)))[0].status).toBe("released");
    expect((await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, f.runId)))[0].phase).toBe("terminal_failure");
  });
  it("revalidates the lease after the read-only probe", async () => {
    const f = await seed(); probe.mockImplementationOnce(async () => { await db.update(environmentLeases).set({ heartbeatRunId: null }).where(eq(environmentLeases.id, f.leaseId)); return { exitCode: 0 }; });
    await expect(retryNativeWorkspaceExport(f.request)).rejects.toThrow("no longer current");
    expect((await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, f.runId)))[0].phase).toBe("terminal_failure");
  });
  it("does not take ownership from an active exporter", async () => {
    const f = await seed();
    await withNativeWorkspaceFinalizationOwnership(f, async () => {
      await expect(retryNativeWorkspaceExport(f.request)).rejects.toThrow("still owned");
    });
    expect(probe).not.toHaveBeenCalled();
  });
  it("keeps accepted export repair while the original provider wake is still claimed", async () => {
    const f = await seed();
    await db.insert(agentWakeupRequests).values({ companyId, agentId, source: "assignment", status: "claimed", runId: f.runId, payload: { issueId: f.issueId } });
    await recoveryService(db, { enqueueWakeup: vi.fn() }).reconcileStrandedAssignedIssues();
    expect((await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, f.actionId)))[0]).toMatchObject({ status: "active", ownerType: "board" });
  });

  it.each(["eligible", "newer_run", "competing_action", "other_lease"])("restores only the current mistakenly settled repair: %s", async kind => {
    const f = await seed();
    await db.update(issueRecoveryActions).set({ status: "resolved", outcome: "restored", resolutionNote: "new_source_execution_path", resolvedAt: new Date() }).where(eq(issueRecoveryActions.id, f.actionId));
    if (kind === "newer_run") await db.insert(heartbeatRuns).values({ companyId, agentId, nativeIssueId: f.issueId, status: "failed", createdAt: new Date(Date.now() + 1000) });
    if (kind === "competing_action") await db.insert(issueRecoveryActions).values({ companyId, sourceIssueId: f.issueId, kind: "active_run_watchdog", ownerType: "board", cause: "other_repair", fingerprint: "other", nextAction: "Preserve another repair" });
    if (kind === "other_lease") {
      const [lease] = await db.select().from(environmentLeases).where(eq(environmentLeases.id, f.leaseId));
      await db.insert(environmentLeases).values({ companyId, environmentId, status: "active", provider: lease.provider, providerLeaseId: lease.providerLeaseId });
    }
    await restoreNativeWorkspaceExportRepairs(db, [f.runId]);
    const [action] = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, f.actionId));
    expect(action.status).toBe(kind === "eligible" ? "active" : "resolved");
    expect((await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, f.runId)))[0].phase).toBe("terminal_failure");
    expect(probe).not.toHaveBeenCalled();
  });

});
