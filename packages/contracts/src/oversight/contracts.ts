import type { ExperimentConfig } from '../harness/contracts.js';

export const MONITOR_VIEWS = ['reports', 'audit', 'board', 'full'] as const;

export type MonitorView = typeof MONITOR_VIEWS[number];

export const MONITOR_EVALUATION_STATUSES = ['queued', 'running', 'completed', 'partial', 'failed', 'cancelled'] as const;

export type MonitorEvaluationStatus = typeof MONITOR_EVALUATION_STATUSES[number];

/** Non-terminal evaluation statuses: the only ones a cancel request may modify. */
export const ACTIVE_MONITOR_STATUSES: readonly MonitorEvaluationStatus[] = ['queued', 'running'];

export const MONITOR_VIEW_STATUSES = ['pending', 'running', 'completed', 'failed', 'oversized', 'cancelled'] as const;

export type MonitorViewStatus = typeof MONITOR_VIEW_STATUSES[number];

export type Verdict = 'present' | 'absent' | 'uncertain';

export interface OutcomeDefinition {
    id: string; name: string; definition: string; qualifyingCriteria: string;
    presentGuidance: string; absentGuidance: string; uncertainGuidance: string;
    examples: string; exclusions: string; archived: boolean;
}

export interface MonitorDefinition {
    id: string; schemaVersion: 1; revision: number; createdAt: string;
    questions: string; outcomes: OutcomeDefinition[];
}

export interface MonitorSettings {
    model: ExperimentConfig['model']; maxInputChars: number;
    contextWindowTokens: number; outputAllowanceTokens: number; timeoutMs: number;
}

export interface Projection {
    schemaVersion: 1; version: 'monitor-projection-v1'; runId: string; configHash: string;
    view: MonitorView; evidenceIds: string[]; included: string[]; excluded: string[];
    availability: { privateMemory: boolean; providerReasoning: boolean; reports: boolean; finalArtifact: boolean };
    evidence: Record<string, unknown>; serialized: string; hash: string;
    characters: number; estimatedInputTokens: number; estimator: 'utf8-byte-upper-bound-v1';
    status: 'ready' | 'oversized'; reason?: string;
}

export interface MonitorPreview {
    schemaVersion: 1; id: string; revision: number; createdAt: string; definition: MonitorDefinition;
    settings: MonitorSettings; runs: { runId: string; projections: Projection[] }[];
    hash: string;
}

export interface MonitorJudgment { outcomeId: string; verdict: Verdict; evidenceIds: string[]; explanation: string; }

export interface MonitorViewResult {
    runId: string; view: MonitorView; status: MonitorViewStatus;
    projectionHash: string; judgments: MonitorJudgment[]; error?: string;
    durationMs?: number; usage?: Record<string, number>;
}

export interface MonitorEvaluation {
    id: string; schemaVersion: 1; revision: number; createdAt: string; updatedAt: string;
    idempotencyKey: string; previewId: string; previewHash: string;
    definition: MonitorDefinition; settings: MonitorSettings; runIds: string[];
    status: MonitorEvaluationStatus;
    cancelRequested: boolean; results: MonitorViewResult[]; workerOwner?: string;
}