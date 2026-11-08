import type { HarnessEvent, RunStatus } from '@sidechannel/contracts/browser';
import type { AnalysisConfiguration } from '@sidechannel/contracts/browser';

export type EvidenceCategory = 'assistant' | 'tools' | 'board' | 'artifacts' | 'memory' | 'reasoning' | 'reports';
export const evidenceCategories: EvidenceCategory[] = ['assistant', 'tools', 'board', 'artifacts', 'memory', 'reasoning', 'reports'];
export type Decision = 'present' | 'absent' | 'uncertain';
export interface ResearchRecord { id: string; revision: number; createdAt: string }
export interface Page<T> { items: T[]; nextCursor: string | null }
export interface BehaviorCode { id: string; code: string; name: string; definition: string; inclusionCriteria: string[]; exclusionCriteria: string[]; examples: string[]; counterexamples: string[]; qualifyingEvidenceTypes: string[]; enabled: boolean; archived: boolean; color: string }
export interface CodebookRevision extends ResearchRecord { codebookId: string; name?: string; codes: BehaviorCode[]; author: string; parentRevisionId?: string | null }
export interface Codebook extends Omit<ResearchRecord, 'revision'> { revision?: number; name: string; currentRevisionId: string; archived: boolean; archivedAt?: string; archivedBy?: string }
export interface AnalysisSettings { codebookId: string; codebookRevisionId: string; model: string; windowSize: number; stride: number; phases: ('action' | 'report')[]; startStep?: number; endStep?: number; evidence: EvidenceCategory[]; headroom: number; timeoutMs: number; maxAttempts: number; creator: string; parentAnalysisId?: string; resolvedSettings?: AnalysisConfiguration }
export interface CanonicalContribution { category: EvidenceCategory; eventId: string; kind: string; value: unknown }
export interface CanonicalStep { id: string; ordinal: number; invocationId: string; phase: 'action' | 'report'; agentId: string; round?: number; turn?: number; eventIds: string[]; sequenceStart: number; sequenceEnd: number; closed: boolean; diagnostics: string[]; contributions: CanonicalContribution[] }
export interface InputBudget { bytes: number; estimatedTokens: number; estimatorVersion: string; perQuestionLimit: number; perRequestLimit: number; headroom: number; oversized: boolean; reason?: string; batches: string[][] }
export interface AnalysisWindow extends ResearchRecord { analysisId: string; runId: string; index: number; stepIds: string[]; eventIds: string[]; startStep: number; endStep: number; partial: boolean; incomplete: boolean; empty: boolean; state: string; stateChunkIds?: string[]; inputHash: string; budget: InputBudget; status: 'pending' | 'completed' | 'failed' | 'oversized' | 'skipped'; error?: string; results?: AnalysisResult[] }
export interface AnalysisResult extends ResearchRecord { analysisId: string; windowId: string; codeId: string; probability: number; attemptId: string; returnedModel?: string }
export interface AnalysisAttempt extends ResearchRecord { analysisId: string; windowId: string; codeIds: string[]; requestedModel: string; returnedModel?: string; usage?: Record<string, number>; requestHash: string; inputBytes: number; startedAt: string; finishedAt?: string; status: 'submitted' | 'completed' | 'failed'; error?: string; retryable?: boolean }
export interface AnalysisManifest { schemaVersion: 1; runId: string; configHash: string; sourceStatus: RunStatus; sequenceBoundary: number; evidenceHash: string; normalizerVersion: string; serializationVersion: string; questionTemplateVersion: string; adapterVersion: string; sdkVersion: string; codebook: CodebookRevision; settings: AnalysisSettings; settingsHash: string; staticContext: { task?: string; policy?: string; version: string }; staticContextHash: string; diagnostics: string[]; availability: Record<EvidenceCategory, number>; selectedStepCount?: number; windowCount: number; scoredCodeCount: number; partialWindowCount?: number }
export interface AnalysisPreview { previewToken: string; manifest: AnalysisManifest; windows: Pick<AnalysisWindow, 'id' | 'index' | 'startStep' | 'endStep' | 'partial' | 'incomplete' | 'empty' | 'budget'>[] }
export interface AnalysisJob extends ResearchRecord { runId: string; manifest: AnalysisManifest; status: 'queued' | 'preparing' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'; cancelRequested: boolean; counters: { prepared: number; submitted: number; finished: number; failed: number; skipped: number; answers: number }; updatedAt: string; error?: string }
export interface ReviewInput { reviewer: string; scope: 'window' | 'event' | 'run'; windowId?: string; codeId?: string; outcomeId?: string; definitionRevisionId?: string; evidenceRevision?: string; decision: Decision; rationale: string; eventIds: string[]; stepIds: string[]; predictionsVisible: boolean; supersedesId?: string }
export interface HumanReview extends ResearchRecord, ReviewInput { analysisId: string; runId: string; subjectId?: string }
export interface OutcomeAgreement { outcomeId: string; definitionRevisionId: string; state: 'provisional' | 'disagreement' | 'agreed'; decision: Decision | null; reviewIds: string[]; evidenceRevision: string | null }
export interface ReviewBatchInput { mode: 'assisted' | 'blind'; threshold: number; randomCount: number; seed: string; creator: string; manualWindowIds?: string[] }
export interface ReviewBatch extends ResearchRecord, ReviewBatchInput { analysisId: string; populationHash: string; populationCount: number; selectionCount: number; codebookRevisionId: string }
export interface ReviewSelection extends ResearchRecord { analysisId: string; batchId: string; windowId: string; reasons: ('flagged' | 'random' | 'manual')[] }
export interface AnalysisRequest { method: string; path: string; query?: URLSearchParams; body?: unknown }
export interface AnalysisResponse { status: number; data: unknown }
export interface WindowDetail { window: AnalysisWindow; sourceEventIds: string[]; events?: HarnessEvent[] }

