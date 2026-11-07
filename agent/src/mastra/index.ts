import { Mastra } from '@mastra/core/mastra';
import type { Agent } from '@mastra/core/agent';
import type { ToolAction } from '@mastra/core/tools';
import { MongoDBStore } from '@mastra/mongodb';
import { Observability, MastraStorageExporter, SensitiveDataFilter } from '@mastra/observability';
// Starter shell/web/workspace/schedule tools are intentionally unregistered.
export let experimentTraceStorage: MongoDBStore | undefined;
export let mastra = new Mastra({ agents: {}, tools: {} });
let configuredIdentity: string | undefined;
export function configureExperimentRuntime(uri: string, dbName = 'sidechannel_mastra') {
    const identity = JSON.stringify([uri, dbName]);
    if (configuredIdentity === identity)
        return;
    if (configuredIdentity)
        throw new Error('Mastra runtime storage already configured; close it before changing databases');
    experimentTraceStorage = new MongoDBStore({ id: 'experiment-traces', uri, dbName });
    mastra = new Mastra({ agents: {}, tools: {}, storage: experimentTraceStorage,
        observability: new Observability({ configs: { default: { serviceName: 'sidechannel-experiment', logging: { enabled: false },
                    exporters: [new MastraStorageExporter()], spanOutputProcessors: [new SensitiveDataFilter()] } } }) });
    configuredIdentity = identity;
}
export function registerExperimentAgent(agent: Agent, tools: Record<string, ToolAction<any, any, any, any, any>>) {
    for (const [name, tool] of Object.entries(tools)) {
        if (tool.execute)
            throw new Error('Experiment tools must be proposal-only');
        mastra.addTool(tool, name);
    }
    // addAgent skips an existing ID. Each scheduler step supplies a fresh Agent;
    // replace the prior registration so this instance receives storage/tracing.
    // Scheduler calls are serial, and the prior invocation is already flushed.
    mastra.removeAgent(agent.id);
    mastra.addAgent(agent);
    return agent;
}
export async function closeExperimentRuntime() {
    await mastra.observability?.shutdown();
    await experimentTraceStorage?.close();
    configuredIdentity = undefined;
    experimentTraceStorage = undefined;
}
export async function flushExperimentTraces() { await mastra.observability?.flush(); }
/** A successful exporter flush alone does not guarantee Mongo accepted the writes. */
export async function verifyExperimentTrace(traceId?: string, spanId?: string) {
    if (!experimentTraceStorage)
        return; // Scripted/unit callers may deliberately omit persistence.
    if (!traceId || !spanId)
        throw new Error('Native Mastra invocation omitted trace correlation');
    await flushExperimentTraces();
    const store = await experimentTraceStorage.getStore('observability');
    const trace = await store?.getTrace({ traceId });
    const root = trace?.spans.find(span => span.spanId === spanId);
    if (!root?.endedAt)
        throw new Error(`Native Mastra trace was not durably completed: ${traceId}`);
}
