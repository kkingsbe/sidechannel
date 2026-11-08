import test from 'node:test';
import assert from 'node:assert/strict';
import { TypeSafeJevProvider } from './jev-provider.js';
import type { JevRequest } from '@sidechannel/contracts/analysis/jev-provider';

const response = (answers: unknown) => ({ model: 'jev-1.14.0-resolved', answers, usage: { input_tokens: 17, output_tokens: 8 } });

const input = (): JevRequest => ({ state: { s: 1 }, questions: [
    { codeId: 'pick', actorId: 'alpha', type: 'choice', instructions: { task: 'pick' }, options: [{ label: 'a', description: 'A' }, { label: 'b', description: 'B' }], optionOrder: ['b', 'a'] },
    { codeId: 'rate', type: 'score', instructions: { task: 'rate' }, levels: ['low', 'mid', 'high'] },
    { codeId: 'plain', instructions: 'noul' }] });

test('choice and score answers parse into the typed union with null probability; the long-context header is opt-in', async () => {
    const body = response({ q_0: { type: 'choice', choice: 'b', confidence: 0.8, probabilities: { a: 0.1, b: 0.9 } },
        q_1: { type: 'score', score: 1.4, confidence: 0.7, probabilities: { 0: 0.1, 1: 0.5, 2: 0.4 } }, q_2: { type: 'noul', noul: 0.3 } });
    const headers: (string | null)[] = [];
    const run = (longContext?: boolean) => new TypeSafeJevProvider({ apiKey: 'synthetic-key', retryBaseMs: 0, longContext, fetch: async (_url, init) => {
        headers.push(new Headers(init?.headers).get('TypeSafe-Danger-Zone-Long-Context'));
        const sent = JSON.parse(String(init?.body));
        assert.deepEqual(Object.keys(sent.questions.q_0.criteria), ['b', 'a']);
        assert.deepEqual(sent.questions.q_1, { type: 'score', instructions: { task: 'rate' }, criteria: ['low', 'mid', 'high'] });
        return Response.json(body);
    } }).classify(input());
    const result = await run();
    assert.deepEqual(result.answers, [
        { codeId: 'pick', actorId: 'alpha', probability: null, answer: { type: 'choice', choice: 'b', probabilities: { b: 0.9, a: 0.1 }, confidence: 0.8, optionOrder: ['b', 'a'] } },
        { codeId: 'rate', probability: null, answer: { type: 'score', score: 1.4, probabilities: { 0: 0.1, 1: 0.5, 2: 0.4 }, confidence: 0.7 } },
        { codeId: 'plain', probability: 0.3, answer: { type: 'noul', probability: 0.3 } }]);
    await run(true);
    assert.deepEqual(headers, [null, 'true']);
});

test('a choice outside the offered labels, a score outside the rubric, or a mismatched type is a malformed answer', async () => {
    const bad = response({ q_0: { type: 'choice', choice: 'zzz', confidence: 0.8, probabilities: { a: 0.1, b: 0.9 } },
        q_1: { type: 'score', score: 7, confidence: 0.7, probabilities: { 0: 1 } }, q_2: { type: 'choice', choice: 'a' } });
    const result = await new TypeSafeJevProvider({ apiKey: 'synthetic-key', retryBaseMs: 0, maxAttempts: 1, fetch: async () => Response.json(bad) }).classify(input());
    assert.ok(result.answers.every(answer => answer.error && answer.probability === null && answer.answer === undefined));
    assert.equal(result.answers[0]!.actorId, 'alpha');
});
