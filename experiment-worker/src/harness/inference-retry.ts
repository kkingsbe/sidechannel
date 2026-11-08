import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Transport-level retry for model requests. Parallel runs share provider rate limits, so a 429 or a
 * 5xx is retried with backoff instead of failing the run. Every retry is recorded as a
 * `model_retry` event before the wait, so the evidence shows exactly which requests repeated.
 * A repeated request may still be billed by the provider.
 */
export interface RetryPolicy {
    /** Total attempts including the first; 1 disables retries. */
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    sleep(ms: number): Promise<void>;
    /** Returns [0, 1); spreads lanes that hit the same rate limit at once. */
    random(): number;
}

export const DEFAULT_INFERENCE_MAX_ATTEMPTS = 5;
const MAX_INFERENCE_ATTEMPTS = 10;

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
    maxAttempts: DEFAULT_INFERENCE_MAX_ATTEMPTS, baseDelayMs: 2_000, maxDelayMs: 60_000,
    sleep: ms => sleep(ms), random: Math.random,
};

export const NO_RETRY_POLICY: RetryPolicy = { ...DEFAULT_RETRY_POLICY, maxAttempts: 1 };

export function inferenceRetryPolicy(env: NodeJS.ProcessEnv = process.env): RetryPolicy {
    const raw = env.INFERENCE_MAX_ATTEMPTS;
    if (raw === undefined || raw === '')
        return DEFAULT_RETRY_POLICY;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > MAX_INFERENCE_ATTEMPTS)
        throw new Error(`INFERENCE_MAX_ATTEMPTS must be an integer from 1 to ${MAX_INFERENCE_ATTEMPTS}`);
    return { ...DEFAULT_RETRY_POLICY, maxAttempts: value };
}

export interface TransientFailure {
    reason: string;
    statusCode?: number;
    retryAfterMs?: number;
}

/** Rate limits, timeouts at the provider edge and server-side failures. */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
const RETRYABLE_NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT']);

type ErrorLike = Record<string, unknown>;
const isObject = (value: unknown): value is ErrorLike => typeof value === 'object' && value !== null;

/** The error and what it wraps: AI SDK `RetryError.lastError`/`errors`, and `cause` chains. */
function chain(error: unknown): ErrorLike[] {
    const seen: ErrorLike[] = [];
    let current: unknown = error;
    while (isObject(current) && seen.length < 6 && !seen.includes(current)) {
        seen.push(current);
        const errors = Array.isArray(current.errors) ? current.errors : undefined;
        current = current.lastError ?? errors?.at(-1) ?? current.cause;
    }
    return seen;
}

function retryAfterMs(headers: unknown): number | undefined {
    if (!isObject(headers))
        return undefined;
    const read = (name: string) => {
        const value = typeof (headers as { get?: unknown }).get === 'function' ? (headers as unknown as Headers).get(name) : headers[name] ?? headers[name.toLowerCase()];
        return typeof value === 'string' ? value : undefined;
    };
    const ms = Number(read('retry-after-ms'));
    if (Number.isFinite(ms) && ms >= 0)
        return ms;
    const after = read('retry-after');
    if (after === undefined)
        return undefined;
    const seconds = Number(after);
    if (Number.isFinite(seconds) && seconds >= 0)
        return seconds * 1_000;
    const date = Date.parse(after);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/**
 * Classifies a failed model request. Only provider/transport failures are transient: the run's
 * own request timeout, cancellation, malformed responses and 4xx request errors are not.
 */
export function transientModelFailure(error: unknown): TransientFailure | undefined {
    const links = chain(error);
    if (!links.length || links.some(link => link.name === 'AbortError'))
        return undefined;
    for (const link of links) {
        const status = typeof link.statusCode === 'number' ? link.statusCode : typeof link.status === 'number' ? link.status : undefined;
        if (status !== undefined) {
            if (!RETRYABLE_STATUS.has(status))
                return undefined;
            const wait = retryAfterMs(link.responseHeaders ?? link.headers);
            return { reason: String(link.message ?? `HTTP ${status}`), statusCode: status, ...(wait === undefined ? {} : { retryAfterMs: wait }) };
        }
    }
    // Prefer the specific socket code from deep in the chain over undici's generic wrapper message.
    const network = links.find(link => typeof link.code === 'string' && RETRYABLE_NETWORK_CODES.has(link.code));
    if (network)
        return { reason: `${String(network.code)}: ${String(network.message ?? 'network error')}` };
    return links.some(link => link.message === 'fetch failed') ? { reason: 'fetch failed' } : undefined;
}

/** Exponential backoff with up to 25% jitter, never shorter than the provider's Retry-After. */
export function retryDelayMs(policy: RetryPolicy, attempt: number, retryAfter?: number): number {
    const backoff = policy.baseDelayMs * 2 ** (attempt - 1);
    const jittered = backoff * (1 + 0.25 * policy.random());
    return Math.round(Math.min(policy.maxDelayMs, Math.max(jittered, retryAfter ?? 0)));
}
