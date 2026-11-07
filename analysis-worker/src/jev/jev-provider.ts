import { APIConnectionError, APITimeoutError, APIUserAbortError, TypeSafeClient, TypeSafeError, type Fetch } from '@typesafe-ai/sdk';
import { type JevQuestion, type JevRequest, type ProviderFailure, type ProviderUsage, type ProviderAttempt, type JevAnswer, type JevResponse, type JevProvider, JevProviderError } from '@sidechannel/contracts/analysis/jev-provider';
import { buildSystemOnePayload } from '@sidechannel/domain/analysis/jev-questions';

export interface TypeSafeJevProviderOptions { apiKey?: string; timeoutMs?: number; maxAttempts?: number; retryBaseMs?: number; fetch?: Fetch; }

const emptyUsage = (): ProviderUsage => ({ inputTokens: null, outputTokens: null });

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const malformed = (message: string): ProviderFailure => ({ kind: 'malformed_response', message, retryable: false });

export const cancelled = (): ProviderFailure => ({ kind: 'cancelled', message: 'Jev request was cancelled.', retryable: false });

/** Official SDK transport. Application retries are bounded; SDK retries are always zero. */
export class TypeSafeJevProvider implements JevProvider {
    private readonly client: TypeSafeClient;
    private readonly timeoutMs: number;
    private readonly maxAttempts: number;
    private readonly retryBaseMs: number;
    constructor(options: TypeSafeJevProviderOptions = {}) {
        this.timeoutMs = options.timeoutMs ?? 30_000;
        this.maxAttempts = options.maxAttempts ?? 3;
        this.retryBaseMs = options.retryBaseMs ?? 500;
        if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 10 ||
            !Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 900_000 ||
            !Number.isSafeInteger(this.retryBaseMs) || this.retryBaseMs < 0 || this.retryBaseMs > 60_000)
            throw new JevProviderError({ kind: 'invalid_input', message: 'Invalid Jev timeout or retry configuration.', retryable: false });
        const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY ?? process.env.TYPESAFE_AI_API_KEY;
        if (!apiKey?.trim()) throw new JevProviderError({ kind: 'authentication', message: 'Missing TYPESAFE_API_KEY.', retryable: false });
        this.client = new TypeSafeClient({ apiKey, baseURL: 'https://api.typesafe.ai', fetch: options.fetch,
            timeout: this.timeoutMs, retry: { maxRetries: 0 }, logLevel: 'off' });
    }
    async classify(request: JevRequest): Promise<JevResponse> {
        // Build once: retries submit identical evidence and provider question keys.
        const { payload } = buildSystemOnePayload(request);
        const model = payload.model;
        const originalQuestions = structuredClone(request.questions);
        const attempts: ProviderAttempt[] = [];
        for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
            if (request.signal?.aborted) throw new JevProviderError(cancelled(), attempts);
            const entry: ProviderAttempt = { attempt, startedAt: new Date().toISOString(), finishedAt: '', requestedModel: model,
                returnedModel: null, usage: emptyUsage() };
            try {
                const raw: unknown = await this.client.systemOne(payload,
                    { signal: request.signal, timeout: this.timeoutMs, retry: { maxRetries: 0 } });
                entry.rawResponse = raw;
                if (record(raw)) {
                    entry.returnedModel = typeof raw.model === 'string' && raw.model.trim() ? raw.model : null;
                    entry.usage = readUsage(raw.usage);
                }
                const answers = readAnswers(raw, originalQuestions);
                entry.finishedAt = new Date().toISOString();
                if (answers.some(answer => answer.error)) entry.error = malformed('One or more Noul answers were missing or malformed.');
                attempts.push(entry);
                return { requestedModel: model, returnedModel: entry.returnedModel, usage: entry.usage, answers, attempts, rawResponse: raw };
            } catch (error) {
                const failure = mapProviderFailure(error, request.signal);
                entry.error = failure; entry.finishedAt = new Date().toISOString(); attempts.push(entry);
                if (!failure.retryable || attempt === this.maxAttempts) throw new JevProviderError(failure, attempts);
                try { await backoff(Math.min(60_000, this.retryBaseMs * 2 ** (attempt - 1)), request.signal); }
                catch { throw new JevProviderError(cancelled(), attempts); }
            }
        }
        throw new Error('Unreachable Jev retry state.');
    }
}

function readUsage(value: unknown): ProviderUsage {
    if (value === undefined || value === null) return emptyUsage();
    if (!record(value)) throw new JevProviderError(malformed('Jev usage must be an object.'));
    const count = (value: unknown): number | null => {
        if (value === undefined || value === null) return null;
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
            throw new JevProviderError(malformed('Jev token usage must be nonnegative integers or null.'));
        return value;
    };
    return { inputTokens: count(value.input_tokens), outputTokens: count(value.output_tokens) };
}

function readAnswers(value: unknown, questions: JevQuestion[]): JevAnswer[] {
    if (!record(value) || typeof value.model !== 'string' || !value.model.trim() || !record(value.answers))
        throw new JevProviderError(malformed('Jev response requires a model identifier and an answers object.'));
    const answers = value.answers;
    const keys = new Set(questions.map((_, i) => `q_${i}`));
    if (Object.keys(answers).some(key => !keys.has(key))) throw new JevProviderError(malformed('Jev returned an unexpected answer key.'));
    return questions.map((question, i) => {
        const answer = Object.hasOwn(answers, `q_${i}`) ? answers[`q_${i}`] : undefined;
        if (!record(answer) || answer.type !== 'noul' || typeof answer.noul !== 'number' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1)
            return { codeId: question.codeId, probability: null, error: malformed('Missing or invalid Noul probability for this code.') };
        return { codeId: question.codeId, probability: answer.noul };
    });
}

export function mapProviderFailure(error: unknown, signal?: AbortSignal): ProviderFailure {
    if (signal?.aborted || error instanceof APIUserAbortError) return cancelled();
    if (error instanceof JevProviderError) return error.failure;
    const item = record(error) ? error : {};
    const status = typeof item.status === 'number' ? item.status : undefined;
    const context = JSON.stringify(item.body ?? '').includes('max_tokens_exceeded') ||
        (error instanceof Error && error.message.includes('max_tokens_exceeded'));
    if (context || status === 413) return { kind: 'context', message: 'Jev input exceeds provider context or body limits; adjust the window or evidence selection.', retryable: false, status, ...(context ? { code: 'max_tokens_exceeded' } : {}) };
    if (status === 401 || status === 403) return { kind: 'authentication', message: 'TypeSafe authentication or permission failed.', retryable: false, status };
    if (error instanceof APITimeoutError) return { kind: 'timeout', message: 'Jev request timed out.', retryable: true };
    if (status === 408 || status === 429 || (status !== undefined && status >= 500)) return { kind: 'transient', message: 'TypeSafe temporarily rejected or failed the request.', retryable: true, status };
    if (status !== undefined) return { kind: status === 400 || status === 415 || status === 422 ? 'invalid_input' : 'permanent', message: 'TypeSafe rejected the request.', retryable: false, status };
    if (error instanceof SyntaxError) return malformed('Jev returned invalid JSON.');
    if (error instanceof APIConnectionError) return { kind: 'transient', message: 'Connection to TypeSafe failed.', retryable: true };
    if (error instanceof TypeSafeError) return { kind: 'invalid_input', message: 'TypeSafe SDK rejected the request or configuration.', retryable: false };
    return { kind: 'permanent', message: 'Unexpected Jev provider failure.', retryable: false };
}

function backoff(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const abort = (): void => { clearTimeout(timer); reject(new Error('cancelled')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
        if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    });
}