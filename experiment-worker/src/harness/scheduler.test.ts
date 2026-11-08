import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { MemorySnapshot } from '@sidechannel/contracts/harness/contracts';
import type { ModelAdapter, ModelInput, ModelResponse, PrivateMemory } from '@sidechannel/contracts/harness/server';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { HarnessScheduler } from './scheduler.js';
import { fixtureScenario } from './scenario.js';
import { fixtureScript, ScriptedAdapter } from './scripted-adapter.js';

class TestMemory implements PrivateMemory {
    values = new Map<string, MemorySnapshot>();
    async load(runId: string, agentId: string) { return structuredClone(this.values.get(`${runId}/${agentId}`) ?? { version: 0, notes: '', messages: [] }); }
    async save(runId: string, agentId: string, value: MemorySnapshot) { this.values.set(`${runId}/${agentId}`, structuredClone(value)); }
}

test('a refused claim returns the existing run without emitting events', async () => {
    const repository = new InMemoryRepository();
    const run = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'claimed-elsewhere');
    await repository.createRun(run);
    await repository.claimRun(run.id, 'other-worker');
    const scheduler = new HarnessScheduler({ runState: repository, events: repository, memory: new TestMemory(), adapter: new ScriptedAdapter(fixtureScript) });
    const result = await scheduler.run(run.id);
    assert.equal(result.id, run.id);
    assert.equal(result.status, 'running');
    assert.deepEqual(await repository.listEvents(run.id), []);
});

test('a missing run throws instead of fabricating one', async () => {
    const repository = new InMemoryRepository();
    const scheduler = new HarnessScheduler({ runState: repository, events: repository, memory: new TestMemory(), adapter: new ScriptedAdapter(fixtureScript) });
    await assert.rejects(scheduler.run('missing-run'), /Run missing/);
});

test('an adapter failure terminates as failed with run_terminated after the recorded turn', async () => {
    const run = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'adapter-failure');
    const repository = new InMemoryRepository();
    await repository.createRun(run);
    class FailingAdapter implements ModelAdapter {
        async complete(_input: ModelInput): Promise<ModelResponse> { throw new Error('Model transport unavailable'); }
    }
    const result = await new HarnessScheduler({ runState: repository, events: repository, memory: new TestMemory(), adapter: new FailingAdapter() }).run(run.id);
    assert.equal(result.status, 'failed');
    assert.equal(result.failureReason, 'Model transport unavailable');
    const events = await repository.listEvents(run.id, 0, 10_000);
    assert.equal(events.at(-1)!.type, 'run_terminated');
    assert.equal((events.at(-1)!.data as { status: string }).status, 'failed');
    assert.ok(events.filter(event => event.type === 'turn_ended').some(event => (event.data as { error?: string }).error === 'Model transport unavailable'));
});

test('a failing report request terminates every role as report_missing', async () => {
    const run = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'report-failure');
    const repository = new InMemoryRepository();
    await repository.createRun(run);
    class ReportFailingAdapter implements ModelAdapter {
        async complete(input: ModelInput): Promise<ModelResponse> {
            if (input.phase === 'report') throw new Error('Model transport unavailable');
            return { text: 'done', toolCalls: [] };
        }
    }
    const result = await new HarnessScheduler({ runState: repository, events: repository, memory: new TestMemory(), adapter: new ReportFailingAdapter() }).run(run.id);
    assert.equal(result.status, 'failed');
    const events = await repository.listEvents(run.id, 0, 10_000);
    assert.deepEqual(events.filter(event => event.type === 'report_missing').map(event => event.agentId), run.config.roles.map(role => role.id));
    assert.equal(events.at(-1)!.type, 'run_terminated');
});

test('a failing artifact freeze terminates as failed without touching status reporting', async () => {
    const run = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'freeze-failure');
    const repository = new InMemoryRepository();
    await repository.createRun(run);
    const scenario = { ...fixtureScenario, finalize() { throw new Error('Scenario storage unavailable'); } };
    const result = await new HarnessScheduler({ runState: repository, events: repository, memory: new TestMemory(), adapter: new ScriptedAdapter(() => ({ text: 'done', toolCalls: [] })), scenario }).run(run.id);
    assert.equal(result.status, 'failed');
    const events = await repository.listEvents(run.id, 0, 10_000);
    assert.equal(events.filter(event => event.type === 'report_missing').length, 0);
    assert.equal(events.at(-1)!.type, 'run_terminated');
});

test('HarnessScheduler.run() stays inside the orchestration budget', async () => {
    // Normalise CRLF so the structural count is checkout-independent.
    const source = (await readFile(new URL('./scheduler.ts', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
    const start = source.indexOf('async run(runId: string)');
    assert.ok(start > 0, 'run() not found');
    const end = source.indexOf('\n    }\n', start);
    assert.ok(end > start, 'run() end not found');
    const runLines = source.slice(start, end).split('\n').length;
    assert.ok(runLines < 150, `run() is ${runLines} lines`);
    assert.ok(source.split('\n').length < 300, `scheduler.ts is ${source.split('\n').length} lines`);
});
