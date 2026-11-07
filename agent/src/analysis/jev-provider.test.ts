import test from 'node:test';
import assert from 'node:assert/strict';
import { APIError } from '@typesafe-ai/sdk';
import { TypeSafeJevProvider, JevProviderError, buildBehaviorQuestions, buildSystemOnePayload, mapProviderFailure, type JevRequest } from './jev-provider.js';
import type { BehaviorDefinition } from './evidence-contracts.js';

const request = (): JevRequest => ({ state: { steps: [{ text: 'synthetic evidence' }] },
    questions: [{ codeId: 'alpha', instructions: 'Does alpha occur?' }, { codeId: 'beta', instructions: 'Does beta occur?' }] });
const response = (answers: unknown = { q_0: { type: 'noul', noul: 0.8 }, q_1: { type: 'noul', noul: 0 } }) =>
    ({ model: 'jev-1.14.0-resolved', answers, usage: { input_tokens: 17, output_tokens: 8 } });
const provider = (fetch: (url: string, init?: RequestInit) => Promise<Response>, options: { maxAttempts?: number; timeoutMs?: number; retryBaseMs?: number } = {}) =>
    new TypeSafeJevProvider({ apiKey: 'synthetic-key', fetch, retryBaseMs: 0, ...options });

test('official SDK sends one Noul per code and preserves model, exact state, usage and zero probabilities', async () => {
    let calls = 0;
    const input = request();
    input.model = 'jev-custom-alias';
    input.questions[0].criteria = { true: 'An occurrence', false: 'None' };
    const result = await provider(async (url, init) => {
        calls++;
        assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-key');
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(body.state, input.state);
        assert.equal(body.model, 'jev-custom-alias');
        assert.deepEqual(body.questions.q_0, { type: 'noul', instructions: 'Does alpha occur?', criteria: input.questions[0].criteria });
        assert.equal(body.questions.q_1.type, 'noul');
        assert.equal(body.long_context, undefined);
        return Response.json(response());
    }).classify(input);
    assert.equal(calls, 1);
    assert.equal(result.requestedModel, 'jev-custom-alias');
    assert.equal(result.returnedModel, 'jev-1.14.0-resolved');
    assert.deepEqual(result.usage, { inputTokens: 17, outputTokens: 8 });
    assert.deepEqual(result.answers, [{ codeId: 'alpha', probability: 0.8 }, { codeId: 'beta', probability: 0 }]);
    assert.equal(result.attempts.length, 1);
    assert.deepEqual(result.rawResponse, response());
    assert.deepEqual(result.attempts[0].rawResponse, response());
    assert.ok(result.attempts[0].finishedAt);
    assert.ok(!JSON.stringify(result).includes('synthetic-key'));
});

test('exact systemOne payload artifact matches official SDK JSON and maps provider keys to code identities', async () => {
    const input = request();
    input.questions[0].criteria = { true: 'present', false: 'absent' };
    const systemOne = buildSystemOnePayload(input);
    assert.deepEqual(systemOne.keyMap, { q_0: 'alpha', q_1: 'beta' });
    assert.equal(systemOne.payload.questions.q_1.criteria, undefined);
    assert.ok(!JSON.stringify(systemOne).includes('synthetic-key'));
    await provider(async (_url, init) => {
        assert.equal(String(init?.body), JSON.stringify(systemOne.payload));
        return Response.json(response());
    }).classify(input);
    input.state = 'later mutation';
    input.questions[0].instructions = 'later mutation';
    assert.deepEqual(systemOne.payload.state, { steps: [{ text: 'synthetic evidence' }] });
    assert.equal(systemOne.payload.questions.q_0.instructions, 'Does alpha occur?');
});

test('malformed successful HTTP bodies remain in failure provenance with original provider answer keys', async () => {
    const raw = { ...response({ q_0: { type: 'noul', noul: 'bad-value' }, unexpected: { type: 'noul', noul: 0.2 } }), extension: 'retained' };
    await assert.rejects(provider(async () => Response.json(raw)).classify(request()), (error: unknown) => {
        assert.ok(error instanceof JevProviderError);
        assert.deepEqual(error.attempts[0].rawResponse, raw);
        return true;
    });
});

