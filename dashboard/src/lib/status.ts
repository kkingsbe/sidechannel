import type {
  HarnessEvent,
  JobStatus,
  MonitorEvaluation,
  Projection,
  RunStatus,
  Verdict,
  WindowRecord,
} from "@sidechannel/contracts/browser";

/** Semantic colour of a badge. Only this module translates a domain value into a tone. */
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export interface StatusMeta {
  label: string;
  tone: Tone;
}

/**
 * One entry per RunStatus. Adding a status to RUN_STATUSES is a compile error here until it is
 * described, which is the guard the audit asked for (F15).
 *
 * `analysisSource` is the dashboard's policy for "this source run is frozen enough to analyse":
 * a queued/running/reporting/stopping run (and an interrupted one) is not. It lives on the status
 * table so no page re-lists statuses.
 */
export const runStatusMeta: Record<
  RunStatus,
  StatusMeta & {
    group: "active" | "terminal" | "attention";
    analysisSource: boolean;
  }
> = {
  queued: { label: "queued", tone: "warning", group: "active", analysisSource: false },
  running: { label: "running", tone: "warning", group: "active", analysisSource: false },
  reporting: { label: "reporting", tone: "warning", group: "active", analysisSource: false },
  stopping: { label: "stopping", tone: "neutral", group: "active", analysisSource: false },
  cancelled: { label: "cancelled", tone: "neutral", group: "terminal", analysisSource: true },
  completed: { label: "completed", tone: "success", group: "terminal", analysisSource: true },
  failed: { label: "failed", tone: "danger", group: "attention", analysisSource: true },
  interrupted: { label: "interrupted", tone: "neutral", group: "attention", analysisSource: false },
};

/** Untyped callers (a server value added by a newer API) fall back to the neutral badge. */
export function runStatusMetaFor(status: string): StatusMeta & { group: "active" | "terminal" | "attention"; analysisSource: boolean } {
  return (runStatusMeta as Record<string, StatusMeta & { group: "active" | "terminal" | "attention"; analysisSource: boolean }>)[status]
    ?? { label: status, tone: "neutral", group: "attention", analysisSource: false };
}

/** Whether the Analysis workspace may prepare an analysis from this source-run state. */
export function analysisSourceReady(status: string): boolean {
  return runStatusMetaFor(status).analysisSource;
}

export const reviewDecisionMeta: Record<Verdict, StatusMeta> = {
  present: { label: "present", tone: "success" },
  absent: { label: "absent", tone: "neutral" },
  uncertain: { label: "uncertain", tone: "warning" },
};

export type MonitorStatus =
  | Projection["status"]
  | MonitorEvaluation["results"][number]["status"]
  | MonitorEvaluation["status"];

/**
 * Previews, per-view results and evaluations share one vocabulary. `oversized` is a warning, not a
 * failure: a projection the monitor could not fully see is unresolved, never a negative finding.
 * `active` marks the evaluation statuses a cancel request may act on.
 */
export const monitorStatusMeta: Record<MonitorStatus, StatusMeta & { active: boolean }> = {
  ready: { label: "ready", tone: "success", active: false },
  pending: { label: "pending", tone: "neutral", active: false },
  queued: { label: "queued", tone: "warning", active: true },
  running: { label: "running", tone: "warning", active: true },
  completed: { label: "completed", tone: "success", active: false },
  partial: { label: "partial", tone: "warning", active: false },
  failed: { label: "failed", tone: "danger", active: false },
  oversized: { label: "oversized", tone: "warning", active: false },
  cancelled: { label: "cancelled", tone: "neutral", active: false },
};

/**
 * Untyped callers (a heterogeneous job list, or a server value added by a newer API) fall back to
 * the neutral badge they rendered before WS7. Typed callers index the table directly.
 */
export function monitorStatusMetaFor(status: string): StatusMeta & { active: boolean } {
  return (monitorStatusMeta as Record<string, StatusMeta & { active: boolean }>)[status]
    ?? { label: status, tone: "neutral", active: false };
}

/**
 * `active` marks the job states a cancel request may act on; `retryOffered` marks the
 * incomplete terminal states whose missing results the Retry command can request (a completed job
 * has nothing missing, and an active job must finish or cancel first).
 */
export const jobStatusMeta: Record<
  JobStatus,
  StatusMeta & { active: boolean; retryOffered: boolean }
> = {
  preparing: { label: "preparing", tone: "warning", active: true, retryOffered: false },
  queued: { label: "queued", tone: "warning", active: true, retryOffered: false },
  running: { label: "running", tone: "warning", active: true, retryOffered: false },
  completed: { label: "completed", tone: "success", active: false, retryOffered: false },
  partial: { label: "partial", tone: "warning", active: false, retryOffered: true },
  failed: { label: "failed", tone: "danger", active: false, retryOffered: true },
  cancelled: { label: "cancelled", tone: "neutral", active: false, retryOffered: true },
};

export function jobStatusMetaFor(status: string): StatusMeta & { active: boolean; retryOffered: boolean } {
  return (jobStatusMeta as Record<string, StatusMeta & { active: boolean; retryOffered: boolean }>)[status]
    ?? { ...monitorStatusMetaFor(status), retryOffered: false };
}

export const windowStatusMeta: Record<WindowRecord["status"], StatusMeta> = {
  pending: { label: "pending", tone: "neutral" },
  running: { label: "running", tone: "warning" },
  completed: { label: "completed", tone: "success" },
  failed: { label: "failed", tone: "danger" },
  skipped: { label: "skipped", tone: "neutral" },
  oversized: { label: "oversized", tone: "warning" },
};

export type AgreementState = "provisional" | "disagreement" | "agreed";

export const agreementMeta: Record<AgreementState, StatusMeta> = {
  agreed: { label: "agreed", tone: "success" },
  provisional: { label: "provisional", tone: "warning" },
  disagreement: { label: "disagreement", tone: "danger" },
};

export type IconName = "error" | "board" | "tool" | "success" | "default";

/** Event display metadata. The recorded type string is the only input; precedence matches the pre-WS7 inline chain. */
export function eventMeta(event: Pick<HarnessEvent, "type">): { label: string; tone: Tone; icon: IconName } {
  const icon: IconName = /denied|error|fail/.test(event.type)
    ? "error"
    : /board/.test(event.type)
      ? "board"
      : /tool/.test(event.type)
        ? "tool"
        : /complete|success/.test(event.type)
          ? "success"
          : "default";
  return {
    label: event.type.replaceAll("_", " "),
    tone: icon === "error" ? "danger" : "neutral",
    icon,
  };
}

/**
 * Page-level groupings are deliberately narrower than the domain active/terminal split: the run
 * list "Active runs" filter excludes queued runs (a queued run has not started executing), and the
 * overview counts four buckets. They were duplicated in the Runs and Overview pages; they live here
 * now, and the overview cards reuse the same group membership.
 */
export const runListGroups: readonly { label: string; statuses: readonly RunStatus[] }[] = [
  { label: "Active runs", statuses: ["running", "reporting", "stopping"] },
  { label: "Needs attention", statuses: ["failed", "interrupted"] },
];

export const overviewCards: readonly { label: string; detail: string; statuses: readonly RunStatus[] }[] = [
  { label: "Active runs", detail: "Inspect execution progress", statuses: runListGroups[0]!.statuses },
  { label: "Queued runs", detail: "Awaiting the experiment worker", statuses: ["queued"] },
  { label: "Completed runs", detail: "Open recorded evidence", statuses: ["completed"] },
  { label: "Needs attention", detail: "Inspect failure or interruption", statuses: runListGroups[1]!.statuses },
];
