import { Agent, type MastraDBMessage } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { Memory } from '@mastra/memory';
import { MongoDBStore } from '@mastra/mongodb';
import { z } from 'zod';
import { NO_TRACE_RUNTIME, type TraceRuntime } from '../mastra/index.js';
import { resolveInferenceProvider } from './inference-provider.js';
import { providerProfile } from '@sidechannel/domain/providers';
import type { Message, MemorySnapshot } from '@sidechannel/contracts/harness/contracts';
import type { ModelAdapter, ModelInput, ModelResponse, PrivateMemory } from '@sidechannel/contracts/harness/server';

export function memoryIdentity(runId: string, agentId: string) {
    const key = JSON.stringify([runId, agentId]);
    return { threadId: `experiment-thread:${key}`, resourceId: `experiment-resource:${key}` };
}

/** There is deliberately no execute, onInputAvailable, provider tool, workspace or native memory. */
export function proposalTools(definitions: ModelInput['tools']) {
    return Object.fromEntries(definitions.map(tool => [tool.name, createTool({
            id: tool.name, description: tool.description, inputSchema: z.fromJSONSchema(tool.parameters),
        })]));
}

function modelMessages(messages: Message[]): any[] {
    return messages.map(message => {
        if (message.role === 'tool')
            return { role: 'tool', content: [{ type: 'tool-result', toolCallId: message.toolCallId,
                        toolName: message.toolName, output: { type: 'text', value: message.content } }] };
        if (message.role === 'assistant' && message.toolCalls?.length)
            return { role: 'assistant', content: [
                    ...(message.content ? [{ type: 'text', text: message.content }] : []),
                    ...message.toolCalls.map(call => ({ type: 'tool-call', toolCallId: call.id, toolName: call.name, input: call.arguments })),
                ] };
        return { role: message.role, content: message.content };
    });
}

export class MastraModelAdapter implements ModelAdapter {
    constructor(private readonly trace: TraceRuntime = NO_TRACE_RUNTIME, private readonly modelOverride?: ConstructorParameters<typeof Agent>[0]['model']) { }
    async complete(input: ModelInput): Promise<ModelResponse> {
        const { providerOptions, ...settings } = input.model.settings;
        const errors = providerProfile(input.model.provider).validateSettings(settings);
        if (errors.length)
            throw new Error(`${errors[0]}; provider-specific controls must use providerOptions`);
        const tools = proposalTools(input.phase === 'report' ? [] : input.tools);
        const resolved = this.modelOverride ? { model: this.modelOverride, providerOptions } : resolveInferenceProvider(input.model);
        const agent = this.trace.register(new Agent({ id: `experiment-${JSON.stringify([input.runId, input.agentId])}`, name: input.agentId,
            instructions: '', model: resolved.model, tools, maxRetries: 0 }), tools);
        const result = await agent.generate(modelMessages(input.messages), {
            maxSteps: 1, runId: input.invocationId,
            abortSignal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)]) : AbortSignal.timeout(input.timeoutMs),
            modelSettings: settings as any, providerOptions: resolved.providerOptions as any,
        });
        await this.trace.verify(result.traceId, result.spanId);
        if (result.error)
            throw result.error;
        const unsupported = result.warnings?.filter((warning: any) => warning.type === 'unsupported-setting');
        if (unsupported?.length)
            throw new Error(`Provider rejected requested settings: ${JSON.stringify(unsupported)}`);
        return { text: result.text, toolCalls: result.toolCalls.map(call => ({ id: call.payload.toolCallId,
                name: call.payload.toolName, arguments: call.payload.args })), usage: result.totalUsage as unknown as Record<string, number>,
            trace: { ...(result.traceId ? { traceId: result.traceId } : {}), ...(result.spanId ? { spanId: result.spanId } : {}), runId: input.invocationId },
            raw: { request: result.request, response: result.response, messages: result.messages, warnings: result.warnings,
                steps: result.steps, finishReason: result.finishReason } };
    }
}

/** Detached Memory avoids native working-memory tools and output-tag auto updates. */
export class MastraPrivateMemory implements PrivateMemory {
    readonly memory: Memory;
    constructor(readonly storage: MongoDBStore, private readonly template = '# Notes\n\n# Next steps\n') {
        this.memory = new Memory({ storage, options: { lastMessages: false, semanticRecall: false,
                observationalMemory: false, workingMemory: { enabled: true, scope: 'thread', template } } });
    }
    async load(runId: string, agentId: string): Promise<MemorySnapshot> {
        const ids = memoryIdentity(runId, agentId);
        const thread = await this.memory.getThreadById({ threadId: ids.threadId });
        if (!thread)
            return { version: 0, notes: this.template, messages: [] };
        if (thread.resourceId !== ids.resourceId)
            throw new Error('Private memory identity mismatch');
        const recalled = await this.memory.recall({ ...ids, perPage: false, orderBy: { field: 'createdAt', direction: 'ASC' } });
        return { version: Number(thread.metadata?.snapshotVersion ?? 0),
            notes: await this.memory.getWorkingMemory(ids) ?? this.template,
            messages: recalled.messages.map(message => JSON.parse(message.content.parts.filter(p => p.type === 'text').map(p => p.text).join('')) as Message) };
    }
    async save(runId: string, agentId: string, snapshot: MemorySnapshot): Promise<void> {
        const ids = memoryIdentity(runId, agentId);
        const thread = await this.memory.getThreadById({ threadId: ids.threadId });
        if (!thread)
            await this.memory.createThread({ ...ids, title: 'Private experiment continuity' });
        else if (thread.resourceId !== ids.resourceId)
            throw new Error('Private memory identity mismatch');
        // Lossless application messages in Mastra conversation storage; deterministic IDs make retries idempotent.
        const messages: MastraDBMessage[] = snapshot.messages.map((message, index) => ({
            id: `${ids.threadId}:message:${index}`, ...ids, createdAt: new Date(index),
            // Memory.saveMessages omits system messages and strips XML working-memory tags.
            // The reversible envelope preserves every original role and literal payload.
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: { format: 2, parts: [{ type: 'text', text: JSON.stringify(message).replace(/</g, '\\u003c') }] },
        }));
        if (messages.length)
            await this.memory.saveMessages({ messages });
        await this.memory.updateWorkingMemory({ ...ids, workingMemory: snapshot.notes });
        await this.memory.updateThread({ id: ids.threadId, metadata: { snapshotVersion: snapshot.version } });
    }
}

export function createMongoMemory(uri: string, dbName = 'sidechannel_mastra') {
    return new MastraPrivateMemory(new MongoDBStore({ id: 'experiment-memory', uri, dbName }));
}