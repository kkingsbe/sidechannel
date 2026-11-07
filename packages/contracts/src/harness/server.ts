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

export interface Repository {
    getRun(id: string): Promise<Run | null>;
    saveRun(run: Run): Promise<void>;
    appendEvent(event: NewEvent): Promise<HarnessEvent>;
    listEvents(runId: string, afterSequence?: number, limit?: number): Promise<HarnessEvent[]>;
    listRuns(): Promise<Run[]>;
    createRun(run: Run): Promise<Run>;
    claimRun(runId: string, workerId: string): Promise<boolean>;
}

export interface Scenario {
    initialize(config: ExperimentConfig): Json;
    initialArtifact?(config: ExperimentConfig): Json;
    initialContext(config: ExperimentConfig, role: Role): string;
    tools(config: ExperimentConfig, role: Role): ToolDefinition[];
    execute(run: Run, actor: Actor, name: string, args: unknown): Json;
    finalize(run: Run): Json;
}
