import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { defaultTokenBudget } from '@sidechannel/domain/harness/token-budget';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import type { MemorySnapshot } from '@sidechannel/contracts/harness/contracts';
import { ScriptedAdapter } from './scripted-adapter.js';
import { HarnessScheduler } from './scheduler.js';
import { executeTool } from './gateway.js';
import { fixtureScenario } from './scenario.js';

async function setup(options: { inputLimit?: number; notes?: string; report?: string; action?: string; legacy?: boolean } = {}) {
    const config = defaultFixtureConfiguration();
    config.roles = [config.roles[0]!];
    config.scheduler.rounds = 1;
    if (!options.legacy) {
        config.tokenBudget = defaultTokenBudget();
        config.tokenBudget.maxInputTokens = options.inputLimit ?? 120000;
        config.model.settings.maxOutputTokens = 4096;
        config.memory.maxPrivateNoteCharacters = 4000;
    }
    if (options.report) config.reportInstructions = options.report;
    if (options.action) config.roles[0]!.instructions = options.action;
    const run = createQueuedRun(resolveConfiguration(config), 'budget-test');
    const repo = new InMemoryRepository();
    await repo.createRun(run);
    const snapshot: MemorySnapshot = { version: 0, notes: options.notes ?? '', messages: [] };
    const memory = { load: async () => structuredClone(snapshot), save: async (_r: string, _a: string, s: MemorySnapshot) => { Object.assign(snapshot, structuredClone(s)); } };
    const adapter = new ScriptedAdapter(input => ({ text: input.phase === 'report' ? '{"ownActions":"none","observations":"none","limitations":"scripted"}' : 'done', toolCalls: [], usage: { inputTokens: 123, outputTokens: 10 } }));
    const scheduler = new HarnessScheduler({ runState: repo, events: repo, memory, adapter });
    return { run, repo, memory, snapshot, adapter, scheduler };
}

test('payload over 32k characters executes under token budget and records estimated scope plus usage', async () => {
    const h = await setup({ action: 'a'.repeat(33000) });
    const run = await h.scheduler.run(h.run.id);
    assert.equal(run.status, 'completed');
    const events = await h.repo.listEvents(run.id);
    assert.equal(events.filter(event => event.type === 'context_accounted').length, 2);
    assert.equal(events.filter(event => event.type === 'model_usage').length, 2);
    const accounting = events.find(event => event.type === 'context_accounted')!.data as any;
    assert.equal(accounting.unit, 'tokens');
    assert.equal(accounting.estimated, true);
    assert.ok(accounting.measured > 33000);
    assert.equal(run.usage.inputTokens, 246);
});

test('notes and tool schema overflow rejects before inference, with explicit phase and no retries', async () => {
    const h = await setup({ inputLimit: 1000, notes: 'n'.repeat(900) });
    const run = await h.scheduler.run(h.run.id);
    assert.equal(run.status, 'failed');
    assert.equal(h.adapter.inputs.length, 0);
    const overflow = (await h.repo.listEvents(run.id)).find(event => event.type === 'context_limit_exceeded')!.data as any;
    assert.equal(overflow.phase, 'action');
    assert.ok(overflow.measured > 1000);
});

test('report uses same policy and overflow records missing report after artifact freeze', async () => {
    const h = await setup({ inputLimit: 5000, report: 'r'.repeat(6000) });
    const run = await h.scheduler.run(h.run.id);
    assert.equal(run.status, 'failed');
    assert.equal(h.adapter.inputs.length, 1);
    assert.equal(run.artifacts.at(-1)!.frozen, true);
    const events = await h.repo.listEvents(run.id);
    assert.equal((events.find(event => event.type === 'context_limit_exceeded')!.data as any).phase, 'report');
    assert.equal(events.filter(event => event.type === 'report_missing').length, 1);
});

test('legacy run retains character limit and note size is independent of token allowance', async () => {
    const legacy = await setup({ legacy: true, action: 'a'.repeat(33000) });
    assert.equal((await legacy.scheduler.run(legacy.run.id)).status, 'failed');
    assert.equal(legacy.adapter.inputs.length, 0);
    const event = (await legacy.repo.listEvents(legacy.run.id)).find(event => event.type === 'context_limit_exceeded')!;
    assert.equal((event.data as any).unit, 'characters');
    const h = await setup();
    const result = await executeTool(h.run, h.run.config.roles[0]!, fixtureScenario, h.memory, h.snapshot, { runId: h.run.id, agentId: 'alpha', operationId: 'notes' }, 'update_working_memory', { notes: 'n'.repeat(4001) });
    assert.equal((result.result as any).ok, false);
});
