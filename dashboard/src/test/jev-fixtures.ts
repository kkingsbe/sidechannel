import type { BehaviorDefinition, Codebook as JevCodebook, CodebookRevision as JevRevision } from '@sidechannel/contracts/browser';
import type { AnalysisJob as JevJob, AnalysisResult as JevResult, WindowRecord } from '@sidechannel/contracts/browser';
import type { Review as JevReview, ReviewBatch as JevBatch } from '@sidechannel/contracts/browser';

/** Canonical Jev fixtures for page tests: the adapter maps these to view models. */
export const definition = (overrides: Partial<BehaviorDefinition> = {}): BehaviorDefinition => ({
    id: 'visibility', code: 'VISIBILITY', name: 'Visibility', definition: 'An explicit visibility reference',
    inclusionCriteria: [], exclusionCriteria: [], examples: [], counterexamples: [], qualifyingEvidenceTypes: [],
    enabled: true, archived: false, color: '#2563eb', ...overrides,
});

export const revision = (codebookId = 'book', definitions: BehaviorDefinition[] = [definition()], number = 1): JevRevision => ({
    id: codebookId + '-revision-' + number, codebookId, revision: number, createdAt: '2026-11-07T12:00:00Z', createdBy: 'Researcher', definitions,
});

export const book = (current: JevRevision, overrides: Partial<JevCodebook> = {}): JevCodebook => ({
    id: current.codebookId, name: 'Study', currentRevisionId: current.id,
    createdAt: current.createdAt, updatedAt: current.createdAt, ...overrides,
});

interface JobOverrides {
    id?: string; runId?: string; status?: JevJob['status']; createdAt?: string;
    definitions?: BehaviorDefinition[]; revision?: JevRevision;
    settings?: Partial<JevJob['manifest']['settings']>;
    source?: Partial<JevJob['manifest']['source']>;
    diagnostics?: string[]; error?: string;
}
export const job = (overrides: JobOverrides = {}): JevJob => {
    const rev = overrides.revision ?? revision('book', overrides.definitions);
    const settings: JevJob['manifest']['settings'] = {
        version: 1, model: 'jev-1.14.0', window: { size: 12, stride: 4 },
        selection: { phases: ['action', 'report'], startOrdinal: 1, endOrdinal: 12 },
        evidence: { assistantText: true, toolArguments: true, toolResults: false, boardContent: false, boardDelivery: true, artifactChanges: false, privateMemory: false, providerReasoning: false, finalReports: true },
        inputLimits: { singleQuestionTokens: 30000, combinedQuestionTokens: 60000, maxBodyBytes: 30000000, headroomTokens: 4321, estimatorVersion: 'utf8-bytes-conservative-v1' },
        concurrency: 3, timeoutMs: 45000, maxAttempts: 2, retryBaseMs: 2500, longContext: false,
        ...overrides.settings,
    };
    return {
        id: overrides.id ?? 'analysis-a', runId: overrides.runId ?? 'source-run', idempotencyKey: 'key', launchHash: 'hash', ready: true,
        status: overrides.status ?? 'completed', createdAt: overrides.createdAt ?? '2026-11-07T12:00:00Z', updatedAt: '2026-11-07T12:00:01Z',
        cancelRequested: false, fence: 1,
        counters: { preparedWindows: 1, submittedWindows: 1, finishedWindows: 1, failedWindows: 0, skippedWindows: 0, returnedAnswers: 1, expectedAnswers: 1 },
        ...(overrides.error === undefined ? {} : { error: overrides.error }),
        manifest: {
            version: 1,
            source: { runId: overrides.runId ?? 'source-run', configHash: 'config-hash', status: 'completed', sequenceBoundary: 35, eventCount: 35, evidenceHash: 'evidence-hash', normalizerVersion: 'normalizer-v1', ...overrides.source },
            sourceArtifact: 'source-artifact',
            settings, codebook: rev, settingsHash: 'settings-hash',
            staticContext: { version: 'task-policy-v1', hash: 'context-hash' },
            normalizerVersion: 'normalizer-v1', serializationVersion: 'serialization-v1', questionTemplateVersion: 'questions-v1',
            providerAdapterVersion: 'adapter-v1', sdkVersion: '0.7.0',
            diagnostics: (overrides.diagnostics ?? []).map(message => ({ code: 'fixture', message, eventIds: [], severity: 'warning' as const })),
            availability: { assistantText: true, toolArguments: true, toolResults: true, boardContent: true, boardDelivery: true, artifactChanges: false, privateMemory: true, providerReasoning: false, finalReports: true },
            creator: 'Researcher',
        },
    };
};