test('missing/malformed answers fail affected codes while valid siblings survive', async () => {
    for (const bad of [undefined, null, { type: 'choice', noul: 0.5 }, { type: 'noul', noul: '0.5' },
        { type: 'noul', noul: -0.1 }, { type: 'noul', noul: 1.01 }, { type: 'noul', noul: null }]) {
        const answers = { q_0: { type: 'noul', noul: 1 }, ...(bad === undefined ? {} : { q_1: bad }) };
        const result = await provider(async () => Response.json(response(answers))).classify(request());
        assert.equal(result.answers[0].probability, 1);
        assert.equal(result.answers[1].probability, null);
        assert.equal(result.answers[1].error?.kind, 'malformed_response');
        assert.equal(result.attempts.length, 1);
        assert.equal(result.attempts[0].error?.kind, 'malformed_response');
    }
});

test('unexpected keys and malformed envelopes fail without retry', async () => {
    for (const body of [null, {}, { ...response(), model: '' }, response([]), response({ unexpected: { type: 'noul', noul: 0 } }),
        { ...response(), usage: { input_tokens: '17' } }]) {
        let calls = 0;
        await assert.rejects(provider(async () => { calls++; return Response.json(body); }).classify(request()),
            (error: unknown) => error instanceof JevProviderError && error.failure.kind === 'malformed_response' && error.attempts.length === 1);
        assert.equal(calls, 1);
    }
    await assert.rejects(provider(async () => new Response('{bad json')).classify(request()),
        (error: unknown) => error instanceof JevProviderError && error.failure.kind === 'malformed_response');
});

test('absent usage remains null rather than a billing estimate', async () => {
    const result = await provider(async () => Response.json({ model: 'jev-1.14.0', answers: response().answers })).classify(request());
    assert.deepEqual(result.usage, { inputTokens: null, outputTokens: null });
});

test('finite application retries do not multiply SDK retries', async () => {
    let calls = 0;
    const result = await provider(async () => {
        calls++;
        return calls < 3 ? Response.json({ error: 'overloaded' }, { status: 529 }) : Response.json(response());
    }).classify(request());
    assert.equal(calls, 3);
    assert.equal(result.attempts.length, 3);
    assert.deepEqual(result.attempts.map(attempt => attempt.error?.kind), ['transient', 'transient', undefined]);
    calls = 0;
    await assert.rejects(provider(async () => { calls++; return Response.json({}, { status: 429 }); }, { maxAttempts: 2 }).classify(request()),
        (error: unknown) => error instanceof JevProviderError && error.failure.retryable && error.attempts.length === 2);
    assert.equal(calls, 2);
});

test('retries retain the exact original evidence and question even if a caller mutates them', async () => {
    const input = request();
    let calls = 0;
    const result = await provider(async (_url, init) => {
        calls++;
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(body.state, { steps: [{ text: 'synthetic evidence' }] });
        assert.equal(body.questions.q_0.instructions, 'Does alpha occur?');
        if (calls === 1) {
            input.state = 'mutated';
            input.questions[0].instructions = 'mutated';
            input.questions[0].codeId = 'changed';
            return Response.json({}, { status: 529 });
        }
        return Response.json(response());
    }).classify(input);
    assert.equal(result.answers[0].codeId, 'alpha');
    assert.equal(calls, 2);
});

test('authentication, input and context errors are permanent and carry safe status/code metadata', async () => {
    for (const [status, body, kind] of [[401, { error: 'secret-body' }, 'authentication'], [403, {}, 'authentication'],
        [400, { error: { code: 'max_tokens_exceeded' } }, 'context'], [413, {}, 'context'],
        [422, {}, 'invalid_input'], [415, {}, 'invalid_input'], [404, {}, 'permanent']] as const) {
        let calls = 0;
        await assert.rejects(provider(async () => { calls++; return Response.json(body, { status }); }).classify(request()), (error: unknown) => {
            assert.ok(error instanceof JevProviderError);
            assert.equal(error.failure.kind, kind);
            assert.equal(error.failure.retryable, false);
            assert.equal(error.failure.status, status);
            assert.ok(!JSON.stringify(error).includes('secret-body'));
            return true;
        });
        assert.equal(calls, 1);
    }
});

