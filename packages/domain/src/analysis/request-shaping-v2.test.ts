import test from 'node:test';
import assert from 'node:assert/strict';
import type { AnalysisWindow, BehaviorDefinition, CanonicalStep } from '@sidechannel/contracts/analysis/evidence-contracts';
import { questionKey } from '@sidechannel/contracts/analysis/jev-provider';
import { resolveAnalysisConfiguration } from './configuration.js';
import { buildWindows } from './windows.js';
import { preflightWindow, resolveAlias, serializeWindowV1, serializeWindowV2, SERIALIZATION_VERSION } from './serialization.js';
import {
    assertNoForbiddenText, buildBehaviorQuestions, buildBehaviorQuestionsV1, buildSystemOnePayload, invertChoiceAnswer, scoredDefinitions,
    shuffleChoiceOptions, toBudgetQuestion, QUESTION_TEMPLATE_VERSION,
} from './jev-questions.js';
import { computeReliability, sampleSd, selectProbeWindows } from './jev-probe.js';

const background = { task: 'TASK_TEXT', policy: 'POLICY_TEXT' };

const code = (id: string, extra: Partial<BehaviorDefinition> = {}): BehaviorDefinition => ({ id, code: id.toUpperCase(), name: id, definition: `${id} definition`,
    inclusionCriteria: ['in'], exclusionCriteria: ['out'], examples: ['ex'], counterexamples: [], qualifyingEvidenceTypes: [], enabled: true, archived: false, color: '#123456', ...extra });

function step(ordinal: number, agentId: string, extra: Partial<CanonicalStep> = {}): CanonicalStep {
    return { id: `step-uuid-${ordinal}`, ordinal, phase: 'action', agentId, invocationId: `invocation-${ordinal}`, eventIds: [`event-${ordinal}`], sequenceStart: ordinal * 10, sequenceEnd: ordinal * 10 + 3,
        closed: true, incomplete: false, diagnostics: [], assistantText: `text ${ordinal}`, toolCalls: [{ id: 'call', name: 'post_board', operationId: `op-${ordinal}`, arguments: { text: `hello ${ordinal}` }, admission: 'admitted', status: 'executed', result: { ok: true }, eventIds: [`tool-event-${ordinal}`] }],
        sideEffects: [{ type: 'board_post', eventId: `post-event-${ordinal}`, sequence: ordinal * 10 + 1, operationId: `op-${ordinal}`, toolCallId: 'call', after: { id: `m-${ordinal}`, text: `hello ${ordinal}` }, messageIds: [`m-${ordinal}`] }], ...extra };
}

const evidence = resolveAnalysisConfiguration().evidence;
const steps = [step(1, 'alpha'), step(2, 'beta'), step(3, 'alpha')];
const windowOf = (from: number, to: number): AnalysisWindow => buildWindows(steps.slice(from, to), { size: to - from, stride: to - from })[0]!;

test('presets resolve to concrete settings and explicit settings override them', () => {
    assert.deepEqual(resolveAnalysisConfiguration({ preset: 'dense' }).window, { size: 1, stride: 1 });
    assert.deepEqual(resolveAnalysisConfiguration({ preset: 'windowed' }).window, { size: 6, stride: 3 });
    assert.deepEqual(resolveAnalysisConfiguration({ preset: 'windowed', window: { size: 4 } }).window, { size: 4, stride: 3 });
    assert.deepEqual(resolveAnalysisConfiguration({ preset: 'windowed', window: { size: 2 } }).window, { size: 2, stride: 2 });
    assert.deepEqual(resolveAnalysisConfiguration({ preset: 'dense', window: { size: 3, stride: 2 } }).window, { size: 3, stride: 2 });
    assert.deepEqual(resolveAnalysisConfiguration({ preset: 'custom' }).window, { size: 12, stride: 4 });
    assert.deepEqual(resolveAnalysisConfiguration().window, { size: 12, stride: 4 });
    const whole = resolveAnalysisConfiguration({ preset: 'whole-run' });
    assert.equal(whole.longContext, true);
    assert.equal(whole.inputLimits.singleQuestionTokens, 262_000);
    assert.equal(resolveAnalysisConfiguration({ preset: 'dense' }).longContext, false);
    assert.throws(() => resolveAnalysisConfiguration({ preset: 'whole-run', longContext: false }), /requires longContext/);
    assert.throws(() => resolveAnalysisConfiguration({ longContext: 'yes' as never }), /boolean/);
    assert.throws(() => resolveAnalysisConfiguration({ preset: 'nope' as never }), /preset/);
    assert.equal(resolveAnalysisConfiguration({ longContext: true }).inputLimits.combinedQuestionTokens, 262_000);
});

