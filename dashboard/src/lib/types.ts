export type {
  ExperimentConfig,
  Run,
  HarnessEvent,
  BoardMessage,
  ArtifactVersion,
  Json,
} from "@sidechannel/contracts/browser";
import type { ExperimentConfig } from "@sidechannel/contracts/browser";
export interface Draft {
  id: string;
  config: ExperimentConfig;
  revision?: number;
  updatedAt?: string;
}
export interface ConfigurationResponse {
  default: ExperimentConfig;
  [key: string]: unknown;
}
import type {
  MonitorDefinition,
  OutcomeDefinition,
  Verdict,
} from "@sidechannel/contracts/browser";
export interface RunReviewContext {
  runId: string;
  evidenceRevision: string;
  definition: MonitorDefinition;
  sourceStatus: string;
  eventCount: number;
  sequenceBoundary: number;
}
export interface RunOutcomeReview {
  id: string;
  revision: number;
  createdAt: string;
  runId: string;
  outcomeId: string;
  definitionRevisionId: string;
  evidenceRevision: string;
  reviewer: string;
  identityVerified: false;
  decision: Verdict;
  rationale: string;
  eventIds: string[];
  supersedesId?: string;
  sequence: number;
  agreementEpoch: number;
  outcomeDefinition: OutcomeDefinition;
}
export interface RunOutcomeAgreement {
  outcomeId: string;
  definitionRevisionId: string;
  evidenceRevision: string | null;
  state: "provisional" | "disagreement" | "agreed";
  decision: Verdict | null;
  reviewIds: string[];
  agreementEpoch: number;
  sourceMatches: boolean;
  definitionCurrent: boolean;
}
import type {
  MonitorJudgment,
  MonitorView,
} from "@sidechannel/contracts/browser";
export interface MonitorComparison {
  evaluationId: string;
  definitionRevisionId: string;
  comparisons: {
    outcome: OutcomeDefinition;
    rows: {
      runId: string;
      reference: RunOutcomeAgreement | null;
      referenceEligible: boolean;
      views: Record<
        MonitorView,
        { status: string; judgment: MonitorJudgment | null }
      >;
    }[];
    metrics: {
      view: MonitorView;
      sourceRuns: number;
      referencePositive: number;
      referenceNegative: number;
      detected: number;
      falsePositive: number;
      monitorUncertain: number;
      missingView: number;
      excludedReference: number;
      referenceUncertain: number;
      detectionRate: number | null;
      falsePositiveRate: number | null;
    }[];
  }[];
}
