export type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}
export interface Role {
    id: string;
    instructions: string;
    allowedTools: string[];
}
export interface ExperimentConfig {
    schemaVersion: 1;
    experimentId: string;
    configVersion: string;
    label: string;
    phase: 'development' | 'pilot' | 'study';
    model: {
        provider: string;
        id: string;
        settings: Record<string, Json>;
    };
    condition: {
        id: 'reviewed' | 'excluded';
        version: string;
        text: string;
    };
    roles: Role[];
    scenario: {
        version: string;
        datasetId: string;
        datasetVersion: string;
        datasetSeed: number;
        assets: Json;
        policy: string;
        task: string;
    };
    scheduler: {
        seed: number;
        rounds: number;
        toolCallsPerTurn: number;
        order: string[];
    };
    board: {
        defaultPageSize: number;
        maxPageSize: number;
        maxPostLength: number;
    };
    memory: {
        template: string;
        version: string;
        scope: 'thread';
        semanticRecall: false;
        observationalMemory: false;
        contextBudget: number;
    };
    limits: {
        requestTimeoutMs: number;
        maxModelStepsPerTurn: number;
        reportCalls: number;
        retries: 0;
        maxDurationMs: number;
    };
    artifactSchemaVersion: string;
    reportSchemaVersion: string;
    reportInstructions: string;
    build: {
        revision: string;
        packages: Record<string, string>;
    };
}
export interface Message {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    toolCalls?: ToolCall[];
    toolCallId?: string;
    toolName?: string;
}
export interface ToolCall {
    id: string;
    name: string;
    arguments: unknown;
}
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
export interface MemorySnapshot {
    version: number;
    notes: string;
    messages: Message[];
}
export interface PrivateMemory {
    load(runId: string, agentId: string): Promise<MemorySnapshot>;
    save(runId: string, agentId: string, snapshot: MemorySnapshot): Promise<void>;
}
export type RunStatus = 'queued' | 'running' | 'reporting' | 'stopping' | 'cancelled' | 'completed' | 'failed' | 'interrupted';
export interface BoardMessage {
    id: string;
    runId: string;
    authorId: string;
    sequence: number;
    timestamp: string;
    text: string;
}
export interface ArtifactVersion {
    version: number;
    previousVersion: number | null;
    authorId: string | null;
    value: Json;
    operationId: string;
    frozen: boolean;
}
export interface Run {
    id: string;
    launchKey: string;
    configHash: string;
    pairId?: string;
    pairingSeed?: number;
    pairPosition?: number;
    config: ExperimentConfig;
    status: RunStatus;
    createdAt: string;
    updatedAt: string;
    round: number;
    turn: number;
    activeAgentId?: string;
    remainingAllowance?: number;
    failureReason?: string;
    cancelRequested?: boolean;
    board: BoardMessage[];
    artifacts: ArtifactVersion[];
    reports: {
        agentId: string;
        raw: string;
        parsed: Json | null;
    }[];
    operations: Record<string, {
        fingerprint: string;
        result: Json;
    }>;
    scenarioState: Json;
    usage: Record<string, number>;
}
export interface HarnessEvent {
    schemaVersion: 1;
    id: string;
    runId: string;
    sequence: number;
    type: string;
    timestamp: string;
    agentId?: string;
    round?: number;
    turn?: number;
    invocationId?: string;
    toolCallId?: string;
    operationId?: string;
    data: unknown;
}
export type NewEvent = Omit<HarnessEvent, 'schemaVersion' | 'id' | 'sequence' | 'timestamp'>;
export interface Repository {
    getRun(id: string): Promise<Run | null>;
    saveRun(run: Run): Promise<void>;
    appendEvent(event: NewEvent): Promise<HarnessEvent>;
    listEvents(runId: string, afterSequence?: number, limit?: number): Promise<HarnessEvent[]>;
    listRuns(): Promise<Run[]>;
    createRun(run: Run): Promise<Run>;
    claimRun(runId: string, workerId: string): Promise<boolean>;
}
export interface Actor {
    runId: string;
    agentId: string;
    operationId: string;
}
export interface Scenario {
    initialize(config: ExperimentConfig): Json;
    initialContext(config: ExperimentConfig, role: Role): string;
    tools(config: ExperimentConfig, role: Role): ToolDefinition[];
    execute(run: Run, actor: Actor, name: string, args: unknown): Json;
    finalize(run: Run): Json;
}
