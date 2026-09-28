import { randomUUID } from "node:crypto";
import type { EnvironmentLease } from "@paperclipai/shared";
import { and, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
import { environmentLeases, environments, heartbeatRuns, issues, issueRecoveryActions, nativeRunFinalizations, nativeRunResults, type Db } from "@paperclipai/db";
import { conflict } from "../../errors.js";
import { persistActivity, publishActivity } from "../activity-log.js";
import { hasRemoteTerminationReceipt } from "../remote-execution-termination.js";
import { withNativeWorkspaceFinalizationOwnership } from "./native-workspace-finalization-ownership.js";
import { readNativeWorkspaceSyncReference } from "./native-workspace-sync.js";
import type { EnvironmentRuntimeService } from "../environment-runtime.js";
import { resolveEnvironmentExecutionTarget } from "../environment-execution-target.js";

const CAUSE = "native_workspace_sync_out_unsafe_archive";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const changed = () => conflict("The recorded export repair is no longer current. Refresh the task and inspect its run.", { code: "workspace_export_retry_stale" });

/** Explicit board admission reopens only the accepted result's finalization suffix. */
export async function retryNativeWorkspaceExport(input: {
  db: Db; companyId: string; issueId: string; actionId: string; runId: string;
  actorId: string; repairNote: string; environmentRuntime: EnvironmentRuntimeService;
}) {
  async function inspect(db: Db, lock = false) {
    const one = async <T>(query: PromiseLike<T[]> & { for(mode: "update"): PromiseLike<T[]> }): Promise<T | null> =>
      (await (lock ? query.for("update") : query))[0] ?? null;
    // Keep the same issue -> coordinator -> run order as status commitment.
    const issue = await one(db.select().from(issues).where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId))).limit(1));
    const coordinator = await one(db.select().from(nativeRunFinalizations).where(and(eq(nativeRunFinalizations.companyId, input.companyId), eq(nativeRunFinalizations.runId, input.runId), eq(nativeRunFinalizations.issueId, input.issueId))).limit(1));
    const run = await one(db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.nativeIssueId, input.issueId))).limit(1));
    const action = await one(db.select().from(issueRecoveryActions).where(and(eq(issueRecoveryActions.companyId, input.companyId), eq(issueRecoveryActions.sourceIssueId, input.issueId), eq(issueRecoveryActions.id, input.actionId))).limit(1));
    if (!issue || !run || !coordinator || !action || action.evidence?.runId !== run.id
      || action.kind !== "active_run_watchdog" || action.cause !== CAUSE || action.ownerType !== "board"
      || !["active", "escalated"].includes(action.status) || run.runtimeMode !== "native"
      || issue.status !== "blocked" || issue.assigneeAgentId !== run.agentId
      || (issue.executionRunId && issue.executionRunId !== run.id)
      || (issue.checkoutRunId && issue.checkoutRunId !== run.id) || coordinator.leaseOwner) throw changed();
    const reference = readNativeWorkspaceSyncReference(record(run.runnerProfileJson).nativeWorkspaceSync);
    if (!reference || reference.state !== "prepared" || reference.resourceDisposition === "destroy") throw changed();
    const lease = await one(db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, input.companyId), eq(environmentLeases.id, reference.leaseId))).limit(1));
    if (!lease || lease.heartbeatRunId !== run.id || lease.issueId !== issue.id
      || lease.providerLeaseId !== reference.providerLeaseId || !lease.environmentId) throw changed();
    const [otherLease] = await db.select({ id: environmentLeases.id }).from(environmentLeases).where(and(
      ne(environmentLeases.id, lease.id), eq(environmentLeases.provider, lease.provider!), eq(environmentLeases.providerLeaseId, lease.providerLeaseId!), eq(environmentLeases.status, "active"),
    )).limit(1);
    if (otherLease) throw changed();
    const [result] = await db.select().from(nativeRunResults).where(and(eq(nativeRunResults.companyId, input.companyId), eq(nativeRunResults.issueId, issue.id), eq(nativeRunResults.runId, run.id), eq(nativeRunResults.id, coordinator.resultId ?? "00000000-0000-0000-0000-000000000000"))).limit(1);
    if (!result || result.schemaStatus !== "accepted" || result.completionContractId !== run.completionContractId) throw changed();
    const [newer] = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, input.companyId), ne(heartbeatRuns.id, run.id),
      or(eq(heartbeatRuns.nativeIssueId, issue.id), sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${issue.id}`),
      or(gt(heartbeatRuns.createdAt, run.createdAt), inArray(heartbeatRuns.status, ["queued", "running"])),
    )).limit(1);
    if (newer) throw changed();
    const pending = record(action.evidence?.workspaceExportRetry);
    const alreadyQueued = coordinator.phase !== "terminal_failure" && pending.runId === run.id
      && pending.resultId === result.id && pending.leaseId === lease.id;
    if (!alreadyQueued && (coordinator.phase !== "terminal_failure" || coordinator.failureCode !== CAUSE
      || run.status !== "failed" || !hasRemoteTerminationReceipt(lease)
      || record(lease.metadata?.remoteExecutionTermination).state !== "stopped")) throw changed();
    const [environment] = await db.select().from(environments).where(eq(environments.id, lease.environmentId)).limit(1);
    if (!environment) throw changed();
    return { issue, coordinator, run, action, reference, lease, result, environment, alreadyQueued };
  }

  const owned = await withNativeWorkspaceFinalizationOwnership(input, async (ownership) => {
    const initial = await inspect(input.db);
    if (!initial.alreadyQueued) {
      // The operator resumes and repairs the exact retained sandbox through its
      // provider console. Never acquire a replacement or seed over saved work.
      const target = await resolveEnvironmentExecutionTarget({ db: input.db, companyId: input.companyId,
        adapterType: "paperclip_runner", environment: initial.environment, leaseId: initial.lease.id,
        leaseMetadata: initial.lease.metadata, lease: initial.lease as EnvironmentLease, environmentRuntime: input.environmentRuntime });
      if (target?.kind !== "remote" || target.transport !== "sandbox" || !target.runner
        || target.remoteCwd !== initial.reference.remoteCwd) throw changed();
      try {
        const probe = await target.runner.execute({ command: target.shellCommand ?? "sh", args: ["-c", "true"], cwd: "/", timeoutMs: 10_000, bypassSession: true });
        if (probe.timedOut || probe.exitCode !== 0) throw new Error("sandbox_not_running");
      } catch {
        throw conflict("Resume and repair the retained sandbox before retrying workspace export. No provider turn was started.", { code: "workspace_export_sandbox_unavailable" });
      }
    }
    await ownership.assertHeld();
    const admitted = await input.db.transaction(async tx => {
      const current = await inspect(tx as unknown as Db, true);
      if (current.result.id !== initial.result.id || current.lease.id !== initial.lease.id
        || current.reference.descriptorSha256 !== initial.reference.descriptorSha256) throw changed();
      const receipt = { runId: current.run.id, resultId: current.result.id, leaseId: current.lease.id, status: "queued" as const };
      if (current.alreadyQueued) return { receipt, publication: null };
      const now = new Date();
      const retry = { ...receipt, requestId: randomUUID(), actorId: input.actorId, repairNote: input.repairNote, requestedAt: now.toISOString(),
        stoppedProvider: current.lease.metadata?.remoteExecutionTermination };
      await tx.update(nativeRunFinalizations).set({ phase: "result_accepted", failureCode: null, nextAttemptAt: null,
        failureDetail: { ...current.coordinator.failureDetail, workspaceFinalizeAttempt: 0, workspaceExportRetry: retry }, updatedAt: now }).where(eq(nativeRunFinalizations.runId, current.run.id));
      await tx.update(heartbeatRuns).set({ status: "running", finishedAt: null, error: null, errorCode: null,
        nativePhase: "result_accepted", nativePhaseUpdatedAt: now,
        resultJson: { ...current.run.resultJson, workspaceExportRetry: retry, finalizationPhase: "result_accepted", failureCode: null, originalFailureCode: null, nextAttemptAt: null }, updatedAt: now }).where(eq(heartbeatRuns.id, current.run.id));
      await tx.update(issues).set({ executionRunId: current.run.id, updatedAt: now }).where(eq(issues.id, current.issue.id));
      // Reclaim the same lease only for control-plane copyback. The normal
      // finalization settlement will stop/retain it again on success or failure.
      await tx.update(environmentLeases).set({ status: "active", releasedAt: null, cleanupStatus: null,
        metadata: { ...current.lease.metadata, remoteExecutionTermination: undefined }, updatedAt: now }).where(eq(environmentLeases.id, current.lease.id));
      await tx.update(issueRecoveryActions).set({ evidence: { ...current.action.evidence, workspaceExportRetry: retry },
        nextAction: "Workspace export is queued for the accepted result. No provider turn will run.",
        wakePolicy: { kind: "resume_native_run", runId: current.run.id }, updatedAt: now }).where(eq(issueRecoveryActions.id, current.action.id));
      const publication = await persistActivity(tx as unknown as Db, { companyId: input.companyId, actorType: "user", actorId: input.actorId,
        action: "issue.workspace_export_retry_requested", entityType: "issue", entityId: input.issueId, runId: input.runId,
        details: { recoveryActionId: input.actionId, resultId: current.result.id, leaseId: current.lease.id, repairNote: input.repairNote } });
      return { receipt, publication };
    });
    if (admitted.publication) publishActivity(admitted.publication.publication);
    return admitted.receipt;
  });
  if (!owned.acquired) throw conflict("Workspace finalization is still owned by another operation. Wait for it to stop before retrying.", { code: "workspace_export_retry_busy" });
  return owned.value;
}