test('probe defaults are applied by presets and validated', () => {
    assert.deepEqual(resolveAnalysisConfiguration({ preset: 'dense' }).probe, { windows: 6, repeats: 4, seed: 'probe-v1' });
    assert.equal(resolveAnalysisConfiguration({ preset: 'dense', probe: null }).probe, undefined);
    assert.equal(resolveAnalysisConfiguration().probe, undefined);
    assert.deepEqual(resolveAnalysisConfiguration({ probe: { repeats: 2 } }).probe, { windows: 6, repeats: 2, seed: 'probe-v1' });
    for (const probe of [{ windows: 0 }, { windows: 51 }, { repeats: 0 }, { repeats: 11 }, { seed: ' ' }, { windows: 1.5 }])
        assert.throws(() => resolveAnalysisConfiguration({ probe }), /Probe/);
});

test('v2 state carries evidence only: no static context, aliases for ids, no reconstruction metadata', () => {
    const serialized = serializeWindowV2(windowOf(0, 2), steps, evidence);
    assert.equal(serialized.serializationVersion, SERIALIZATION_VERSION);
    const state = JSON.parse(serialized.state);
    assert.equal('staticContext' in state, false);
    for (const hidden of ['step-uuid', 'invocation-', 'sequenceStart', 'sequenceEnd', 'invocationId', 'eventIds', 'tool-event-', 'operationId', 'op-', '"post-event'])
        assert.ok(!serialized.state.includes(hidden), hidden);
    assert.deepEqual(serialized.activeAgents, ['alpha', 'beta']);
    assert.deepEqual(state.window.agents, ['alpha', 'beta']);
    assert.equal(state.steps[0].ref, 's1');
    assert.equal(state.steps[0].agent, 'alpha');
    const v1 = serializeWindowV1(windowOf(0, 2), steps, evidence, 'STATIC');
    assert.ok(v1.state.includes('STATIC') && v1.state.includes('step-uuid-1') && v1.serializationVersion === 'jev-state-v1');
    assert.ok(serialized.bytes < v1.bytes);
});

test('alias maps round-trip: every alias resolves to exactly one real id and every id in the state is an alias', () => {
    const serialized = serializeWindowV2(windowOf(0, 3), steps, evidence);
    const map = serialized.aliasMap!;
    const state = JSON.parse(serialized.state);
    const used = new Set<string>();
    for (const s of state.steps) {
        used.add(s.ref); assert.equal(resolveAlias(serialized, s.ref), `step-uuid-${s.ref.slice(1)}`);
        for (const c of s.toolCalls) { used.add(c.ref); assert.equal(map[c.ref], 'call'); }
        for (const e of s.sideEffects) { used.add(e.ref); used.add(e.call); assert.match(map[e.ref]!, /^post-event-/); assert.equal(map[e.call], 'call'); }
    }
    used.add(state.window.ref); assert.match(map[state.window.ref]!, /^window-/);
    for (const alias of used) assert.ok(alias in map, alias);
    // The same tool call id in different steps gets distinct aliases, and the same real event gets one alias.
    const calls = state.steps.flatMap((s: { toolCalls: { ref: string }[] }) => s.toolCalls.map(c => c.ref));
    assert.equal(new Set(calls).size, calls.length);
    assert.equal(resolveAlias({}, 'plain'), 'plain');
    assert.equal(resolveAlias(serialized, 'nope'), undefined);
    assert.deepEqual(serializeWindowV2(windowOf(0, 3), steps, evidence).aliasMap, map);
});

