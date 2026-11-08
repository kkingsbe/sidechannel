import { useState } from "react";
import type { AnalysisJob, AnalysisSettings } from "../../lib/analysis-types";
import { NEW_ANALYSIS_DEFAULTS } from "../../lib/adapters/defaults";
import { analysisSourceReady } from "../../lib/status";
import { DEFAULT_PROBE, presetPatch, probeProblems } from "./use-analysis-presets";

const categories: AnalysisSettings["evidence"] = [
  "assistant",
  "tools",
  "board",
  "artifacts",
  "memory",
  "reasoning",
  "reports",
];

/**
 * One owner of the analysis draft (`settings`) and the single prerequisite list. Any change
 * produces a new settings identity, which is what makes preview staleness an identity check.
 */
export function useAnalysisDraft(input: {
  runId: string;
  sourceStatus: string | undefined;
  defaultCreator: string;
}) {
  const [settings, setSettings] = useState<AnalysisSettings>({
    codebookId: "",
    codebookRevisionId: "",
    model: NEW_ANALYSIS_DEFAULTS.model,
    windowSize: NEW_ANALYSIS_DEFAULTS.windowSize,
    stride: NEW_ANALYSIS_DEFAULTS.stride,
    phases: ["action", "report"],
    evidence: [...categories],
    headroom: NEW_ANALYSIS_DEFAULTS.headroom,
    timeoutMs: NEW_ANALYSIS_DEFAULTS.timeoutMs,
    maxAttempts: NEW_ANALYSIS_DEFAULTS.maxAttempts,
    creator: input.defaultCreator,
    // New analyses default to the dense preset with the reliability probe on (spec section 7).
    ...presetPatch("dense", { probe: { ...DEFAULT_PROBE } } as AnalysisSettings),
  });
  const change = (patch: Partial<AnalysisSettings>) =>
    setSettings((previous) => ({ ...previous, ...patch }));
  const adoptClone = (job: AnalysisJob) =>
    setSettings({ ...job.manifest.settings, parentAnalysisId: job.id });
  const prerequisites = [
    !input.runId && "Select a source run.",
    input.sourceStatus &&
      !analysisSourceReady(input.sourceStatus) &&
      "Wait for the source run to finish before previewing.",
    !settings.codebookRevisionId && "Select a codebook revision.",
    !settings.creator.trim() && "Enter a researcher / creator identity.",
    (!Number.isFinite(settings.windowSize) || settings.windowSize < 1) &&
      "Enter a positive window size.",
    (!Number.isFinite(settings.stride) || settings.stride < 1) &&
      "Enter a positive step interval.",
    !settings.evidence.length && "Select at least one evidence category.",
    !settings.phases.length && "Select at least one phase.",
    ...probeProblems(settings.probe),
  ].filter(Boolean);
  return { settings, change, adoptClone, prerequisites };
}
