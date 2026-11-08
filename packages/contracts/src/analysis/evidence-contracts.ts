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

/** Named settings bundles the setup page offers (v2 spec section 7). `custom` is the v1 form. */
export const ANALYSIS_PRESETS = ['dense', 'windowed', 'whole-run', 'custom'] as const;

export type AnalysisPreset = typeof ANALYSIS_PRESETS[number];

/** Repeat-variance probe: a seeded sample of windows re-scored several times (v2 spec section 6). */
export interface ProbeConfiguration { windows: number; repeats: number; seed: string; }

export interface AnalysisConfiguration { version: 1; model: string; window: WindowConfiguration; selection: StepSelection; evidence: EvidenceSelection; inputLimits: InputLimits; concurrency: number; timeoutMs: number; maxAttempts: number; retryBaseMs: number; longContext: boolean; preset?: AnalysisPreset; probe?: ProbeConfiguration; }

export type AnalysisConfigurationInput = Partial<Omit<AnalysisConfiguration, 'window' | 'selection' | 'evidence' | 'inputLimits' | 'probe'>> & { window?: Partial<WindowConfiguration>; selection?: Partial<StepSelection>; evidence?: Partial<EvidenceSelection>; inputLimits?: Partial<InputLimits>; probe?: Partial<ProbeConfiguration> | null; };

export const BEHAVIOR_KINDS = ['behavioral', 'distractor', 'audit'] as const;
export type BehaviorKind = typeof BEHAVIOR_KINDS[number];

export const BEHAVIOR_SCOPES = ['window', 'actor'] as const;
export type BehaviorScope = typeof BEHAVIOR_SCOPES[number];

/** Parts of the frozen run context a question may receive. The condition is deliberately not representable here. */
export const BACKGROUND_PARTS = ['task', 'policy'] as const;
export type BackgroundPart = typeof BACKGROUND_PARTS[number];

export type BehaviorQuestion =
    | { type: 'noul' }
    | { type: 'choice'; options: { label: string; description: string }[]; allowNone: boolean }
    | { type: 'score'; levels: string[] };

/**
 * A codebook entry. The v1 fields are required; the v2 fields (spec section 4.1) are optional in
 * storage and resolved to their defaults by the domain layer: kind `behavioral`, scope `window`,
 * question `noul`, background `['task', 'policy']`, empty framing exclusions.
 */
export interface BehaviorDefinition {
    id: string; code: string; name: string; definition: string;
    inclusionCriteria: string[]; exclusionCriteria: string[]; examples: string[]; counterexamples: string[];
    qualifyingEvidenceTypes: string[]; enabled: boolean; archived: boolean; color: string;
    kind?: BehaviorKind; scope?: BehaviorScope; question?: BehaviorQuestion;
    background?: BackgroundPart[]; decisionProcedure?: string; framingExclusions?: string[];
}

/** A definition with every v2 field present. */
export type ResolvedBehaviorDefinition = Required<Omit<BehaviorDefinition, 'decisionProcedure'>> & Pick<BehaviorDefinition, 'decisionProcedure'>;

/** A non-blocking validation finding on one definition, surfaced inline in the codebook studio. */
export interface CodebookWarning { codeId: string; field: 'definition' | 'decisionProcedure'; message: string }

/** Leading negated phrasing ("does not", "is free of", "no ") that tends to prime the classifier toward the negated behavior (spec 4.1). */
export const NEGATED_PHRASING = /^\s*(does not|is free of|no )/i;

export interface CodebookRevision { id: string; codebookId: string; revision: number; createdAt: string; createdBy: string; definitions: BehaviorDefinition[]; note?: string; schemaVersion?: 1 | 2; }

export interface Codebook { id: string; name: string; currentRevisionId: string; createdAt: string; updatedAt: string; archivedAt?: string; archivedBy?: string; }

/** `aliasMap` (v2 serialization) maps window-local aliases used in `state` back to real step, event and tool-call IDs. */
export interface SerializedWindow { serializationVersion: string; windowId: string; state: string; hash: string; bytes: number; estimatedTokens: number; estimatorVersion: string; hasEvidence: boolean; availability: EvidenceAvailability; selection: EvidenceSelection; aliasMap?: Record<string, string>; activeAgents?: string[]; }

export type ReasoningExtractor = (event: HarnessEvent) => ReasoningEvidence[];