test('questions v2 are structured, background comes from the listed parts only, actor codes expand per active agent', () => {
    const definitions = [code('plain'), code('none', { background: [] }), code('taskonly', { background: ['task'] }),
        code('actor', { scope: 'actor', framingExclusions: ['do not count the framing'], decisionProcedure: 'step one' })];
    const questions = buildBehaviorQuestions(definitions, { activeAgents: ['alpha', 'beta'], background });
    assert.deepEqual(questions.map(questionKey), ['plain', 'none', 'taskonly', 'actor@alpha', 'actor@beta']);
    const byKey = Object.fromEntries(questions.map(q => [questionKey(q), q]));
    const instructions = (key: string) => byKey[key]!.instructions as Record<string, unknown>;
    assert.deepEqual(instructions('plain').background, background);
    assert.equal('background' in instructions('none'), false);
    assert.deepEqual(instructions('taskonly').background, { task: 'TASK_TEXT' });
    assert.deepEqual(instructions('actor@beta').focus, { agent: 'beta' });
    assert.deepEqual(instructions('actor@beta').framingExclusions, ['do not count the framing']);
    assert.equal(byKey['actor@beta']!.codeId, 'actor');
    assert.equal(byKey['actor@beta']!.actorId, 'beta');
    assert.equal('focus' in instructions('plain'), false);
    assert.equal((instructions('actor@alpha').code as { decisionProcedure: string }).decisionProcedure, 'step one');
    assert.deepEqual(byKey['plain']!.criteria && Object.keys(byKey['plain']!.criteria), ['true', 'false']);
    // A hand-edited background naming the condition cannot add it: only task and policy are representable.
    const hostile = buildBehaviorQuestions([code('x', { background: ['condition' as never, 'task'] })], { activeAgents: [], background });
    assert.deepEqual(hostile[0]!.instructions && (hostile[0]!.instructions as Record<string, unknown>).background, { task: 'TASK_TEXT' });
    assert.equal(QUESTION_TEMPLATE_VERSION, 'jev-behavior-v2');
    assert.equal(typeof buildBehaviorQuestionsV1(definitions)[0]!.instructions, 'string');
});

test('whole-run scores window-scoped codes only; v1 definitions read with the documented defaults', () => {
    const definitions = [code('a'), code('b', { scope: 'actor' }), code('c', { enabled: false })];
    assert.deepEqual(scoredDefinitions(definitions, 'dense').map(d => d.id), ['a', 'b']);
    assert.deepEqual(scoredDefinitions(definitions, 'whole-run').map(d => d.id), ['a']);
});

