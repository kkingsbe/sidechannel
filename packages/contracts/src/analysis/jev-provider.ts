

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Wire question shapes accepted by `systemOne`. Instructions may be text or a JSON object of named fields. */
export interface NoulQuestion { type: 'noul'; instructions: JsonValue; criteria?: { true: string; false: string }; }

export interface ChoiceQuestion { type: 'choice'; instructions: JsonValue; criteria: Record<string, string | null>; }

export interface ScoreQuestion { type: 'score'; instructions: JsonValue; criteria: string[]; }

export type SystemOneQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

/**
 * A question the pipeline asks about a window. `type` defaults to `noul`. `actorId` is set for
 * actor-scoped codes, where one question is generated per active agent. `optionOrder` records the
 * shuffled label order sent for a `choice` question so answers can be mapped back.
 */
export interface JevQuestion {
    codeId: string; actorId?: string; type?: 'noul' | 'choice' | 'score';
    instructions: JsonValue; criteria?: { true: string; false: string };
    options?: { label: string; description: string | null }[]; optionOrder?: string[]; levels?: string[];
}

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

/** Typed answer payloads mirrored from the SDK response shapes (spec section 10). */
export type JevAnswerValue =
    | { type: 'noul'; probability: number }
    | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number; optionOrder: string[] }
    | { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number };

/** `probability` is populated for `noul` answers and null otherwise; `answer` carries the typed value when the request succeeded. */
export interface JevAnswer { codeId: string; actorId?: string; probability: number | null; answer?: JevAnswerValue; error?: ProviderFailure; }

export interface JevResponse {
    requestedModel: string; returnedModel: string | null; usage: ProviderUsage; answers: JevAnswer[]; attempts: ProviderAttempt[];
    rawResponse?: unknown;
}

export interface JevProvider { classify(request: JevRequest): Promise<JevResponse>; }

export interface SystemOnePayload {
    state: string | JsonValue[] | Record<string, JsonValue>;
    model: string;
    questions: Record<string, SystemOneQuestion>;
}

export class JevProviderError extends Error {
    constructor(readonly failure: ProviderFailure, readonly attempts: ProviderAttempt[] = []) {
        super(failure.message); this.name = 'JevProviderError';
    }
}