test('network failures and timeouts retry within the explicit budget', async () => {
    let calls = 0;
    await assert.rejects(provider(async () => { calls++; throw new TypeError('synthetic network failure'); }, { maxAttempts: 2 }).classify(request()),
        (error: unknown) => error instanceof JevProviderError && error.failure.kind === 'transient' && error.attempts.length === 2);
    assert.equal(calls, 2);
    calls = 0;
    await assert.rejects(provider(async (_url, init) => {
        calls++;
        return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
    }, { maxAttempts: 2, timeoutMs: 10 }).classify(request()),
    (error: unknown) => error instanceof JevProviderError && error.failure.kind === 'timeout' && error.attempts.length === 2);
    assert.equal(calls, 2);
});

test('cancellation stops in-flight requests and backoff without another call', async () => {
    const controller = new AbortController();
    let calls = 0;
    const pending = provider(async (_url, init) => {
        calls++;
        queueMicrotask(() => controller.abort());
        return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
    }).classify({ ...request(), signal: controller.signal });
    await assert.rejects(pending, (error: unknown) => error instanceof JevProviderError && error.failure.kind === 'cancelled');
    assert.equal(calls, 1);
    const already = new AbortController(); already.abort();
    await assert.rejects(provider(async () => { throw new Error('must not fetch'); }).classify({ ...request(), signal: already.signal }),
        (error: unknown) => error instanceof JevProviderError && error.failure.kind === 'cancelled' && !error.attempts.length);
    const waiting = new AbortController();
    calls = 0;
    const backoff = provider(async () => { calls++; setTimeout(() => waiting.abort(), 10); return Response.json({}, { status: 429 }); },
        { retryBaseMs: 10_000 }).classify({ ...request(), signal: waiting.signal });
    await assert.rejects(backoff, (error: unknown) => error instanceof JevProviderError && error.failure.kind === 'cancelled');
    assert.equal(calls, 1);
});

test('invalid requests fail before transport and no credentials are required for imports', async () => {
    const invalid = request(); invalid.questions[1].codeId = 'alpha';
    await assert.rejects(provider(async () => { throw new Error('must not fetch'); }).classify(invalid),
        (error: unknown) => error instanceof JevProviderError && error.failure.kind === 'invalid_input');
    await assert.rejects(provider(async () => { throw new Error('must not fetch'); }).classify({ ...request(), state: { invalid: Infinity } }),
        (error: unknown) => error instanceof JevProviderError && error.failure.kind === 'invalid_input');
    assert.throws(() => new TypeSafeJevProvider({ apiKey: '', maxAttempts: 0 }), JevProviderError);
    assert.equal(mapProviderFailure(new APIError(400, { detail: { code: 'max_tokens_exceeded' } }, new Headers())).kind, 'context');
});

test('behavior questions include the complete enabled definition and distinguish trace instructions', () => {
    const code: BehaviorDefinition = { id: 'stable', code: 'PROPOSE', name: 'Proposal', definition: 'Complete definition',
        inclusionCriteria: ['included'], exclusionCriteria: ['excluded'], examples: ['positive'], counterexamples: ['negative'],
        qualifyingEvidenceTypes: ['boardContent'], enabled: true, archived: false, color: '#123456' };
    const questions = buildBehaviorQuestions([code, { ...code, id: 'off', enabled: false }, { ...code, id: 'old', archived: true }]);
    assert.equal(questions.length, 1);
    assert.equal(questions[0].codeId, 'stable');
    for (const text of ['Complete definition', 'included', 'excluded', 'positive', 'negative', 'boardContent', 'at least one occurrence', 'not instructions'])
        assert.ok(questions[0].instructions.includes(text));
});

