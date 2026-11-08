import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessEvent, MemorySnapshot, NewEvent, Run, ToolCall } from '@sidechannel/contracts/harness/contracts';
import type { PrivateMemory, Scenario } from '@sidechannel/contracts/harness/server';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import type { EventSink } from './event-recorder.js';
import { ScenarioValidationError, fixtureScenario } from './scenario.js';
import { ToolAdmission, type TurnState } from './tool-admission.js';

class FakeSink implements EventSink {
    readonly emitted: { type: string; data: unknown; extra?: Partial<NewEvent> }[] = [];
    persisted = 0;
    evidenceFailed = false;
    failOn?: string;
    async emit(type: string, data: unknown, extra?: Partial<NewEvent>) {
        if (this.failOn === type) { this.evidenceFailed = true; throw new Error('evidence unavailable'); }
        this.emitted.push({ type, data, extra });
        return {} as HarnessEvent;
    }
    async persist() { this.persisted++; }
    types() { return this.emitted.map(entry => entry.type); }
    payloads(type: string) { return this.emitted.filter(entry => entry.type === type).map(entry => entry.data as Record<string, unknown>); }
}

class TestMemory implements PrivateMemory {
    values = new Map<string, MemorySnapshot>();
    async load(runId: string, agentId: string) { return structuredClone(this.values.get(`${runId}/${agentId}`) ?? { version: 0, notes: '', messages: [] }); }
    async save(runId: string, agentId: string, value: MemorySnapshot) { this.values.set(`${runId}/${agentId}`, structuredClone(value)); }
}

const fixtureRun = (): Run => {
    const config = defaultFixtureConfiguration();
    config.scheduler.toolCallsPerTurn = 3;
    return createQueuedRun(resolveConfiguration(config), 'admission-test');
};

const call = (id: string, name = 'post_board', args: unknown = { text: `post-${id}` }): ToolCall => ({ id, name, arguments: args });

interface Setup { run: Run; sink: FakeSink; memory: TestMemory; snapshot: MemorySnapshot; state: TurnState; admission: ToolAdmission }

async function setup(checkpoint: () => Promise<void> = async () => { }, toolCallsPerTurn = 3, scenario: Scenario = fixtureScenario): Promise<Setup> {
    const run = fixtureRun();
    run.config.scheduler.toolCallsPerTurn = toolCallsPerTurn;
    run.remainingAllowance = toolCallsPerTurn;
    run.turn = 1;
    run.activeAgentId = run.config.roles[0]!.id;
    const memory = new TestMemory();
    const snapshot = await memory.load(run.id, run.activeAgentId);
    const sink = new FakeSink();
    const admission = new ToolAdmission({ runId: run.id, run, scenario, memory, recorder: sink, checkpoint });
    return { run, sink, memory, snapshot, state: { ended: false, reason: 'model_step_limit' }, admission };
}

const role = (run: Run) => run.config.roles[0]!;

test('admitted calls charge the allowance, emit results and push one tool message each', async () => {
    const h = await setup();
    await h.admission.handle([call('a'), call('b')], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state);
    assert.deepEqual(h.sink.types(), ['tool_requested', 'tool_requested', 'tool_admitted', 'board_post', 'tool_result', 'tool_admitted', 'board_post', 'tool_result']);
    assert.equal(h.run.remainingAllowance, 1);
    assert.equal(h.run.board.length, 2);
    assert.equal(h.sink.persisted, 2);
    assert.deepEqual(h.sink.payloads('tool_result').map(data => data.disposition), ['executed', 'executed']);
    assert.equal(h.snapshot.messages.length, 2);
    assert.equal(h.state.ended, false);
});

test('an explicit disposition on the result wins over the ok fallback', async () => {
    // `read_board` is allowed but the page is out of range, so the gateway returns `ok: false`
    // without an explicit disposition — admission's fallback must classify it as `invalid`.
    const invalidFallback = await setup();
    await invalidFallback.admission.handle([call('bad-page', 'read_board', { limit: 9999 })], `${invalidFallback.run.id}:turn:1:step:0`, role(invalidFallback.run), invalidFallback.snapshot, invalidFallback.state);
    assert.equal(invalidFallback.sink.payloads('tool_result')[0]!.disposition, 'invalid');
    assert.equal((invalidFallback.sink.payloads('tool_result')[0]!.result as { ok: boolean }).ok, false);

    const deniedScenario: Scenario = { ...fixtureScenario, execute() { throw new ScenarioValidationError('Archive access denied', 'denied'); } };
    const denied = await setup(async () => { }, 3, deniedScenario);
    await denied.admission.handle([call('denied', 'read_role_data', {})], `${denied.run.id}:turn:1:step:0`, role(denied.run), denied.snapshot, denied.state);
    assert.equal(denied.sink.payloads('tool_result')[0]!.disposition, 'denied');
    assert.equal((denied.sink.payloads('tool_result')[0]!.result as { ok: boolean }).ok, false);
});

