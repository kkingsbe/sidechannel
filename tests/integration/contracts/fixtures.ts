import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import type { Run } from '@sidechannel/contracts/harness/contracts';
import { EVIDENCE_CATEGORIES, type AnalysisConfiguration, type EvidenceSelection, type SourceSnapshot } from '@sidechannel/contracts/analysis/evidence-contracts';
import type { AnalysisAttempt, AnalysisJob, WindowRecord } from '@sidechannel/contracts/analysis/jev-repository';
import { emptyCounters } from '@sidechannel/domain/analysis/jev-repository';

export const fixtureConfig = () => resolveConfiguration(defaultFixtureConfiguration());

/** A queued run with a deterministic createdAt so queue ordering is testable. */
export function queuedRun(launchKey: string, overrides: Partial<Run> = {}): Run {
    return { ...createQueuedRun(fixtureConfig(), launchKey), ...overrides };
}

const flags = (value: boolean): EvidenceSelection => Object.fromEntries(EVIDENCE_CATEGORIES.map(category => [category, value])) as EvidenceSelection;

const source = (): SourceSnapshot => ({ runId: 'run-1', configHash: 'config-hash', status: 'completed', sequenceBoundary: 2, eventCount: 2, eventIds: ['event-1', 'event-2'], evidenceHash: 'evidence-hash', normalizerVersion: 'normalizer-v1' });

const settings = (): AnalysisConfiguration => ({ version: 1, model: 'jev-test', window: { size: 2, stride: 1 }, selection: { phases: ['action', 'report'] }, evidence: flags(true), inputLimits: { singleQuestionTokens: 1000, combinedQuestionTokens: 2000, maxBodyBytes: 10000, headroomTokens: 10, estimatorVersion: 'utf8-v1' }, concurrency: 1, timeoutMs: 1000, maxAttempts: 1, retryBaseMs: 0, longContext: false });

export const analysisJob = (id: string): AnalysisJob => ({
    id, runId: 'run-1', idempotencyKey: id, launchHash: 'launch-' + id, createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', ready: true, cancelRequested: false, status: 'queued', fence: 0,
    counters: emptyCounters(),
    manifest: { version: 1, source: source(), sourceArtifact: id + ':source', settings: settings(), codebook: { id: 'revision-1', codebookId: 'codebook-1', revision: 1, createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'tester', definitions: [] }, settingsHash: 'settings-hash', staticContext: { version: 'task-policy-v1', hash: 'context-hash' }, normalizerVersion: 'normalizer-v1', serializationVersion: 'serialization-v1', questionTemplateVersion: 'question-v1', providerAdapterVersion: 'adapter-v1', sdkVersion: 'sdk-v1', diagnostics: [], availability: flags(true), creator: 'tester' },
});

export const analysisWindow = (jobId: string, id = 'window-1'): WindowRecord => ({ id, jobId, ordinal: 0, index: 0, startOrdinal: 0, endOrdinal: 1, stepIds: ['step-1'], eventIds: ['event-1'], partial: false, incomplete: false, status: 'pending', inputRef: jobId + ':input:' + id, inputHash: 'input-hash', inputBytes: 10, estimatedTokens: 10, diagnostics: [], batches: [['code-1']] });

export const analysisAttempt = (jobId: string, windowId = 'window-1'): AnalysisAttempt => ({ id: jobId + ':attempt-1', jobId, windowId, codeIds: ['code-1'], requestRef: jobId + ':request:1', startedAt: '2026-01-01T00:00:00.000Z', status: 'running', requestedModel: 'jev-test' });
