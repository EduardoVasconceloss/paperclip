type Row = Record<string, any>;
export interface WorkspaceExportObservation {
  issue: Row;
  runs: Row[];
  events: Row[];
  recovery: Row;
  leases: Row[];
  hostLinkAbsent: boolean;
  marker: string;
}
export const unsafeWorkspaceFailureCode = "native_workspace_sync_out_unsafe_archive";
export function hasPermanentWorkspaceFailure(run: Row | undefined) {
  return run?.status === "failed" && run.nativePhase === "terminal_failure" &&
    run.resultJson?.failureCode === unsafeWorkspaceFailureCode && run.resultJson?.nextAttemptAt === null;
}
export function gradeWorkspaceExport(observed: WorkspaceExportObservation) {
  const run = observed.runs[0];
  const recovery = observed.recovery.active;
  const envelopes = observed.events.map(e => e.payload?.prpEvent).filter(Boolean);
  const accepted = envelopes.filter(e => e.eventType === "run.result.accepted");
  const terminal = envelopes.filter(e => e.eventType === "run.terminal");
  const lifecycle = observed.events.filter(e => e.eventType === "lifecycle" && e.payload?.retryReasonCode?.startsWith("workspace_sync_out"));
  const leases = observed.leases.filter(l => l.heartbeatRunId === run?.id);
  const lease = leases[0];
  const receipt = lease?.metadata?.remoteExecutionTermination;
  const checks = [
    ["one-provider-run", observed.runs.length === 1 && !!run?.runnerInstanceId && run.runtimeMode === "native" && !run.retryOfRunId && (run.continuationAttempt ?? 0) === 0,
      "Exactly one native provider run, with no successor or recovery continuation"],
    ["accepted-result", accepted.length === 1 && accepted[0].sourceKind === "control_plane" && accepted[0].runId === run?.id && accepted[0].payload?.result?.summary === observed.marker && accepted[0].payload?.result?.reportedWorkDisposition === "done",
      "The same run retains its control-plane accepted semantic result"],
    ["provider-terminal", terminal.length === 1 && terminal[0].sourceKind === "control_plane" && terminal[0].runId === run?.id && terminal[0].payload?.runTerminalState === "succeeded" && run?.resultJson?.prpRunTerminalState === "succeeded",
      "Provider work completed successfully before the independent export failure"],
    ["first-permanent-failure", hasPermanentWorkspaceFailure(run) && recovery?.evidence?.workspaceFinalizeAttempt === 1,
      "First export refusal is permanent; it does not consume three retry attempts"],
    ["board-repair", recovery?.cause === unsafeWorkspaceFailureCode && recovery?.ownerType === "board" && recovery?.evidence?.runId === run?.id && recovery?.wakePolicy === null && /unsafe link or path.*retained sandbox.*without submitting another provider turn/i.test(recovery?.nextAction ?? ""),
      "A board-owned recovery action explains retained-sandbox repair without replay"],
    ["blocked-without-retry", observed.issue.status === "blocked" && observed.issue.scheduledRetry === null && !observed.issue.monitorNextCheckAt && !observed.issue.executionRunId && !observed.issue.checkoutRunId,
      "Task is visibly blocked with no scheduled retry or execution lock"],
    ["explicit-diagnostic", lifecycle.length === 1 && lifecycle[0].payload.retryReasonCode === "workspace_sync_out_unsafe_archive" && lifecycle[0].payload.nextAttemptAt === null && /native result is durable.*unsafe link or path.*retained sandbox/i.test(lifecycle[0].message ?? ""),
      "One run-log diagnostic preserves result ownership and names the unsafe export"],
    ["sandbox-preserved", leases.length === 1 && lease.leasePolicy === "reuse_by_environment" && lease.status === "released" && lease.cleanupStatus === "success" && !!lease.providerLeaseId && receipt?.schema === "paperclip.remote-termination.v1" && receipt?.state === "stopped" && receipt.runId === run?.id && receipt.leaseId === lease.id && receipt.providerLeaseId === lease.providerLeaseId,
      "Provider confirms the exact sandbox was stopped and retained, not destroyed"],
    ["host-guard", observed.hostLinkAbsent === true,
      "The escaping link was never materialized into the host workspace"],
  ] as const;
  return checks.map(([id, passed, detail]) => ({ id, passed: Boolean(passed), detail }));
}