interface WindowOverrides {
    id?: string; jobId?: string; index?: number; startOrdinal?: number; endOrdinal?: number;
    eventIds?: string[]; stepIds?: string[]; partial?: boolean; incomplete?: boolean;
    status?: WindowRecord['status']; diagnostics?: string[]; results?: JevResult[];
}
export const windowRecord = (overrides: WindowOverrides = {}): WindowRecord & { results?: JevResult[] } => ({
    id: overrides.id ?? 'window-a', jobId: overrides.jobId ?? 'analysis-a', ordinal: 0, index: overrides.index ?? 0,
    startOrdinal: overrides.startOrdinal ?? 1, endOrdinal: overrides.endOrdinal ?? 12,
    stepIds: overrides.stepIds ?? ['step-a'], eventIds: overrides.eventIds ?? ['event-a', 'event-b'],
    partial: overrides.partial ?? false, incomplete: overrides.incomplete ?? false,
    status: overrides.status ?? 'completed', inputRef: 'input-ref', inputHash: 'input-hash',
    inputBytes: 3456, estimatedTokens: 3456, diagnostics: overrides.diagnostics ?? [], batches: [['visibility']],
    ...(overrides.results ? { results: overrides.results } : {}),
});

export const serializedWindow = (window: WindowRecord, overrides: Partial<{ state: string; estimatorVersion: string }> = {}) => ({
    serializationVersion: 'serialization-v1', windowId: window.id,
    state: overrides.state ?? '{"recorded":"source evidence"}', hash: window.inputHash,
    bytes: window.inputBytes, estimatedTokens: window.estimatedTokens,
    estimatorVersion: overrides.estimatorVersion ?? 'utf8-bytes-conservative-v1',
    hasEvidence: true,
    availability: { assistantText: true, toolArguments: true, toolResults: true, boardContent: true, boardDelivery: true, artifactChanges: false, privateMemory: true, providerReasoning: false, finalReports: true },
    selection: {},
});

interface PreviewOverrides { previewHash?: string; runId?: string; windows?: Record<string, unknown>[]; diagnostics?: string[] }
export const previewPayload = (overrides: PreviewOverrides = {}) => ({
    previewHash: overrides.previewHash ?? 'preview',
    runId: overrides.runId ?? 'source-run',
    windowCount: 1, scoredCodeCount: 1, partialWindows: 0, selectedStepCount: undefined,
    evidenceAvailability: { assistantText: true, toolArguments: true, toolResults: false, boardContent: false, boardDelivery: true, artifactChanges: false, privateMemory: false, providerReasoning: false, finalReports: true },
    diagnostics: (overrides.diagnostics ?? []).map(message => ({ code: 'fixture', message, eventIds: [], severity: 'warning' as const })),
    windows: overrides.windows ?? [{
        id: 'preview-window', index: 0, startOrdinal: 1, endOrdinal: 12, partial: true, incomplete: false, hasEvidence: true,
        bytes: 3456, estimatedTokens: 3456,
        budget: { oversized: true, diagnostics: [], batches: [[{ codeId: 'visibility' }]], budget: { estimatorVersion: 'utf8-bytes-conservative-v1', effectiveLimits: { singleQuestionTokens: 30000, combinedQuestionTokens: 60000, headroomTokens: 4321 } } },
    }],
});

export const review = (overrides: Partial<JevReview> = {}): JevReview => ({
    id: 'review-1', analysisId: 'analysis-a', subjectId: 'window-a', scope: 'window', codeId: 'visibility',
    definitionRevision: 'book-revision-1', evidenceRevision: 'evidence-hash', reviewer: 'Reviewer A', identityVerified: false,
    decision: 'uncertain', rationale: 'Missing evidence', eventIds: ['event-a'], stepIds: ['step-a'], predictionsVisible: false,
    revision: 7, createdAt: '2026-11-07T12:00:00Z', ...overrides,
});

export const batch = (overrides: Partial<JevBatch> = {}): JevBatch => ({
    id: 'blind-batch', analysisId: 'analysis-a', createdAt: '2026-11-07T12:00:00Z',
    definitionRevision: 'book-revision-1', evidenceRevision: 'source-hash', populationHash: 'population',
    populationSize: 1, seed: 'seed', randomSize: 1, threshold: 0.7, codeIds: ['visibility'],
    selectedCount: 1, mode: 'blind', ...overrides,
});
