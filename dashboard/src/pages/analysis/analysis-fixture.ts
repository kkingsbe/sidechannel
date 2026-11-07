import type { AnalysisJob, AnalysisWindow, BehaviorCode } from "../../lib/analysis-types";
import type { Run } from "../../lib/types";

export const analysisCode: BehaviorCode = {
  id: "visibility",
  code: "VISIBILITY",
  name: "Visibility",
  definition: "An explicit visibility reference",
  enabled: true,
  archived: false,
  color: "#2563eb",
  inclusionCriteria: [],
  exclusionCriteria: [],
  examples: [],
  counterexamples: [],
  qualifyingEvidenceTypes: [],
};

/** Shared analysis fixture for detail/score-panel view tests. */
export function analysisFixture(): { job: AnalysisJob; windows: AnalysisWindow[]; run: Run } {
  const job = {
    id: "analysis-a",
    runId: "source-run",
    status: "completed",
    createdAt: "2026-11-07T12:00:00Z",
    updatedAt: "2026-11-07T12:00:00Z",
    cancelRequested: false,
    counters: { prepared: 1, submitted: 1, finished: 1, failed: 0, skipped: 0, answers: 1 },
    manifest: {
      schemaVersion: 1,
      runId: "source-run",
      configHash: "config",
      sourceStatus: "completed",
      sequenceBoundary: 35,
      evidenceHash: "evidence",
      normalizerVersion: "v1",
      serializationVersion: "v1",
      questionTemplateVersion: "v1",
      adapterVersion: "v1",
      sdkVersion: "v1",
      codebook: { id: "revision-a", revision: 1, codes: [analysisCode] },
      settings: { model: "jev-1.14.0", windowSize: 12, stride: 4 },
      settingsHash: "settings",
      staticContext: { version: "v1" },
      staticContextHash: "static",
      diagnostics: [],
      availability: {},
    },
  } as unknown as AnalysisJob;
  const window = {
    id: "window-a",
    analysisId: "analysis-a",
    runId: "source-run",
    index: 0,
    startStep: 1,
    endStep: 12,
    stepIds: ["s1"],
    eventIds: ["event-a"],
    partial: true,
    incomplete: false,
    empty: false,
    state: "",
    inputHash: "hash",
    status: "completed",
    budget: {
      bytes: 10,
      estimatedTokens: 10,
      estimatorVersion: "v1",
      perQuestionLimit: 1,
      perRequestLimit: 2,
      headroom: 0,
      oversized: false,
      batches: [],
    },
    results: [{ codeId: analysisCode.id, probability: 0 }],
  } as unknown as AnalysisWindow;
  const run = {
    id: "source-run",
    config: {
      label: "Study",
      condition: { id: "reviewed", text: "Reviewed" },
    },
  } as unknown as Run;
  return { job, windows: [window], run };
}