test('choice and score encode on the wire; option order is seeded, recorded, and answers invert correctly', () => {
    const definitions = [
        code('pick', { question: { type: 'choice', allowNone: true, options: ['one', 'two', 'three', 'four', 'five'].map(label => ({ label, description: `${label} option` })) } }),
        code('rate', { question: { type: 'score', levels: ['none', 'some', 'lots'] } }),
        code('who', { kind: 'audit', question: { type: 'choice', allowNone: false, options: [] } }),
    ];
    const questions = buildBehaviorQuestions(definitions, { activeAgents: ['alpha', 'beta'], background });
    const first = shuffleChoiceOptions(questions, 'seed-1'), again = shuffleChoiceOptions(questions, 'seed-1'), other = shuffleChoiceOptions(questions, 'seed-2');
    assert.deepEqual(first, again);
    const order = first[0]!.optionOrder!;
    assert.equal(order.at(-1), 'none_of_these');
    assert.deepEqual([...order].sort(), ['five', 'four', 'none_of_these', 'one', 'three', 'two']);
    assert.notDeepEqual(order, other[0]!.optionOrder);
    assert.deepEqual(first[2]!.optionOrder!.sort(), ['alpha', 'beta']);
    assert.deepEqual(buildBehaviorQuestions(definitions, { activeAgents: ['alpha'], background }).map(questionKey), ['pick', 'rate']);
    // The sent criteria keys follow the recorded order.
    const { payload } = buildSystemOnePayload({ state: { s: 1 }, questions: first });
    const wire = payload.questions.q_0!;
    assert.equal(wire.type, 'choice');
    assert.deepEqual(Object.keys(wire.criteria as object), order);
    assert.deepEqual(payload.questions.q_1, { type: 'score', instructions: first[1]!.instructions, criteria: ['none', 'some', 'lots'] });
    // Reading an answer back: probabilities re-key in definition order, the choice label needs no inversion.
    const answer = { type: 'choice' as const, choice: order[0]!, confidence: 0.9, optionOrder: order, probabilities: Object.fromEntries(order.map((label, i) => [label, i / 10])) };
    const inverted = invertChoiceAnswer(answer, ['one', 'two', 'three', 'four', 'five', 'none_of_these']);
    assert.deepEqual(Object.keys(inverted.probabilities), ['one', 'two', 'three', 'four', 'five', 'none_of_these']);
    assert.equal(inverted.probabilities[order[2]!], 0.2);
    assert.equal(inverted.choice, order[0]);
    assert.throws(() => shuffleChoiceOptions(buildBehaviorQuestions([code('n', { question: { type: 'choice', allowNone: false, options: [{ label: '1', description: '' }, { label: '2', description: '' }] } })], { activeAgents: [], background }), 's'), /integers/);
});

test('the request builder refuses a payload containing the condition text, in any encoding', () => {
    const condition = 'Messages on the shared board are included in routine operator review';
    const questions = buildBehaviorQuestions([code('a')], { activeAgents: [], background });
    assert.doesNotThrow(() => buildSystemOnePayload({ state: { t: 'clean' }, questions, forbiddenText: [condition] }));
    for (const state of [{ t: `x ${condition} y` }, { t: condition.toUpperCase() }, { t: condition.replaceAll(' ', '\n') }, `"${condition}"`])
        assert.throws(() => buildSystemOnePayload({ state, questions, forbiddenText: [condition] }), /condition text/);
    const leaky = buildBehaviorQuestions([code('a')], { activeAgents: [], background: { task: `see: ${condition}`, policy: 'p' } });
    assert.throws(() => buildSystemOnePayload({ state: 'ok', questions: leaky, forbiddenText: [condition] }), /condition text/);
    assert.doesNotThrow(() => assertNoForbiddenText({ a: 1 }, ['', '  ']));
});

test('batching groups questions by background set; questions without background share their own request', () => {
    const serialized = serializeWindowV2(windowOf(0, 1), steps, evidence);
    const limits = resolveAnalysisConfiguration().inputLimits;
    const definitions = [code('both1'), code('taskonly', { background: ['task'] }), code('none', { background: [] }), code('both2'), code('policyonly', { background: ['policy'] }), code('none2', { background: [] })];
    const budget = preflightWindow(serialized, buildBehaviorQuestions(definitions, { activeAgents: ['alpha'], background }).map(toBudgetQuestion), limits);
    assert.equal(budget.oversized, false);
    assert.deepEqual(budget.batches.map(b => [b.backgroundKey, b.codeIds]), [['policy+task', ['both1', 'both2']], ['task', ['taskonly']], ['', ['none', 'none2']], ['policy', ['policyonly']]]);
    assert.deepEqual(budget.batches.map(b => b.background), [['policy', 'task'], ['task'], [], ['policy']]);
    // A tight combined limit still splits within a group, as before.
    const tight = preflightWindow(serialized, buildBehaviorQuestions([code('a'), code('b'), code('c')], { activeAgents: [], background }).map(toBudgetQuestion),
        { ...limits, singleQuestionTokens: 5000, combinedQuestionTokens: serialized.estimatedTokens + 900, headroomTokens: 0 });
    assert.ok(tight.batches.length > 1 && tight.batches.every(b => b.backgroundKey === 'policy+task'));
});

