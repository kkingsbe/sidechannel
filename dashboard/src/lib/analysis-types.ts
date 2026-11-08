import type { HarnessEvent, RunStatus } from '@sidechannel/contracts/browser';
import type { AnalysisConfiguration, AnalysisPreset, AnalysisReliability, BackgroundPart, BatchShortfall, BatchStrategy, BehaviorKind, BehaviorQuestion, BehaviorScope, ProbeConfiguration } from '@sidechannel/contracts/browser';

export type EvidenceCategory = 'assistant' | 'tools' | 'board' | 'artifacts' | 'memory' | 'reasoning' | 'reports';
export const evidenceCategories: EvidenceCategory[] = ['assistant', 'tools', 'board', 'artifacts', 'memory', 'reasoning', 'reports'];
export type Decision = 'present' | 'absent' | 'uncertain';
/** Every persisted research record starts with a server identity and creation time. */
export interface Identified { id: string; createdAt: string }
export interface Page<T> { items: T[]; nextCursor: string | null }
export interface BehaviorCode { id: string; code: string; name: string; definition: string; inclusionCriteria: string[]; exclusionCriteria: string[]; examples: string[]; counterexamples: string[]; qualifyingEvidenceTypes: string[]; enabled: boolean; archived: boolean; color: string; kind?: BehaviorKind; scope?: BehaviorScope; question?: BehaviorQuestion; background?: BackgroundPart[]; decisionProcedure?: string; framingExclusions?: string[] }
export interface CodebookRevision extends Identified { revision: number; codebookId: string; name?: string; codes: BehaviorCode[]; author: string; parentRevisionId?: string | null }
export interface Codebook extends Identified { revision?: number; name: string; currentRevisionId: string; archivedAt?: string; archivedBy?: string }
/** Server-frozen settings captured for a duplicate so a re-submit is byte-identical. */
export interface FrozenAnalysisSettings {
    evidence: AnalysisConfiguration['evidence'];
    inputLimits: AnalysisConfiguration['inputLimits'];
    concurrency: number;
    retryBaseMs: number;
    longContext: boolean;
}
export interface AnalysisSettings { codebookId: string; codebookRevisionId: string; model: string; windowSize: number; stride: number; phases: ('action' | 'report')[]; startStep?: number; endStep?: number; evidence: EvidenceCategory[]; headroom: number; timeoutMs: number; maxAttempts: number; creator: string; parentAnalysisId?: string; frozen?: FrozenAnalysisSettings; preset?: AnalysisPreset; probe?: ProbeConfiguration | null; longContext?: boolean }
export interface InputBudget { bytes: number; estimatedTokens: number; estimatorVersion: string; perQuestionLimit: number; perRequestLimit: number; headroom: number; oversized: boolean; reason?: string; batches: string[][] }
export interface AnalysisWindow extends Identified { analysisId: string; runId: string; index: number; stepIds: string[]; eventIds: string[]; startStep: number; endStep: number; partial: boolean; incomplete: boolean; empty: boolean; state: string; stateChunkIds?: string[]; inputHash: string; budget: InputBudget; status: 'pending' | 'completed' | 'failed' | 'oversized' | 'skipped'; error?: string; results?: AnalysisResult[] }
export type AnalysisAnswer =
    | { type: 'noul'; probability: number }
    | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number; optionOrder: string[] }
    | { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number };
/** `probability` is null for choice and score answers; read `answer` for those. */
export interface AnalysisResult { analysisId: string; windowId: string; codeId: string; actorId?: string; probability: number | null; answer?: AnalysisAnswer; probe?: boolean; attemptId: string; returnedModel?: string }
export interface AnalysisManifest { schemaVersion: 1; runId: string; configHash: string; sourceStatus: RunStatus; sequenceBoundary: number; evidenceHash: string; normalizerVersion: string; serializationVersion: string; questionTemplateVersion: string; adapterVersion: string; sdkVersion: string; codebook: CodebookRevision; settings: AnalysisSettings; settingsHash: string; staticContext: { task?: string; policy?: string; version: string }; staticContextHash: string; diagnostics: string[]; availability: Record<EvidenceCategory, number>; selectedStepCount?: number; windowCount: number; scoredCodeCount: number; partialWindowCount?: number }
export interface AnalysisPreview { v2?: AnalysisPreviewV2; previewToken: string; manifest: AnalysisManifest; windows: Pick<AnalysisWindow, 'id' | 'index' | 'startStep' | 'endStep' | 'partial' | 'incomplete' | 'empty' | 'budget'>[] }
export interface AnalysisJob extends Identified { runId: string; manifest: AnalysisManifest; status: 'queued' | 'preparing' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'; cancelRequested: boolean; counters: { prepared: number; submitted: number; finished: number; failed: number; skipped: number; answers: number }; updatedAt: string; error?: string; /** Repeat-variance floor from the probe; absent until it completes and on v1 jobs. */ reliability?: AnalysisReliability }
/** Fields both review domains share. */
export interface ReviewDraft {
    reviewer: string; decision: Decision; rationale: string;
    eventIds: string[]; stepIds: string[]; predictionsVisible: boolean;
}
/** A window/event annotation inside a frozen analysis. The server derives subjectId from eventIds[0] for event scope. */
export interface WindowReviewInput extends ReviewDraft {
    scope: 'window' | 'event';
    windowId: string;
    codeId: string;
    supersedes?: HumanReview;
}
export interface HumanReview extends Identified, ReviewDraft {
    revision: number; analysisId: string; runId: string; subjectId?: string; windowId?: string;
    scope: 'window' | 'event'; codeId: string; definitionRevisionId: string; supersedesId?: string;
}
export interface ReviewBatch extends Identified { analysisId: string; mode: 'assisted' | 'blind'; threshold?: number; populationCount: number; selectionCount: number; codebookRevisionId: string; strategy?: BatchStrategy; shortfalls?: BatchShortfall[] }
export interface ReviewSelection { id: string; windowId: string; reasons?: string[] }
export interface WindowDetail { window: AnalysisWindow; sourceEventIds: string[]; events?: HarnessEvent[] }
/** Run metrics and condition comparison (v2 spec section 8). */
export type { AnalysisSummary, CodeSummary, Comparison, ComparisonCode, ComparisonMetric, ConditionDifference, ComparisonRequest, ScoreMetrics, ThresholdPolicy } from '@sidechannel/contracts/browser';

/** One background group of a v2 preview: the parts its questions carry and the exact text they receive. */
export interface BackgroundGroup { key: string; parts: BackgroundPart[]; codeIds: string[]; requested?: { codeId: string; parts: BackgroundPart[] }[]; text: { task?: string; policy?: string } }
/** v2 request-shaping details of a preview (spec sections 5 to 7). Absent from v1 servers. */
export interface AnalysisPreviewV2 {
    preset: AnalysisPreset; longContext: boolean; suggestedWindowSize?: number;
    groups: BackgroundGroup[]; conditionExcluded: boolean; conditionQuotedWindows: string[];
    probe: (ProbeConfiguration & { windowIds: string[] }) | null;
}
