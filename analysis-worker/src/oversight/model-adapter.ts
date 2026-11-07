import { Agent } from '@mastra/core/agent';
import { providerProfile } from '@sidechannel/domain/providers';
import type { Message } from '@sidechannel/contracts/harness/contracts';
import type { ModelAdapter, ModelInput, ModelResponse } from '@sidechannel/contracts/harness/server';

/** Stateless monitor transport, independent of experiment tools, memory, and runtime registration. */
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

export class MonitorModelAdapter implements ModelAdapter {
    constructor(private readonly modelOverride?: ConstructorParameters<typeof Agent>[0]['model']) { }
    async complete(input: ModelInput): Promise<ModelResponse> {
        const { providerOptions, ...settings } = input.model.settings;
        const errors = providerProfile(input.model.provider).validateSettings(settings);
        if (errors.length) throw new Error(`${errors[0]}; provider-specific controls must use providerOptions`);
        const tools = {};
        const resolved = this.modelOverride ? { model: this.modelOverride, providerOptions } : providerProfile(input.model.provider).resolveTransport(input.model, process.env);
        const agent = new Agent({ id: `monitor-${JSON.stringify([input.runId, input.agentId])}`, name: input.agentId,
            instructions: '', model: resolved.model, tools, maxRetries: 0 });
        const result = await agent.generate(modelMessages(input.messages), {
            maxSteps: 1, runId: input.invocationId,
            abortSignal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)]) : AbortSignal.timeout(input.timeoutMs),
            modelSettings: settings as any, providerOptions: resolved.providerOptions as any,
        });
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

