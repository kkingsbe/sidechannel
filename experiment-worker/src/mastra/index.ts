import { Mastra } from '@mastra/core/mastra';
import type { Agent } from '@mastra/core/agent';
import type { ToolAction } from '@mastra/core/tools';
import { MongoDBStore } from '@mastra/mongodb';
import { Observability, MastraStorageExporter, SensitiveDataFilter } from '@mastra/observability';

/** Everything the trace pipeline needs. A value, not module state: two runtimes may coexist. */
export interface TraceRuntime {
    readonly storage: MongoDBStore;
    register(agent: Agent, tools: Record<string, ToolAction<any, any, any, any, any>>): Agent;
    flush(): Promise<void>;
    verify(traceId?: string, spanId?: string): Promise<void>;
    close(): Promise<void>;
}

class MastraTraceRuntime implements TraceRuntime {
    readonly storage: MongoDBStore;
    private readonly mastra: Mastra;
    constructor(uri: string, dbName: string) {
        this.storage = new MongoDBStore({ id: 'experiment-traces', uri, dbName });
        this.mastra = new Mastra({ agents: {}, tools: {}, storage: this.storage,
            observability: new Observability({ configs: { default: { serviceName: 'sidechannel-experiment', logging: { enabled: false },
                        exporters: [new MastraStorageExporter()], spanOutputProcessors: [new SensitiveDataFilter()] } } }) });
    }
    register(agent: Agent, tools: Record<string, ToolAction<any, any, any, any, any>>) {
        for (const tool of Object.values(tools))
            if (tool.execute)
                throw new Error('Experiment tools must be proposal-only');
        for (const [name, tool] of Object.entries(tools)) this.mastra.addTool(tool, name);
        // addAgent skips an existing ID. Each scheduler step supplies a fresh Agent;
        // replace the prior registration so this instance receives storage/tracing.
        // Within a run, scheduler calls are serial and the prior invocation is already flushed.
        // Parallel runs never collide: the agent ID embeds the run ID. Tools are proposal-only and
        // reach the model through the Agent's own tool map, so the shared name registry is inert.
        this.mastra.removeAgent(agent.id);
        this.mastra.addAgent(agent);
        return agent;
    }
    async flush() { await this.mastra.observability?.flush(); }
    /** A successful exporter flush alone does not guarantee Mongo accepted the writes. */
    async verify(traceId?: string, spanId?: string) {
        if (!traceId || !spanId)
            throw new Error('Native Mastra invocation omitted trace correlation');
        await this.flush();
        const store = await this.storage.getStore('observability');
        const trace = await store?.getTrace({ traceId });
        const root = trace?.spans.find(span => span.spanId === spanId);
        if (!root?.endedAt)
            throw new Error(`Native Mastra trace was not durably completed: ${traceId}`);
    }
    async close() { await this.mastra.observability?.shutdown(); await this.storage.close(); }
}

export function openTraceRuntime(uri: string, dbName = 'sidechannel_mastra'): TraceRuntime {
    return new MastraTraceRuntime(uri, dbName);
}

/**
 * Explicit "no tracing" runtime for scripted/unit callers that deliberately omit persistence.
 * It holds no Mastra instance, so it cannot accidentally accumulate registrations.
 */
export const NO_TRACE_RUNTIME: TraceRuntime = {
    storage: undefined as never,
    register: agent => agent,
    flush: async () => {},
    verify: async () => {},
    close: async () => {},
};
