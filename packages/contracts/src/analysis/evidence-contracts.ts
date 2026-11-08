import type { HarnessEvent, RunStatus } from '../harness/contracts.js';

export const EVIDENCE_CATEGORIES = ['assistantText', 'toolArguments', 'toolResults', 'boardContent', 'boardDelivery', 'artifactChanges', 'privateMemory', 'providerReasoning', 'finalReports'] as const;

export type EvidenceCategory = typeof EVIDENCE_CATEGORIES[number];

export type EvidenceSelection = Record<EvidenceCategory, boolean>;

export type EvidenceAvailability = Record<EvidenceCategory, boolean>;

export interface Diagnostic { code: string; message: string; eventIds: string[]; severity: 'warning' | 'error'; }

export interface ReasoningEvidence { text: string; source: string; }

export interface CanonicalToolCall { id: string; name: string; operationId?: string; arguments?: unknown; admission: 'unknown' | 'admitted' | 'unexecuted'; status: 'proposed' | 'executed' | 'denied' | 'invalid' | 'failed' | 'unexecuted'; result?: unknown; reason?: string; eventIds: string[]; }

export interface CanonicalSideEffect { type: 'board_post' | 'board_delivery' | 'memory_updated' | 'artifact_updated'; eventId: string; sequence: number; operationId?: string; toolCallId?: string; before?: unknown; after?: unknown; messageIds: string[]; beforeVersion?: number; afterVersion?: number; }

export interface CanonicalStep { id: string; ordinal: number; phase: 'action' | 'report'; agentId: string; round?: number; turn?: number; invocationId: string; eventIds: string[]; sequenceStart: number; sequenceEnd: number; closed: boolean; incomplete: boolean; diagnostics: Diagnostic[]; assistantText?: string; providerReasoning?: ReasoningEvidence[]; report?: { raw: string; parsed?: unknown; invalid: boolean }; toolCalls: CanonicalToolCall[]; sideEffects: CanonicalSideEffect[]; }

export interface SourceSnapshot { runId: string; configHash: string; status: RunStatus; sequenceBoundary: number; eventCount: number; eventIds: string[]; evidenceHash: string; normalizerVersion: string; }

export interface NormalizedTrace { version: string; runId: string; steps: CanonicalStep[]; contextEventIds: string[]; diagnostics: Diagnostic[]; availability: EvidenceAvailability; source: SourceSnapshot; }

export interface WindowConfiguration { size: number; stride: number; }

export interface StepSelection { phases: ('action' | 'report')[]; startOrdinal?: number; endOrdinal?: number; }

export interface AnalysisWindow { id: string; index: number; startOrdinal: number; endOrdinal: number; stepIds: string[]; eventIds: string[]; partial: boolean; incomplete: boolean; }

export interface InputLimits { singleQuestionTokens: number; combinedQuestionTokens: number; maxBodyBytes: number; headroomTokens: number; estimatorVersion: string; }

export interface AnalysisConfiguration { version: 1; model: string; window: WindowConfiguration; selection: StepSelection; evidence: EvidenceSelection; inputLimits: InputLimits; concurrency: number; timeoutMs: number; maxAttempts: number; retryBaseMs: number; longContext: false; }

export type AnalysisConfigurationInput = Partial<Omit<AnalysisConfiguration, 'window' | 'selection' | 'evidence' | 'inputLimits'>> & { window?: Partial<WindowConfiguration>; selection?: Partial<StepSelection>; evidence?: Partial<EvidenceSelection>; inputLimits?: Partial<InputLimits>; };

export interface BehaviorDefinition { id: string; code: string; name: string; definition: string; inclusionCriteria: string[]; exclusionCriteria: string[]; examples: string[]; counterexamples: string[]; qualifyingEvidenceTypes: string[]; enabled: boolean; archived: boolean; color: string; }

export interface CodebookRevision { id: string; codebookId: string; revision: number; createdAt: string; createdBy: string; definitions: BehaviorDefinition[]; note?: string; }

export interface Codebook { id: string; name: string; currentRevisionId: string; createdAt: string; updatedAt: string; archivedAt?: string; archivedBy?: string; }

export interface SerializedWindow { serializationVersion: string; windowId: string; state: string; hash: string; bytes: number; estimatedTokens: number; estimatorVersion: string; hasEvidence: boolean; availability: EvidenceAvailability; selection: EvidenceSelection; }

export type ReasoningExtractor = (event: HarnessEvent) => ReasoningEvidence[];