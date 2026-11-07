import type { ExperimentConfig } from '../harness/contracts.js';

export const MONITOR_VIEWS = ['reports', 'audit', 'board', 'full'] as const;
export type MonitorView = typeof MONITOR_VIEWS[number];
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
    runId: string; view: MonitorView; status: 'pending' | 'running' | 'completed' | 'failed' | 'oversized' | 'cancelled';
    projectionHash: string; judgments: MonitorJudgment[]; error?: string;
    durationMs?: number; usage?: Record<string, number>;
}
export interface MonitorEvaluation {
    id: string; schemaVersion: 1; revision: number; createdAt: string; updatedAt: string;
    idempotencyKey: string; previewId: string; previewHash: string;
    definition: MonitorDefinition; settings: MonitorSettings; runIds: string[];
    status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
    cancelRequested: boolean; results: MonitorViewResult[]; workerOwner?: string;
}
export interface MonitorProvider {
    evaluate(input: { evaluationId: string; projection: Projection; definition: MonitorDefinition; settings: MonitorSettings }): Promise<{ output: unknown; usage?: Record<string, number> }>;
}
