import type { Message, Role, Run } from '@sidechannel/contracts/harness/contracts';
import type { ModelAdapter, ModelInput, ModelResponse, Scenario } from '@sidechannel/contracts/harness/server';
import { measureModelInput } from '@sidechannel/domain/harness/token-budget';
import { usageSource } from '@sidechannel/domain/providers';
import type { EventSink } from './event-recorder.js';
import { toolCatalog } from './gateway.js';

export interface Inferencer {
    infer(input: ModelInput): Promise<ModelResponse>;
}

export interface InferenceGatewayOptions {
    runId: string;
    run: Run;
    adapter: ModelAdapter;
    recorder: EventSink;
    /** Cancellation and run-duration checkpoint, owned by the scheduler. */
    checkpoint: () => Promise<void>;
    /** `Date.now()` when the run started; the timeout clamp is measured from here. */
    startedAt: number;
}

/**
 * One model request: budget measurement, context-limit event, timeout clamp and race,
 * abort, response-shape validation, response/usage events and usage accumulation.
 * Moved verbatim from `HarnessScheduler.run()`'s `infer` closure.
 */
export class InferenceGateway implements Inferencer {
    constructor(private readonly options: InferenceGatewayOptions) { }

    async infer(input: ModelInput): Promise<ModelResponse> {
        const { run, adapter, recorder } = this.options;
        await this.options.checkpoint();
        const accounting = measureModelInput(input, run.config);
        await recorder.emit('context_accounted', { phase: input.phase, ...accounting }, { invocationId: input.invocationId });
        if (accounting.exceeds) {
            await recorder.emit('context_limit_exceeded', { phase: input.phase, ...accounting }, { invocationId: input.invocationId });
            throw new Error(`${input.phase} context budget exceeded (${accounting.unit}); no silent trimming`);
        }
        await recorder.emit('model_requested', input, { invocationId: input.invocationId });
        input.timeoutMs = Math.max(1, Math.min(input.timeoutMs, run.config.limits.maxDurationMs - (Date.now() - this.options.startedAt)));
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const response = await Promise.race([adapter.complete({ ...input, signal: controller.signal }), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Model request timeout')); }, input.timeoutMs); })]);
            if (!response || typeof response.text !== 'string' || !Array.isArray(response.toolCalls))
                throw new Error('Unparseable model response');
            await recorder.emit('model_response', response, { invocationId: input.invocationId });
            await recorder.emit('model_usage', { phase: input.phase, provider: input.model.provider,
                source: response.usage ? usageSource(input.model.provider) : 'unavailable',
                usage: response.usage ?? null, inputAccounting: accounting }, { invocationId: input.invocationId });
            for (const [k, v] of Object.entries(response.usage ?? {}))
                if (typeof v === 'number' && Number.isFinite(v))
                    run.usage[k] = (run.usage[k] ?? 0) + v;
            return response;
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
}

/** Pure input factory shared by the action loop and the report phase; `report` sends no tools. */
export function modelInputFor(run: Run, runId: string, scenario: Scenario, role: Role, messages: Message[], phase: 'action' | 'report', invocationId: string): ModelInput {
    return { runId, agentId: role.id, threadId: `experiment-thread:${JSON.stringify([runId, role.id])}`, resourceId: `experiment-resource:${JSON.stringify([runId, role.id])}`, invocationId, phase, model: run.config.model, messages, tools: phase === 'report' ? [] : toolCatalog(run, role, scenario), timeoutMs: run.config.limits.requestTimeoutMs };
}
