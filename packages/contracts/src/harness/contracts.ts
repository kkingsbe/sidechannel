
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

export interface ModelCapacity {
    modelId: string;
    tokens: number;
    sourceUrl: string;
    verifiedAt: string;
    version: string;
}

/** Explicit opt-in: saved character budgets are never reinterpreted as tokens. */
export interface TokenBudget {
    version: 1;
    unit: 'tokens';
    maxInputTokens: number;
    capacity?: ModelCapacity;
    counting: {
        method: 'utf8-byte-upper-bound';
        version: '1';
        scope: 'messages-and-tool-definitions';
        reservedTokens: number;
    };
}

export interface AdaptionModelCatalog {
    status: 'available' | 'unavailable';
    models: {
        id: string;
        displayName: string;
        capacity: ModelCapacity | null;
        supportedSettings: string[];
        launchable: boolean;
    }[];
    message?: string;
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
    tokenBudget?: TokenBudget;
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
        /** Independent note control, in JavaScript string characters; required for token runs. */
        maxPrivateNoteCharacters?: number;
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

export interface MemorySnapshot {
    version: number;
    notes: string;
    messages: Message[];
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
    /** Researcher metadata frozen when a saved draft is submitted. Never agent input. */
    sourceDraft?: {
        id: string;
        revision: number;
        name?: string;
        notes?: string;
        groupId?: string;
        lineage?: { sourceType: 'draft' | 'run' | 'pair'; sourceId: string; sourceRevision?: number };
    };
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

export interface Actor {
    runId: string;
    agentId: string;
    operationId: string;
}
