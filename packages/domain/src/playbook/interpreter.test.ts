import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelInput } from '@sidechannel/contracts/harness/server';
import { PLAYBOOK_FORMAT_VERSION, type Playbook, type PlaybookTurn } from '@sidechannel/contracts/playbook/contracts';
import { interpretPlaybook } from './interpreter.js';

const report = { ownActions: 'a', observations: 'o', limitations: 'l' };
const turn = (...steps: unknown[][]): PlaybookTurn => ({ steps: steps.map(calls => ({ calls: calls as any })) });
const book = (turns: PlaybookTurn[], default_turn?: PlaybookTurn): Playbook => ({ format_version: PLAYBOOK_FORMAT_VERSION, playbook_id: 'p', playbook_version: '1', display_name: 'P', scenario_version: 's', roles: { a: { turns, ...(default_turn ? { default_turn } : {}), report } } });
const tool = (toolName: string, result: unknown) => ({ role: 'tool' as const, toolName, content: JSON.stringify({ result }) });
function input(round: number, step: number, messages: any[] = [], extra: Partial<ModelInput> = {}): ModelInput {
    return { agentId: 'a', phase: 'action', invocationId: `run:a:turn:${round}:step:${step}`, messages: [{ role: 'system', content: `Round: ${round}/3` }, ...messages], tools: [], ...extra } as unknown as ModelInput;
}

test('report phase submits the role report', () => {
    const run = interpretPlaybook(book([]));
    assert.deepEqual(run(input(1, 0, [], { phase: 'report' })), { text: '', toolCalls: [{ id: 'report', name: 'submit_report', arguments: report }] });
});
test('round and step select the scripted calls', () => {
    const run = interpretPlaybook(book([turn([{ name: 'read_board' }], [{ name: 'end_turn' }]), turn([{ name: 'read_artifact', arguments: { x: 1 } }])]));
    assert.equal(run(input(1, 0)).toolCalls[0]!.name, 'read_board');
    assert.equal(run(input(1, 1)).toolCalls[0]!.name, 'end_turn');
    assert.deepEqual(run(input(2, 0)).toolCalls[0], { id: 'r2-s0-c0-read_artifact', name: 'read_artifact', arguments: { x: 1 } });
});
test('default_turn covers later rounds and missing turns end with text', () => {
    assert.equal(interpretPlaybook(book([turn([{ name: 'a_tool' }])], turn([{ name: 'fallback' }])))(input(3, 0)).toolCalls[0]!.name, 'fallback');
    assert.deepEqual(interpretPlaybook(book([]))(input(2, 0)), { text: 'No scripted actions for this round.', toolCalls: [] });
});
test('exhausted steps give a text-only response', () => {
    assert.deepEqual(interpretPlaybook(book([turn([{ name: 'end_turn' }])]))(input(1, 1)), { text: 'Scripted turn complete.', toolCalls: [] });
});
test('$from picks latest, nth, path and default', () => {
    const messages = [tool('read_artifact', { ok: true, value: { version: 1, list: [{ n: 'a' }] } }), tool('read_artifact', { ok: true, value: { version: 2, list: [{ n: 'b' }] } })];
    const run = interpretPlaybook(book([turn([{ name: 't', arguments: {
        latest: { $from: 'read_artifact', $path: 'value.version' }, first: { $from: 'read_artifact', $path: 'value.version', $nth: 0 }, second: { $from: 'read_artifact', $path: 'value.version', $nth: -2 },
        bracket: { $from: 'read_artifact', $path: 'value.list[0].n' }, dotted: { $from: 'read_artifact', $path: 'value.list.0.n', $nth: 0 },
        fallback: { $from: 'nothing', $default: null }, missing: { $from: 'read_artifact', $path: 'value.nope', $default: 'd' }, nested: [{ deep: { $from: 'read_artifact', $path: 'value.version' } }],
    } }])]));
    assert.deepEqual(run(input(1, 0, messages)).toolCalls[0]!.arguments, { latest: 2, first: 1, second: 1, bracket: 'b', dotted: 'a', fallback: null, missing: 'd', nested: [{ deep: 2 }] });
});
test('$from skips failed results', () => {
    const messages = [tool('read_artifact', { ok: true, value: { version: 1 } }), tool('read_artifact', { ok: false, error: 'denied' })];
    const run = interpretPlaybook(book([turn([{ name: 't', arguments: { v: { $from: 'read_artifact', $path: 'value.version' } } }])]));
    assert.deepEqual(run(input(1, 0, messages)).toolCalls[0]!.arguments, { v: 1 });
});
test('$stringify resolves inner values then serialises', () => {
    const run = interpretPlaybook(book([turn([{ name: 't', arguments: { text: { $stringify: { kind: 'k', table: { $from: 'read_role_data', $path: 'value.table' } } } } }])]));
    const args = run(input(1, 0, [tool('read_role_data', { ok: true, value: { table: [1, 2] } })])).toolCalls[0]!.arguments as any;
    assert.deepEqual(JSON.parse(args.text), { kind: 'k', table: [1, 2] });
});
test('unresolved references, unknown operators and missing roles throw', () => {
    const run = interpretPlaybook(book([turn([{ name: 't', arguments: { v: { $from: 'read_artifact', $path: 'value.version' } } }]), turn([{ name: 't', arguments: { $bogus: 1 } }])]));
    assert.throws(() => run(input(1, 0)), /Playbook reference unresolved: read_artifact value\.version/);
    assert.throws(() => run(input(2, 0)), /unknown operator \$bogus/);
    assert.throws(() => run(input(1, 0, [], { agentId: 'zzz' })), /Playbook has no role zzz/);
    assert.throws(() => run({ ...input(1, 0), messages: [] }), /round/);
    assert.throws(() => run({ ...input(1, 0), invocationId: 'x' }), /step/);
});
test('generated ids are unique within a step', () => {
    const run = interpretPlaybook(book([turn([{ name: 'read_board' }, { name: 'read_board' }, { name: 'end_turn' }])]));
    const ids = run(input(1, 0)).toolCalls.map(call => call.id);
    assert.equal(new Set(ids).size, ids.length);
});
