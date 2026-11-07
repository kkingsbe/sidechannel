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

/** Single-worker registration. Registration is a guard, not a heartbeat. */
export interface WorkerGuard {
    acquireWorker(owner: string): Promise<boolean>;
    releaseWorker(owner: string): Promise<void>;
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