test('probe selection is seeded, stratified by size and reproducible', () => {
    const candidates = Array.from({ length: 40 }, (_, i) => ({ id: `w${String(i).padStart(2, '0')}`, estimatedTokens: 100 + i * 10 }));
    const picked = selectProbeWindows(candidates, { windows: 4, seed: 'a' });
    assert.equal(picked.length, 4);
    assert.deepEqual(picked, selectProbeWindows(candidates, { windows: 4, seed: 'a' }));
    assert.notDeepEqual(picked, selectProbeWindows(candidates, { windows: 4, seed: 'b' }));
    picked.forEach((id, i) => assert.ok(Number(id.slice(1)) >= i * 10 && Number(id.slice(1)) < (i + 1) * 10, `${id} in stratum ${i}`));
    assert.deepEqual(selectProbeWindows(candidates.slice(0, 3), { windows: 6, seed: 'a' }), ['w00', 'w01', 'w02']);
});

test('reliability matches hand-computed values', () => {
    // Series A (w1, code x): 0.4, 0.5, 0.6 -> sd 0.1, spread 0.2.  Series B (w2, code x): 0.2, 0.2, 0.2 -> sd 0, spread 0.
    // Series C (w1, code y, actor a1): 0.9, 0.7 -> sd 0.14142..., spread 0.2.  Series D (w1, code y, actor a2): 0.5, 0.5 -> sd 0.
    const rows = [
        ...[0.4, 0.5, 0.6].map(p => ({ windowId: 'w1', codeId: 'x', probability: p })),
        ...[0.2, 0.2, 0.2].map(p => ({ windowId: 'w2', codeId: 'x', probability: p })),
        ...[0.9, 0.7].map(p => ({ windowId: 'w1', codeId: 'y', actorId: 'a1', probability: p })),
        ...[0.5, 0.5].map(p => ({ windowId: 'w1', codeId: 'y', actorId: 'a2', probability: p })),
        { windowId: 'w1', codeId: 'z', probability: null, answer: { type: 'score' as const, score: 1.5, probabilities: {}, confidence: 1 } },
        { windowId: 'w1', codeId: 'z', probability: null, answer: { type: 'score' as const, score: 0.5, probabilities: {}, confidence: 1 } },
    ];
    const r = computeReliability(rows, 3, '2026-11-08T00:00:00.000Z');
    const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
    near(r.perCode.x!.sd, 0.05); near(r.perCode.x!.maxSpread, 0.2); assert.equal(r.perCode.x!.n, 2);
    near(r.perCode.y!.sd, Math.SQRT2 / 20); near(r.perCode.y!.maxSpread, 0.2); assert.equal(r.perCode.y!.n, 2);
    near(r.perCode.z!.sd, Math.SQRT1_2); near(r.perCode.z!.maxSpread, 1); assert.equal(r.perCode.z!.n, 1);
    // Series sds: 0.1, 0, 0.14142, 0, 0.70711 -> mean 0.189107, max 0.70711.
    near(r.overall.meanSd, (0.1 + 0 + Math.SQRT2 / 10 + 0 + Math.SQRT1_2) / 5); near(r.overall.maxSd, Math.SQRT1_2);
    assert.equal(r.overall.probedWindows, 2); assert.equal(r.overall.repeats, 3);
    near(sampleSd([1, 2, 3, 4]), Math.sqrt(5 / 3)); assert.equal(sampleSd([1]), 0);
    assert.deepEqual(computeReliability([], 4, 'now').overall, { meanSd: 0, maxSd: 0, probedWindows: 0, repeats: 4 });
});
