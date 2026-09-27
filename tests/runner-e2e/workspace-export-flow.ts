import { lstat } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { pollUntil, type RunnerApi } from "./api.js";
import { collectRunEvents } from "./run-observations.js";
import { createTaskThroughUi } from "./user-actions.js";
import type { LiveFixtureValues } from "./live-fixtures.js";
import type { MatrixExecution } from "./types.js";
import { gradeWorkspaceExport, hasPermanentWorkspaceFailure, type WorkspaceExportObservation } from "./workspace-export-scoring.js";

type Row = Record<string, any>;
export async function runWorkspaceExportRejection(input: {
  page: Page; api: RunnerApi; fixtures: LiveFixtureValues; execution: MatrixExecution;
  nonce: string; workspacePath: string; deadlineAt: number;
  observe(issue: any, runs: any[], checks: ReturnType<typeof gradeWorkspaceExport>): void;
  capture(id: string, label: string, file: string): Promise<void>;
  evidence(name: string, value: unknown): Promise<void>;
}) {
  const { page, api, fixtures, execution, nonce } = input;
  const title = execution.task.buildTitle(nonce);
  let issue: Row | undefined;
  let runs: Row[] = [];
  let observed: WorkspaceExportObservation | undefined;
  let checks: ReturnType<typeof gradeWorkspaceExport> = [];
  async function load() {
    if (!issue) throw new Error("Workspace export task is missing");
    issue = await api.get<Row>(`/api/issues/${issue.id}`);
    const listed = await api.get<Row[]>(`/api/companies/${fixtures.company.id}/heartbeat-runs?agentId=${fixtures.agent.id}&limit=20`);
    runs = await Promise.all(listed.map(run => api.get<Row>(`/api/heartbeat-runs/${run.id}`)));
    input.observe(issue, runs, checks);
    return { issue, runs };
  }
  async function snapshot() {
    const state = await load();
    const run = runs[0];
    const [events, recovery, leases] = await Promise.all([
      run ? collectRunEvents<Row>(async (afterSeq, limit) => api.get(`/api/heartbeat-runs/${run.id}/events?afterSeq=${afterSeq}&limit=${limit}`)) : [],
      api.get<Row>(`/api/issues/${issue!.id}/recovery-actions`),
      api.get<Row[]>(`/api/environments/${fixtures.environment.id}/leases`),
    ]);
    const hostLinkAbsent = await lstat(path.join(input.workspacePath, `unsafe-export-${nonce}`)).then(() => false, error => {
      if (error.code === "ENOENT") return true;
      throw error;
    });
    observed = { ...state, events, recovery, leases, hostLinkAbsent, marker: execution.task.buildVisibleMarker(nonce) };
    checks = gradeWorkspaceExport(observed);
    input.observe(state.issue, runs, checks);
    await input.evidence("workspace-export.json", { ...observed, checks });
    await input.evidence("api-state.json", { ...state, runEvents: events, recovery, leases });
    return observed;
  }
  try {
    await createTaskThroughUi({ page, issuePrefix: fixtures.company.issuePrefix!, agentName: fixtures.agent.name,
      title, prompt: execution.task.buildPrompt(nonce), workMode: "standard", projectName: fixtures.project?.name });
    issue = await pollUntil({ label: "unsafe export task creation", deadlineAt: input.deadlineAt,
      load: async () => (await api.get<Row[]>(`/api/companies/${fixtures.company.id}/issues?limit=100`)).find(row => row.title === title), accept: Boolean });
    if (!issue) throw new Error("Missing created export task");
    // Stop at the first export outcome on an unfixed controller, before its
    // scheduled retry. This preserves the red evidence without provider replay.
    await pollUntil({ label: "first workspace export outcome", deadlineAt: input.deadlineAt, intervalMs: 500, load,
      accept: state => state.runs.some(run => ["retryable_failure", "terminal_failure"].includes(run.nativePhase)),
      reject: state => state.runs.length > 1 ? "Unexpected second provider run" : state.runs.some(run => ["failed", "cancelled", "timed_out", "succeeded"].includes(run.status)) ? "Run ended before the workspace export rejection" : undefined });
    await snapshot();
    if (!hasPermanentWorkspaceFailure(runs[0])) throw new Error("First unsafe export refusal was not immediately permanent with no retry");
    // Native teardown is asynchronous. Wait only for the retained-lease receipt;
    // never resume a provider or mutate the fixture's evidence to make it pass.
    await pollUntil({ label: "retained sandbox after rejected export", deadlineAt: Math.min(input.deadlineAt, Date.now() + 60_000), intervalMs: 500,
      load: snapshot, accept: () => checks.every(check => check.passed),
      reject: state => state.runs.length !== 1 || !hasPermanentWorkspaceFailure(state.runs[0]) ? "Permanent export outcome changed or provider work replayed" : undefined });
    // Two subsequent observations prove no immediate follow-up was scheduled.
    const settledAt = Date.now() + 3_000;
    await pollUntil({ label: "stable permanent export outcome", deadlineAt: input.deadlineAt, intervalMs: 1_000,
      load: snapshot, accept: () => Date.now() >= settledAt,
      reject: () => checks.some(check => !check.passed) ? "Settled export evidence regressed" : undefined });
    await page.goto(`/${fixtures.company.issuePrefix}/issues/${issue.identifier ?? issue.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("issue-detail-header").getByRole("button", { name: "Change status (current: Blocked" })).toBeVisible({ timeout: 30_000 });
    await input.capture("final-state", "Unsafe export blocked with work retained", "final-state.png");
  } finally {
    if (issue) await snapshot();
  }
  for (const check of checks) expect(check.passed, check.detail).toBe(true);
  return { issue: issue!, runs };
}
