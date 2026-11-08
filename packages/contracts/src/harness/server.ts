import type { Json, ToolDefinition, Role, ExperimentConfig, Message, ToolCall, MemorySnapshot, Run, HarnessEvent, NewEvent, Actor } from './contracts.js';

export interface ModelInput {
    runId: string;
    agentId: string;
    threadId: string;
    resourceId: string;
    invocationId: string;
    phase: 'action' | 'report';
    model: ExperimentConfig['model'];
    messages: Message[];
    tools: ToolDefinition[];
    timeoutMs: number;
    signal?: AbortSignal;
}

export interface ModelResponse {
    text: string;
    toolCalls: ToolCall[];
    usage?: Record<string, number>;
    trace?: Record<string, string>;
    raw?: unknown;
}

export interface ModelAdapter {
    complete(input: ModelInput): Promise<ModelResponse>;
}

export interface PrivateMemory {
    load(runId: string, agentId: string): Promise<MemorySnapshot>;
    save(runId: string, agentId: string, snapshot: MemorySnapshot): Promise<void>;
}

/** Run state: the scheduler's read/write/cas surface. */
export interface RunStateStore {
    getRun(id: string): Promise<Run | null>;
    saveRun(run: Run): Promise<void>;
    claimRun(runId: string, workerId: string): Promise<boolean>;
    /** Cooperative cancellation: the worker uses this on SIGINT/SIGTERM; the API on POST /cancel. */
    requestCancel(id: string): Promise<Run | null>;
}

/** Append-only evidence log. */
export interface EventLog {
    appendEvent(event: NewEvent): Promise<HarnessEvent>;
    listEvents(runId: string, afterSequence?: number, limit?: number): Promise<HarnessEvent[]>;
}

/** Work admission: enqueue and enumerate runs. */
export interface RunQueue {
    createRun(run: Run): Promise<Run>;
    createPair(runs: Run[]): Promise<Run[]>;
    listRuns(): Promise<Run[]>;
}

/** Default time after which a worker that stopped heartbeating is presumed dead and its lease is takeable. */
export const DEFAULT_WORKER_LEASE_MS = 30_000;

/** Default parallel run lanes in the single experiment worker. */
export const DEFAULT_WORKER_CONCURRENCY = 4;
/** Upper bound on `WORKER_CONCURRENCY`; provider rate limits bite long before this. */
export const MAX_WORKER_CONCURRENCY = 16;

/** Snapshot of the single-worker lease. `ageMs` is measured on the store clock and is null for a lease that never heartbeated. */
export interface WorkerLeaseRecord {
    owner: string;
    startedAt?: string;
    heartbeatAt?: string;
    ageMs: number | null;
    /** Run lanes the holder offers; absent on leases written before parallel runs (one lane). */
    capacity?: number;
}

/**
 * Single-worker lease. One process holds it and may execute several runs in parallel lanes. The holder renews a heartbeat; a crashed or killed holder stops renewing, so the
 * lease expires on its own and no manual recovery is needed. Every operation is owner-scoped: only the
 * current holder may renew or release, and a holder that lost the lease learns it from `heartbeatWorker`.
 */
export interface WorkerGuard {
    /** Takes the lease when it is free or its holder's heartbeat is older than `leaseMs`; `capacity` is the holder's run lanes. */
    acquireWorker(owner: string, leaseMs?: number, capacity?: number): Promise<boolean>;
    /** Renews the lease; false means another worker took it over and this one must stop. */
    heartbeatWorker(owner: string): Promise<boolean>;
    releaseWorker(owner: string): Promise<void>;
    workerLease(): Promise<WorkerLeaseRecord | null>;
}

/** Composition of the harness slices used by the API, domain projections and contract tests. */
export interface Repository extends RunStateStore, EventLog, RunQueue, WorkerGuard {
}

export interface Scenario {
    initialize(config: ExperimentConfig): Json;
    initialArtifact?(config: ExperimentConfig): Json;
    initialContext(config: ExperimentConfig, role: Role): string;
    tools(config: ExperimentConfig, role: Role): ToolDefinition[];
    execute(run: Run, actor: Actor, name: string, args: unknown): Json;
    finalize(run: Run): Json;
}
