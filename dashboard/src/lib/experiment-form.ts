import type { ExperimentConfig, Run } from "./types";

/** Researcher-facing names for configuration paths, used in every validation message. */
export const fieldLabels: Record<string, string> = {
  label: "Experiment name",
  experimentId: "Experiment / group identifier",
  configVersion: "Configuration version",
  phase: "Designation",
  "scenario.version": "Scenario version",
  "scenario.datasetId": "Dataset identifier",
  "scenario.datasetVersion": "Dataset version",
  "scenario.datasetSeed": "Dataset seed",
  "scenario.task": "Task",
  "scenario.policy": "Policy",
  "model.provider": "Model provider",
  "model.id": "Exact model identifier",
  "model.settings": "Advanced model parameters",
  roles: "Roles",
  "scheduler.rounds": "Fixed rounds",
  "scheduler.toolCallsPerTurn": "Admitted tool calls / turn",
  "scheduler.seed": "Agent-order & pairing seed",
  "limits.requestTimeoutMs": "Request timeout",
  "limits.maxModelStepsPerTurn": "Model steps / turn",
  "limits.maxDurationMs": "Maximum run duration",
  "board.defaultPageSize": "Latest posts by default",
  "board.maxPageSize": "Maximum board page size",
  "board.maxPostLength": "Post limit",
  "memory.contextBudget": "Memory context budget",
  "memory.version": "Memory template version",
  "memory.template": "Private working-memory template",
  artifactSchemaVersion: "Artifact schema version",
  reportSchemaVersion: "Report schema version",
  reportInstructions: "Reporting instructions",
};
/** Backend validation names (first word of a raw message) mapped to field paths. */
const rawNames: Record<string, string> = {
  label: "label",
  experimentId: "experimentId",
  configVersion: "configVersion",
  artifactSchemaVersion: "artifactSchemaVersion",
  reportSchemaVersion: "reportSchemaVersion",
  reportInstructions: "reportInstructions",
  rounds: "scheduler.rounds",
  toolCallsPerTurn: "scheduler.toolCallsPerTurn",
  defaultPageSize: "board.defaultPageSize",
  maxPageSize: "board.maxPageSize",
  maxPostLength: "board.maxPostLength",
  contextBudget: "memory.contextBudget",
  requestTimeoutMs: "limits.requestTimeoutMs",
  maxModelStepsPerTurn: "limits.maxModelStepsPerTurn",
  maxDurationMs: "limits.maxDurationMs",
  reportCalls: "",
};

/** Turn "label is required" / "rounds must be a positive integer" into plain wording. */
export function humanizeError(message: string, path?: string): string {
  const raw = message.trim();
  const first = raw.split(/[\s:]/)[0] ?? "";
  const key = path && fieldLabels[path] ? path : rawNames[first];
  const name = key ? fieldLabels[key] : undefined;
  if (!name) return raw.replace(/^./, (c) => c.toUpperCase());
  const body = raw
    .replace(/^[A-Za-z0-9_.]+:\s*/, "")
    .replace(/^[A-Za-z0-9_.]+\s+(?=is required|must be)/, "");
  if (/^is required/.test(body) || /^required/.test(body))
    return `${name} can't be blank`;
  if (/must be a positive integer/.test(body))
    return `${name} must be a whole number of 1 or more`;
  return /^(is|must|can|cannot|should|exceeds|has|needs)\b/.test(body)
    ? `${name} ${body}`
    : body.replace(/^./, (c) => c.toUpperCase());
}

export const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
export const DURATION_WARNING_MS = 120 * 60 * 1000;

const wholePositive = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
const positivePaths = [
  "scheduler.rounds",
  "scheduler.toolCallsPerTurn",
  "limits.requestTimeoutMs",
  "limits.maxModelStepsPerTurn",
  "limits.maxDurationMs",
  "board.defaultPageSize",
  "board.maxPageSize",
  "board.maxPostLength",
  "memory.contextBudget",
];
const at = (config: ExperimentConfig, path: string) =>
  path
    .split(".")
    .reduce(
      (value: unknown, key) => (value as Record<string, unknown>)?.[key],
      config,
    );
/** Errors the browser can determine without the server. Keyed by config path. */
export function localFieldErrors(
  config: ExperimentConfig,
  skip: string[] = [],
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (typeof config.label !== "string" || !config.label.trim())
    errors.label = "Experiment name can't be blank";
  for (const path of positivePaths) {
    if (skip.includes(path) || at(config, path) === undefined) continue;
    if (!wholePositive(at(config, path)))
      errors[path] =
        path === "limits.requestTimeoutMs" || path === "limits.maxDurationMs"
          ? `${fieldLabels[path]} must be a positive duration`
          : `${fieldLabels[path]} must be a whole number of 1 or more`;
  }
  const seed = config.scheduler?.seed;
  if (!Number.isSafeInteger(seed))
    errors["scheduler.seed"] = `${fieldLabels["scheduler.seed"]} must be a whole number`;
  const maxDuration = config.limits?.maxDurationMs;
  if (wholePositive(maxDuration) && maxDuration > MAX_DURATION_MS)
    errors["limits.maxDurationMs"] =
      "Maximum run duration can't be more than 24 hours (1,440 minutes)";
  return errors;
}

export function humanDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const plural = (n: number, unit: string) =>
    `${Number(n.toFixed(1)).toLocaleString()} ${unit}${n === 1 ? "" : "s"}`;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return plural(ms / 1000, "second");
  if (ms < 3_600_000) return plural(ms / 60_000, "minute");
  return plural(ms / 3_600_000, "hour");
}

/** Worst-case counts for one run, or undefined when the limits are not valid numbers. */
export function runBudget(config: ExperimentConfig) {
  const rounds = config.scheduler?.rounds,
    calls = config.scheduler?.toolCallsPerTurn,
    steps = config.limits?.maxModelStepsPerTurn,
    agents = config.roles?.length;
  if (![rounds, calls, steps, agents].every(wholePositive)) return undefined;
  return {
    rounds: rounds!,
    calls: calls!,
    steps: steps!,
    agents: agents!,
    toolCalls: rounds! * agents! * calls!,
    modelSteps: rounds! * agents! * steps!,
  };
}

const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : 1,
          ),
        )
      : item,
  );
/** Identity of a configuration ignoring the experiment name. */
export function configFingerprint(config: ExperimentConfig): string {
  const { label: _label, ...rest } = config;
  return stable(rest);
}

export interface SessionLaunch {
  at: string;
  label: string;
  key: string;
  fingerprint: string;
  pairId?: string;
  runs: { id: string; condition: string }[];
}
const storageKey = "sidechannel-session-launches";
export function readSessionLaunches(): SessionLaunch[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
export function recordSessionLaunch(
  config: ExperimentConfig,
  key: string,
  runs: Run[],
): SessionLaunch[] {
  const entry: SessionLaunch = {
    at: new Date().toISOString(),
    label: config.label,
    key,
    fingerprint: configFingerprint(config),
    pairId: runs.find((run) => run.pairId)?.pairId,
    runs: runs.map((run) => ({
      id: run.id,
      condition: run.config?.condition?.id ?? "run",
    })),
  };
  const next = [entry, ...readSessionLaunches()].slice(0, 20);
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    /* Session storage is a convenience only. */
  }
  return next;
}
