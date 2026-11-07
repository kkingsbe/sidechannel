import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultFixtureConfiguration, resolveConfiguration, resolvePair, assertPairEquivalent, validateConfiguration } from './config.js';
import { createQueuedRun } from './scheduler.js';
test('configuration freezes independently of mutable draft and matched order is identical', () => { const draft = defaultFixtureConfiguration(); const frozen = resolveConfiguration(draft); draft.roles[0]!.instructions = 'changed'; assert.notEqual(frozen.roles[0]!.instructions, 'changed'); assert.throws(() => { frozen.scheduler.rounds = 9; }); const [a, b] = resolvePair(defaultFixtureConfiguration()); assertPairEquivalent(a, b); assert.deepEqual(a.scheduler.order, b.scheduler.order); assert.notEqual(a.condition.text, b.condition.text); });
test('invalid settings fail closed', () => { const draft = defaultFixtureConfiguration(); draft.memory.semanticRecall = true as false; draft.scheduler.rounds = 0; assert.equal(validateConfiguration(draft).valid, false); assert.throws(() => resolveConfiguration(draft)); });
test('fresh run state and identities', () => { const c = resolveConfiguration(defaultFixtureConfiguration()); const a = createQueuedRun(c, 'a'); const b = createQueuedRun(c, 'b'); a.board.push({ id: 'x', runId: a.id, authorId: 'alpha', sequence: 1, timestamp: 'now', text: 'x' }); assert.notEqual(a.id, b.id); assert.equal(b.board.length, 0); assert.equal(b.artifacts[0]?.version, 0); });
import { HarnessScheduler } from './scheduler.js';
import { InMemoryRepository } from './repository.js';
import { ScriptedAdapter } from './scripted-adapter.js';
import type { PrivateMemory, MemorySnapshot, ModelResponse, NewEvent } from './contracts.js';
class TestMemory implements PrivateMemory {
    values = new Map<string, MemorySnapshot>();
    async load(r: string, a: string) { return structuredClone(this.values.get(`${r}/${a}`) ?? { version: 0, notes: '', messages: [] }); }
    async save(r: string, a: string, s: MemorySnapshot) { this.values.set(`${r}/${a}`, structuredClone(s)); }
}
async function harness(script: (input: import('./contracts.js').ModelInput, index: number) => ModelResponse | Promise<ModelResponse>, repo = new InMemoryRepository(), mutate?: (c: ReturnType<typeof defaultFixtureConfiguration>) => void) { const draft = defaultFixtureConfiguration(); mutate?.(draft); const run = createQueuedRun(resolveConfiguration(draft), 'test'); await repo.createRun(run); const memory = new TestMemory(); const adapter = new ScriptedAdapter(script); const scheduler = new HarnessScheduler({ repository: repo, memory, adapter }); return { repo, run, memory, adapter, scheduler }; }
const text = () => ({ text: 'done', toolCalls: [] });
test('six scheduled turns, text ends once, reports have no tools and own history only', async () => { const h = await harness(input => input.phase === 'report' ? { text: '{"ownActions":"none","observations":"none","limitations":"fixture"}', toolCalls: [] } : text()); const run = await h.scheduler.run(h.run.id); assert.equal(run.status, 'completed'); assert.equal(run.turn, 6); assert.equal(h.adapter.inputs.length, 8); const events = await h.repo.listEvents(run.id); assert.equal(events.filter(e => e.type === 'turn_ended').length, 6); assert.deepEqual(events.filter(e => e.type === 'turn_started').map(e => e.agentId), Array.from({ length: 3 }, () => run.config.scheduler.order).flat()); assert.ok(h.adapter.inputs.filter(i => i.phase === 'report').every(i => i.tools.length === 0)); assert.equal(run.reports.length, 2); assert.equal(run.artifacts.at(-1)?.frozen, true); });
test('all batch proposals recorded before execution; denied invalid unknown charged; exhaustion blocks remainder', async () => { const h = await harness(input => input.phase === 'report' ? text() : { text: '', toolCalls: [{ id: '1', name: 'unknown', arguments: {} }, { id: '2', name: 'post_board', arguments: { text: 42 } }, { id: '3', name: 'read_role_data', arguments: { runId: 'other' } }, { id: '4', name: 'post_board', arguments: { text: 'must not execute' } }, { id: '5', name: 'end_turn', arguments: {} }] }); const run = await h.scheduler.run(h.run.id); assert.equal(run.status, 'completed'); assert.equal(run.board.length, 0); const events = await h.repo.listEvents(run.id); assert.equal(events.filter(e => e.type === 'tool_admitted').length, 18); assert.equal(events.filter(e => e.type === 'tool_unexecuted').length, 12); assert.ok(events.filter(e => e.type === 'turn_ended').every(e => (e.data as any).remainingAllowance === 0)); const requested = events.filter(e => e.turn === 1 && e.type === 'tool_requested'); assert.equal(requested.length, 5); assert.ok(requested.at(-1)!.sequence < events.find(e => e.type === 'tool_admitted')!.sequence); });
test('early yielding never executes later calls and returns next round', async () => { const h = await harness(input => input.phase === 'report' ? text() : { text: '', toolCalls: [{ id: 'yield', name: 'end_turn', arguments: {} }, { id: 'later', name: 'post_board', arguments: { text: 'never' } }] }); const run = await h.scheduler.run(h.run.id); assert.equal(run.turn, 6); assert.equal(run.board.length, 0); assert.equal((await h.repo.listEvents(run.id)).filter(e => e.type === 'tool_unexecuted').length, 6); });
test('stable operation IDs deduplicate posts and conflicting identity stops run', async () => { const h = await harness(input => input.phase === 'report' ? text() : { text: '', toolCalls: [{ id: 'same', name: 'post_board', arguments: { text: 'once' } }, { id: 'same', name: 'post_board', arguments: { text: 'once' } }, { id: 'yield', name: 'end_turn', arguments: {} }] }); const r = await h.scheduler.run(h.run.id); assert.equal(r.board.length, 6); assert.equal((await h.repo.listEvents(r.id)).filter(e => e.type === 'tool_deduplicated').length, 6); const bad = await harness(() => ({ text: '', toolCalls: [{ id: 'same', name: 'post_board', arguments: { text: 'first' } }, { id: 'same', name: 'post_board', arguments: { text: 'different' } }] })); const failed = await bad.scheduler.run(bad.run.id); assert.equal(failed.status, 'failed'); assert.equal(failed.board.length, 1); assert.match(failed.failureReason!, /Ambiguous/); });
test('timeout and evidence failure stop further actions truthfully', async () => {
    const h = await harness(() => new Promise(() => { }), undefined, c => { c.limits.requestTimeoutMs = 10; });
    const r = await h.scheduler.run(h.run.id);
    assert.equal(r.status, 'failed');
    assert.match(r.failureReason!, /timeout/);
    class FailingRepo extends InMemoryRepository {
        override async appendEvent(e: NewEvent) {
            if (e.type === 'tool_admitted')
                throw new Error('Evidence unavailable');
            return super.appendEvent(e);
        }
    }
    const f = await harness(() => ({ text: '', toolCalls: [{ id: 'p', name: 'post_board', arguments: { text: 'never' } }] }), new FailingRepo());
    const failed = await f.scheduler.run(f.run.id);
    assert.equal(failed.status, 'interrupted');
    assert.equal(failed.board.length, 0);
});
test('cancel between model return and execution prevents mutations and duplicate claims never rerun', async () => { let h: Awaited<ReturnType<typeof harness>>; h = await harness(async () => { await h.repo.requestCancel(h.run.id); return { text: '', toolCalls: [{ id: 'p', name: 'post_board', arguments: { text: 'never' } }] }; }); const r = await h.scheduler.run(h.run.id); assert.equal(r.status, 'cancelled'); assert.equal(r.board.length, 0); await h.scheduler.run(h.run.id); assert.equal(h.adapter.inputs.length, 1); });
test('malformed nested configuration produces validation errors', () => {
    for (const x of [null, {}, { ...defaultFixtureConfiguration(), roles: [null] }, { ...defaultFixtureConfiguration(), model: { provider: 'x', id: 'x', settings: [] } }])
        assert.equal(validateConfiguration(x).valid, false);
});
import { fixtureScript } from './scripted-adapter.js';
import { executeTool } from './gateway.js';
import { fixtureScenario } from './scenario.js';
test('complete scripted fixture versions artifact and private notes with exact explicit deliveries', async () => {
    const h = await harness(fixtureScript);
    const run = await h.scheduler.run(h.run.id);
    assert.equal(run.status, 'completed');
    assert.deepEqual([...run.artifacts.at(-1)!.value as string[]].sort(), ['blue', 'circle']);
    assert.equal(run.artifacts.length, 4);
    assert.equal(run.board.length, 2);
    assert.equal(run.reports.filter(r => r.parsed !== null).length, 2);
    const events = await h.repo.listEvents(run.id);
    assert.equal(events.filter(e => e.type === 'board_delivery').length, 4);
    assert.equal(events.filter(e => e.type === 'memory_updated').length, 4);
    for (const role of run.config.roles) {
        const own = await h.memory.load(run.id, role.id);
        const other = run.config.roles.find(r => r.id !== role.id)!;
        assert.equal(own.version, 2);
        assert.ok(own.notes.includes(role.id === 'alpha' ? 'blue' : 'circle'));
        assert.ok(!own.notes.includes(other.id === 'alpha' ? 'blue' : 'circle'));
        const first = h.adapter.inputs.find(i => i.agentId === role.id)!;
        assert.ok(!JSON.stringify(first.messages).includes('My synthetic fragment is'));
    }
    assert.equal((await h.memory.load('fresh', run.config.roles[0]!.id)).messages.length, 0);
});
test('board pagination uses stable exclusive sequences and exact overlapping exposure', async () => {
    const h = await harness(text);
    const run = h.run;
    const role = run.config.roles[0]!;
    const snapshot = await h.memory.load(run.id, role.id);
    for (let n = 1; n <= 5; n++)
        await executeTool(run, role, fixtureScenario, h.memory, snapshot, { runId: run.id, agentId: role.id, operationId: `p${n}` }, 'post_board', { text: `m${n}` });
    const read = async (args: unknown) => executeTool(run, role, fixtureScenario, h.memory, snapshot, { runId: run.id, agentId: role.id, operationId: 'r' }, 'read_board', args);
    const latest = await read({ limit: 2 });
    assert.deepEqual((latest.result as any).messages.map((m: any) => m.sequence), [4, 5]);
    assert.equal((latest.result as any).beforeSequence, 4);
    const older = await read({ limit: 2, beforeSequence: 4 });
    assert.deepEqual((older.result as any).messages.map((m: any) => m.sequence), [2, 3]);
    assert.deepEqual((await read({ limit: 3 })).after, run.board.slice(-3));
});
test('memory and artifact retries do not duplicate versions; native update is charged', async () => {
    const h = await harness(input => input.phase === 'report' ? text() : { text: '', toolCalls: [{ id: 'n', name: 'update_working_memory', arguments: { notes: 'private unique' } }, { id: 'n', name: 'update_working_memory', arguments: { notes: 'private unique' } }, { id: 'end', name: 'end_turn', arguments: {} }] });
    const r = await h.scheduler.run(h.run.id);
    for (const role of r.config.roles)
        assert.equal((await h.memory.load(r.id, role.id)).version, 3);
    assert.equal((await h.repo.listEvents(r.id)).filter(e => e.type === 'tool_admitted').length, 18);
    const a = await harness(input => input.phase === 'report' ? text() : input.invocationId.includes(':turn:1:') ? { text: '', toolCalls: [{ id: 'a', name: 'update_artifact', arguments: { expectedVersion: 0, value: 'once' } }, { id: 'a', name: 'update_artifact', arguments: { expectedVersion: 0, value: 'once' } }, { id: 'e', name: 'end_turn', arguments: {} }] } : text());
    const done = await a.scheduler.run(a.run.id);
    assert.deepEqual(done.artifacts.at(-1)?.value, ['once']);
    assert.equal(done.artifacts.length, 3);
});
test('cancelled response proposals remain recorded and interrupted memory writes cannot complete', async () => { let h: Awaited<ReturnType<typeof harness>>; h = await harness(async () => { await h.repo.requestCancel(h.run.id); return { text: '', toolCalls: [{ id: 'x', name: 'post_board', arguments: { text: 'no' } }] }; }); await h.scheduler.run(h.run.id); assert.equal((await h.repo.listEvents(h.run.id)).filter(e => e.type === 'tool_requested').length, 1); const bad = await harness(() => ({ text: '', toolCalls: [{ id: 'n', name: 'update_working_memory', arguments: { notes: 'x' } }] })); bad.memory.save = async () => { throw new Error('Ambiguous memory write'); }; const r = await bad.scheduler.run(bad.run.id); assert.equal(r.status, 'interrupted'); assert.equal(bad.adapter.inputs.length, 1); });
test('cancellation mid-batch records every pending call without extra mutations', async () => {
    class CancelAfterPost extends InMemoryRepository {
        override async appendEvent(e: NewEvent) {
            const result = await super.appendEvent(e);
            if (e.type === 'board_post')
                await this.requestCancel(e.runId);
            return result;
        }
    }
    const h = await harness(() => ({ text: '', toolCalls: [
            { id: 'first', name: 'post_board', arguments: { text: 'one' } },
            { id: 'second', name: 'post_board', arguments: { text: 'two' } },
            { id: 'third', name: 'end_turn', arguments: {} }
        ] }), new CancelAfterPost());
    const run = await h.scheduler.run(h.run.id);
    assert.equal(run.status, 'cancelled');
    assert.equal(run.board.length, 1);
    const events = await h.repo.listEvents(run.id);
    assert.equal(events.filter(e => e.type === 'tool_requested').length, 3);
    assert.equal(events.filter(e => e.type === 'tool_unexecuted').length, 2);
});
test('cancellation during final reporting cannot produce clean completion', async () => {
    let h: Awaited<ReturnType<typeof harness>>;
    let reports = 0;
    h = await harness(async (input) => {
        if (input.phase === 'report' && ++reports === 2)
            await h.repo.requestCancel(h.run.id);
        return text();
    });
    const run = await h.scheduler.run(h.run.id);
    assert.equal(run.status, 'cancelled');
    assert.equal((await h.repo.listEvents(run.id)).filter(e => e.type === 'run_completed').length, 0);
});
test('report proposals are recorded but never execute or leak other reports', async () => {
    const h = await harness(input => input.phase === 'report' ? { text: `secret-report-${input.agentId}`, toolCalls: [{ id: 'forbidden', name: 'post_board', arguments: { text: 'never' } }] } : text());
    const run = await h.scheduler.run(h.run.id);
    assert.equal(run.status, 'completed');
    assert.equal(run.board.length, 0);
    assert.ok(run.reports.every(r => r.parsed === null));
    for (const input of h.adapter.inputs.filter(i => i.phase === 'report')) {
        assert.equal(input.tools.length, 0);
        assert.ok(!JSON.stringify(input.messages).includes('secret-report-'));
    }
    assert.equal((await h.repo.listEvents(run.id)).filter(e => e.type === 'tool_unexecuted' && (e.data as any).reason === 'reporting_tools_disabled').length, 2);
});
test('unexpected scenario infrastructure errors stop execution with pending dispositions', async () => {
    const h = await harness(() => ({ text: '', toolCalls: [{ id: 'read', name: 'read_role_data', arguments: {} }, { id: 'post', name: 'post_board', arguments: { text: 'never' } }] }));
    const scenario = { ...fixtureScenario, execute() { throw new Error('Scenario storage unavailable'); } };
    const scheduler = new HarnessScheduler({ repository: h.repo, memory: h.memory, adapter: h.adapter, scenario });
    const run = await scheduler.run(h.run.id);
    assert.equal(run.status, 'failed');
    assert.equal(run.board.length, 0);
    const events = await h.repo.listEvents(run.id);
    assert.equal(events.filter(e => e.type === 'tool_failed').length, 1);
    assert.equal(events.filter(e => e.type === 'tool_unexecuted').length, 1);
});
test('board content is absent from all other-agent inputs without explicit reads', async () => {
    const secret = 'board-only-unique-sentinel';
    const h = await harness(input => input.phase === 'action' && input.agentId === 'alpha' ? { text: '', toolCalls: [{ id: 'post', name: 'post_board', arguments: { text: secret } }, { id: 'end', name: 'end_turn', arguments: {} }] } : text());
    const run = await h.scheduler.run(h.run.id);
    assert.equal(run.status, 'completed');
    assert.equal(run.board.length, 3);
    for (const input of h.adapter.inputs.filter(i => i.agentId === 'beta'))
        assert.ok(!JSON.stringify(input.messages).includes(secret));
});
test('frozen artifacts reject updates and invalid configuration payloads fail validation', async () => {
    const h = await harness(text);
    const role = h.run.config.roles[0]!;
    fixtureScenario.finalize(h.run);
    const response = await executeTool(h.run, role, fixtureScenario, h.memory, await h.memory.load(h.run.id, role.id), { runId: h.run.id, agentId: role.id, operationId: 'late' }, 'update_artifact', { expectedVersion: 1, value: 'late' });
    assert.equal((response.result as any).ok, false);
    assert.equal(h.run.artifacts.length, 2);
    for (const mutate of [(c: any) => { c.model.provider = 42; }, (c: any) => { c.scenario.assets = { bad: NaN }; }, (c: any) => { c.model.settings.providerOptions = { bad: undefined }; }, (c: any) => { c.build.packages = { example: 42 }; }]) {
        const draft = defaultFixtureConfiguration();
        mutate(draft);
        assert.equal(validateConfiguration(draft).valid, false);
    }
});
test('credential-like model settings are rejected recursively without exposing values', () => {
    for (const key of ['apiKey', 'authorization', 'password', 'client_secret', 'accessToken']) {
        const draft = defaultFixtureConfiguration();
        draft.model.settings.providerOptions = { nested: { [key]: 'sensitive-sentinel' } };
        const result = validateConfiguration(draft);
        assert.equal(result.valid, false);
        assert.ok(!result.errors.join(' ').includes('sensitive-sentinel'));
    }
});
test('cancellation racing terminal save becomes cancelled with no completion event', async () => {
    class TerminalRace extends InMemoryRepository {
        override async saveRun(run: import('./contracts.js').Run) {
            if (run.status === 'completed')
                await this.requestCancel(run.id);
            await super.saveRun(run);
        }
    }
    const h = await harness(text, new TerminalRace());
    const run = await h.scheduler.run(h.run.id);
    assert.equal(run.status, 'cancelled');
    assert.equal((await h.repo.getRun(run.id))?.status, 'cancelled');
    assert.equal((await h.repo.listEvents(run.id)).filter(e => e.type === 'run_completed').length, 0);
});