test('a repeated operation id replays instead of executing and never double-posts', async () => {
    const h = await setup();
    await h.admission.handle([call('same')], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state);
    await h.admission.handle([call('same')], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state);
    assert.equal(h.run.board.length, 1);
    assert.equal(h.sink.types().filter(type => type === 'tool_deduplicated').length, 1);
    assert.equal(h.sink.types().filter(type => type === 'board_post').length, 1);
});

test('a conflicting fingerprint for the same operation id fails as tool_failed', async () => {
    const h = await setup();
    await h.admission.handle([call('same', 'post_board', { text: 'first' })], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state);
    await assert.rejects(h.admission.handle([call('same', 'post_board', { text: 'different' })], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state), /Ambiguous operation identity reuse/);
    assert.equal(h.sink.types().at(-1), 'tool_failed');
    assert.equal(h.run.board.length, 1);
});

test('explicit yield ends the turn and leaves later calls unexecuted with the yield reason', async () => {
    const h = await setup();
    await h.admission.handle([call('yield', 'end_turn', {}), call('later')], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state);
    assert.deepEqual([h.state.ended, h.state.reason], [true, 'explicit_yield']);
    assert.deepEqual(h.sink.payloads('tool_unexecuted').map(data => data.reason), ['explicit_yield']);
    assert.equal(h.run.board.length, 0);
});

test('exhausting the allowance marks the turn budget_exhausted and blocks the remainder', async () => {
    const h = await setup(async () => { }, 1);
    await h.admission.handle([call('a'), call('b')], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state);
    assert.deepEqual([h.state.ended, h.state.reason], [true, 'budget_exhausted']);
    assert.deepEqual(h.sink.payloads('tool_unexecuted').map(data => data.reason), ['budget_exhausted']);
    assert.equal(h.run.board.length, 1);
});

test('a pre-batch checkpoint failure marks every proposed call unexecuted and rethrows', async () => {
    const h = await setup(async () => { throw new Error('CANCELLED'); });
    await assert.rejects(h.admission.handle([call('a'), call('b', 'end_turn', {})], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state), /CANCELLED/);
    assert.deepEqual(h.sink.types(), ['tool_requested', 'tool_requested', 'tool_unexecuted', 'tool_unexecuted']);
    assert.deepEqual(h.sink.payloads('tool_unexecuted').map(data => data.reason), ['CANCELLED', 'CANCELLED']);
    assert.equal(h.run.remainingAllowance, 3);
});

test('a latched evidence failure suppresses the failure fan-out', async () => {
    const h = await setup();
    h.sink.failOn = 'tool_admitted';
    await assert.rejects(h.admission.handle([call('a'), call('b')], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state), /evidence unavailable/);
    assert.deepEqual(h.sink.types(), ['tool_requested', 'tool_requested']);
    assert.equal(h.run.board.length, 0);
});

test('an unexpected tool error marks the failed call and every pending call', async () => {
    const failingScenario: Scenario = { ...fixtureScenario, execute() { throw new Error('Scenario storage unavailable'); } };
    const h = await setup(async () => { }, 3, failingScenario);
    await assert.rejects(h.admission.handle([call('a', 'read_role_data', {}), call('b')], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state), /Scenario storage unavailable/);
    assert.deepEqual(h.sink.types().slice(2), ['tool_admitted', 'tool_failed', 'tool_unexecuted']);
    assert.deepEqual(h.sink.payloads('tool_unexecuted').map(data => data.reason), ['Scenario storage unavailable']);
    assert.equal(h.run.board.length, 0);
});

test('the tool message carries the result and the remaining allowance', async () => {
    const h = await setup();
    await h.admission.handle([call('a')], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state);
    const message = h.snapshot.messages[0]!;
    assert.equal(message.role, 'tool');
    assert.equal(message.toolName, 'post_board');
    assert.equal(message.toolCallId, 'a');
    const content = JSON.parse(message.content) as { result: { ok: boolean; message: { text: string } }; remainingAllowance: number };
    assert.equal(content.result.ok, true);
    assert.equal(content.result.message.text, 'post-a');
    assert.equal(content.remainingAllowance, 2);
    assert.equal(h.run.board[0]!.text, 'post-a');
});
