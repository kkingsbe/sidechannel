

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface NoulQuestion { type: 'noul'; instructions: string | null; criteria?: { true: string; false: string }; }

export interface JevQuestion { codeId: string; instructions: string; criteria?: { true: string; false: string }; }

export interface JevRequest { state: JsonValue; questions: JevQuestion[]; model?: string; signal?: AbortSignal; }

export interface ProviderFailure {
    kind: 'authentication' | 'context' | 'invalid_input' | 'transient' | 'timeout' | 'cancelled' | 'malformed_response' | 'permanent';
    message: string; retryable: boolean; status?: number; code?: string;
}

export interface ProviderUsage { inputTokens: number | null; outputTokens: number | null; }

export interface ProviderAttempt {
    attempt: number; startedAt: string; finishedAt: string; requestedModel: string;
    returnedModel: string | null; usage: ProviderUsage; error?: ProviderFailure;
    /** Parsed SDK response body only. Never transport headers or credentials. */
    rawResponse?: unknown;
}

export interface JevAnswer { codeId: string; probability: number | null; error?: ProviderFailure; }

export interface JevResponse {
    requestedModel: string; returnedModel: string | null; usage: ProviderUsage; answers: JevAnswer[]; attempts: ProviderAttempt[];
    rawResponse?: unknown;
}

export interface JevProvider { classify(request: JevRequest): Promise<JevResponse>; }

export interface SystemOnePayload {
    state: string | JsonValue[] | Record<string, JsonValue>;
    model: string;
    questions: Record<string, NoulQuestion>;
}

export class JevProviderError extends Error {
    constructor(readonly failure: ProviderFailure, readonly attempts: ProviderAttempt[] = []) {
        super(failure.message); this.name = 'JevProviderError';
    }
}

