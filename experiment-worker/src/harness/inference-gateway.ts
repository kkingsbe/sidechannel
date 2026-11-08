import type { Message, Role, Run } from '@sidechannel/contracts/harness/contracts';
import type { ModelAdapter, ModelInput, ModelResponse, Scenario } from '@sidechannel/contracts/harness/server';
import { measureModelInput } from '@sidechannel/domain/harness/token-budget';
import { usageSource } from '@sidechannel/domain/providers';
import type { EventSink } from './event-recorder.js';
import { reportToolCatalog, toolCatalog } from './gateway.js';
import { DEFAULT_RETRY_POLICY, retryDelayMs, transientModelFailure, type RetryPolicy } from './inference-retry.js';

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
    /** Transport retries for rate limits and provider failures; each one is a `model_retry` event. */
    retry?: RetryPolicy;
}

/**
 * One model request: budget measurement, context-limit event, timeout clamp and race,
 * abort, response-shape validation, response/usage events and usage accumulation, plus
 * logged transport retries for transient provider failures (see `inference-retry.ts`).
 */
/** Marks a failure raised by the provider call itself, so evidence-store errors are never retried. */
class ProviderAttemptFailure {
    constructor(readonly error: unknown) { }
}

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
        const policy = this.options.retry ?? DEFAULT_RETRY_POLICY;
        const requestedTimeoutMs = input.timeoutMs;
        for (let attempt = 1; ; attempt++) {
            try {
                return await this.attempt(input, requestedTimeoutMs, accounting);
            }
            catch (thrown) {
                if (!(thrown instanceof ProviderAttemptFailure))
                    throw thrown;
                const { error } = thrown;
                const transient = transientModelFailure(error);
                const remainingMs = run.config.limits.maxDurationMs - (Date.now() - this.options.startedAt);
                const delayMs = transient ? retryDelayMs(policy, attempt, transient.retryAfterMs) : 0;
                if (!transient || attempt >= policy.maxAttempts || delayMs >= remainingMs)
                    throw error;
                await recorder.emit('model_retry', { phase: input.phase, provider: input.model.provider, attempt, nextAttempt: attempt + 1, maxAttempts: policy.maxAttempts,
                    delayMs, reason: transient.reason, ...(transient.statusCode === undefined ? {} : { statusCode: transient.statusCode }),
                    ...(transient.retryAfterMs === undefined ? {} : { retryAfterMs: transient.retryAfterMs }) }, { invocationId: input.invocationId });
                await policy.sleep(delayMs);
                await this.options.checkpoint();
            }
        }
    }

    /** One provider request; the timeout is re-clamped to the run's remaining duration each attempt. */
    private async attempt(input: ModelInput, requestedTimeoutMs: number, accounting: ReturnType<typeof measureModelInput>): Promise<ModelResponse> {
        const { run, adapter, recorder } = this.options;
        input.timeoutMs = Math.max(1, Math.min(requestedTimeoutMs, run.config.limits.maxDurationMs - (Date.now() - this.options.startedAt)));
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const response = await Promise.race([adapter.complete({ ...input, signal: controller.signal }), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Model request timeout')); }, input.timeoutMs); })])
                .catch((error: unknown) => { throw new ProviderAttemptFailure(error); });
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

/** Pure input factory shared by the action loop and the report phase; `report` sends only the submit_report tool. */
export function modelInputFor(run: Run, runId: string, scenario: Scenario, role: Role, messages: Message[], phase: 'action' | 'report', invocationId: string): ModelInput {
    return { runId, agentId: role.id, threadId: `experiment-thread:${JSON.stringify([runId, role.id])}`, resourceId: `experiment-resource:${JSON.stringify([runId, role.id])}`, invocationId, phase, model: run.config.model, messages, tools: phase === 'report' ? reportToolCatalog() : toolCatalog(run, role, scenario), timeoutMs: run.config.limits.requestTimeoutMs };
}
