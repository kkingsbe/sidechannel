import { DomainFailure } from '../errors.js';
import type { ProviderUsage } from './jev-provider.js';
import type { AnalysisConfiguration, AnalysisWindow, Codebook, CodebookRevision, Diagnostic, EvidenceAvailability, SourceSnapshot } from './evidence-contracts.js';

export type JobStatus = 'preparing' | 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';

export interface AnalysisManifest {
    version: 1; source: Omit<SourceSnapshot, 'eventIds'>; sourceArtifact: string;
    settings: AnalysisConfiguration; codebook: CodebookRevision; settingsHash: string;
    staticContext: { version: string; hash: string }; normalizerVersion: string; serializationVersion: string;
    questionTemplateVersion: string; providerAdapterVersion: string; sdkVersion: string;
    diagnostics: Diagnostic[]; availability: EvidenceAvailability; creator: string; parentAnalysisId?: string;
}

export interface JobCounters { preparedWindows: number; submittedWindows: number; finishedWindows: number; failedWindows: number; skippedWindows: number; returnedAnswers: number; expectedAnswers: number; }

export interface JobUsage { inputTokens: number | null; outputTokens: number | null; knownInputTokens: number; knownOutputTokens: number; providerAttempts: number; unresolvedAttempts: number; }

export interface AnalysisJob {
    id: string; runId: string; idempotencyKey: string; launchHash: string; manifest: AnalysisManifest;
    status: JobStatus; createdAt: string; updatedAt: string; ready: boolean; cancelRequested: boolean;
    counters: JobCounters; usage?: JobUsage; lease?: { owner: string; fence: number; expiresAt: string }; fence: number; error?: string;
}

export interface WindowRecord extends AnalysisWindow {
    jobId: string; ordinal: number; status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'oversized';
    inputRef: string; inputHash: string; inputBytes: number; estimatedTokens: number;
    diagnostics: string[]; batches: string[][];
}

export interface AnalysisResult { id: string; jobId: string; windowId: string; codeId: string; probability: number; attemptId: string; createdAt: string; }

export interface AnalysisAttempt {
    id: string; jobId: string; windowId: string; codeIds: string[]; requestRef: string; startedAt: string;
    finishedAt?: string; status: 'running' | 'succeeded' | 'failed'; responseRef?: string; error?: string;
    requestedModel: string; returnedModel?: string | null; usage?: ProviderUsage;
}

export interface PageOptions { after?: string; limit?: number; windowId?: string; }

export interface Page<T> { items: T[]; nextCursor: string | null; }

export class AnalysisConflict extends DomainFailure { constructor(message: string) { super('conflict', message); } }

export class AnalysisNotFound extends DomainFailure { constructor(message: string) { super('not-found', message); } }

export class AnalysisValidation extends DomainFailure { constructor(message: string) { super('invalid', message); } }

export class AnalysisPayloadTooLarge extends DomainFailure { constructor(message: string) { super('too-large', message); } }

export interface Lease { jobId: string; owner: string; fence: number; }

/** Codebook authoring and revision history; the codebook editor and codebook routes. */
export interface CodebookStore {
    listCodebooks(page?: PageOptions): Promise<Page<Codebook>>;
    getCodebook(id: string): Promise<Codebook | null>;
    getRevision(id: string, revisionId: string): Promise<CodebookRevision | null>;
    listRevisions(codebookId: string, page?: PageOptions): Promise<Page<CodebookRevision>>;
    saveCodebook(book: Codebook, revision: CodebookRevision, expectedRevision?: string): Promise<void>;
}

/** Job lifecycle and lease protocol: the analysis service, the worker, and the review routes. */
export interface JobLifecycleStore {
    reserveJob(job: AnalysisJob): Promise<{ job: AnalysisJob; created: boolean }>;
    getJob(id: string): Promise<AnalysisJob | null>;
    listJobs(runId: string, page?: PageOptions): Promise<Page<AnalysisJob>>;
    listAllJobs(page?: PageOptions): Promise<Page<AnalysisJob>>;
    claim(owner: string, now: string, leaseMs: number): Promise<{ job: AnalysisJob; lease: Lease } | null>;
    heartbeat(lease: Lease, now: string, leaseMs: number): Promise<boolean>;
    updateCounters(lease: Lease, counters: JobCounters, usage?: JobUsage): Promise<boolean>;
    finishJob(lease: Lease, status: JobStatus, counters: JobCounters, error?: string, usage?: JobUsage): Promise<boolean>;
    cancel(id: string): Promise<AnalysisJob | null>;
    retry(id: string): Promise<AnalysisJob | null>;
}

/** Analysis windows belonging to one job. */
export interface WindowStore {
    putWindow(window: WindowRecord): Promise<void>;
    getWindow(jobId: string, windowId: string): Promise<WindowRecord | null>;
    listWindows(jobId: string, page?: PageOptions): Promise<Page<WindowRecord>>;
    updateWindow(lease: Lease, windowId: string, patch: Partial<Pick<WindowRecord, 'status' | 'diagnostics'>>): Promise<boolean>;
}

/** Immutable chunked blobs: serialized inputs, model responses and exports. */
export interface ArtifactStore {
    putArtifact(id: string, value: unknown): Promise<void>;
    readArtifact<T = unknown>(id: string): Promise<T>;
    artifactChunks(id: string): AsyncIterable<{ index: number; text: string }>;
}

/** Model attempts and their per-window classification results. */
export interface ResultStore {
    startAttempt(lease: Lease, attempt: AnalysisAttempt): Promise<boolean>;
    finishAttempt(lease: Lease, attempt: AnalysisAttempt, results: AnalysisResult[]): Promise<boolean>;
    listResults(jobId: string, page?: PageOptions): Promise<Page<AnalysisResult>>;
    resultsForWindows(jobId: string, windowIds: string[]): Promise<AnalysisResult[]>;
    listAttempts(jobId: string, page?: PageOptions): Promise<Page<AnalysisAttempt>>;
}

/** Everything `AnalysisWorker` touches: leases, windows, artifacts, results. Never codebooks. */
export type AnalysisWorkerStore = JobLifecycleStore & WindowStore & ArtifactStore & ResultStore;

/** Composition of the analysis capability slices used by the analysis service, review routes and contract suites. */
export interface AnalysisRepository extends CodebookStore, JobLifecycleStore, WindowStore, ArtifactStore, ResultStore {
}