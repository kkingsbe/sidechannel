import type { RunStatus } from '../harness/contracts.js';
import type { ResearchRecord } from '../analysis/store.js';
import type { MonitorDefinition, OutcomeDefinition, Verdict } from './contracts.js';

export interface RunReviewContext {
    runId: string; evidenceRevision: string; definition: MonitorDefinition; sourceStatus: RunStatus;
    eventCount: number; sequenceBoundary: number;
}

export interface RunOutcomeReview extends ResearchRecord {
    runId: string; outcomeId: string; definitionRevisionId: string; evidenceRevision: string;
    reviewer: string; reviewerKey: string; identityVerified: false; decision: Verdict; rationale: string;
    eventIds: string[]; supersedesId?: string; sequence: number; agreementEpoch: number;
    outcomeDefinition: OutcomeDefinition;
}

export interface RunOutcomeAgreement {
    outcomeId: string; definitionRevisionId: string; evidenceRevision: string | null;
    state: 'provisional' | 'disagreement' | 'agreed'; decision: Verdict | null;
    reviewIds: string[]; agreementEpoch: number; sourceMatches: boolean; definitionCurrent: boolean;
}