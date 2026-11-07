import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { HarnessScheduler } from '../../experiment-worker/src/harness/scheduler.js';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { fixtureScript, ScriptedAdapter } from '../../experiment-worker/src/harness/scripted-adapter.js';
import type { HarnessEvent, MemorySnapshot, Run } from '@sidechannel/contracts/harness/contracts';
import type { CanonicalStep } from '@sidechannel/contracts/analysis/evidence-contracts';
import { normalizeTrace } from '@sidechannel/domain/analysis/normalization';
import { buildWindows, selectSteps } from '@sidechannel/domain/analysis/windows';
import { createSeedCodebook, resolveAnalysisConfiguration, snapshotHash, stableStringify, staticContextForRun } from '@sidechannel/domain/analysis/configuration';
import { estimateTokens, preflightQuestions, serializeWindow } from '@sidechannel/domain/analysis/serialization';

function run(): Run { const r = createQueuedRun(defaultFixtureConfiguration(), 'test'); r.status = 'completed'; return r; }

function event(r: Run, sequence: number, type: string, data: unknown, extra: Partial<HarnessEvent> = {}): HarnessEvent { return { schemaVersion: 1, id: `event-${sequence}`, runId: r.id, sequence, type, timestamp: '2026-11-07T00:00:00Z', agentId: 'alpha', data, ...extra }; }

function step(ordinal: number): CanonicalStep { return { id: `s-${ordinal}`, ordinal, phase: 'action', agentId: 'alpha', invocationId: `i-${ordinal}`, eventIds: [`e-${ordinal}`], sequenceStart: ordinal, sequenceEnd: ordinal, closed: true, incomplete: false, diagnostics: [], assistantText: `step ${ordinal}`, toolCalls: [], sideEffects: [] }; }

test('windows obey fixed stride and avoid redundant suffixes', () => {
    for (const [count, expected] of [[0, []], [3, [[1, 3]]], [12, [[1, 12]]], [20, [[1, 12], [5, 16], [9, 20]]], [22, [[1, 12], [5, 16], [9, 20], [13, 22]]]] as const) {
        const steps = Array.from({ length: count }, (_, i) => step(i + 1));
        const windows = buildWindows(steps, { size: 12, stride: 4 });
        assert.deepEqual(windows.map(w => [w.startOrdinal, w.endOrdinal]), expected);
        assert.deepEqual(windows, buildWindows(steps, { size: 12, stride: 4 }));
    }
    assert.throws(() => buildWindows([], { size: 2, stride: 3 }));
    assert.throws(() => buildWindows([], { size: 0, stride: 1 }));
    assert.throws(() => buildWindows([step(2), step(1)], { size: 2, stride: 1 }));
});

test('invocation joins resolve operation-only side effects without replaying history or raw text', () => {
    const r = run(); const call = { id: 'c', name: 'post_board', arguments: { text: 'UNIQUE_BOARD' } };
    const message = { id: 'board-1', authorId: 'alpha', sequence: 1, text: 'UNIQUE_BOARD' };
    const events = [
        event(r, 1, 'model_requested', { phase: 'action', messages: [{ role: 'assistant', content: 'HISTORY_SECRET' }] }, { invocationId: 'i' }),
        event(r, 2, 'model_response', { text: 'CURRENT', toolCalls: [call], raw: { text: 'RAW_COPY', steps: [{ reasoning: [{ type: 'reasoning', text: 'SUPPORTED_REASONING' }] }] } }, { invocationId: 'i' }),
        event(r, 3, 'tool_requested', { call }, { invocationId: 'i', operationId: 'op', toolCallId: 'c' }),
        event(r, 4, 'model_requested', { phase: 'action' }, { invocationId: 'other', agentId: 'beta' }),
        event(r, 5, 'board_post', { after: message }, { operationId: 'op', toolCallId: 'c' }),
        event(r, 6, 'tool_result', { result: { ok: true, message, uniqueReceipt: 'DO_NOT_DROP', raw: 'UNIQUE_RAW_TOOL_FIELD', history: ['UNIQUE_TOOL_HISTORY'], providerMetadata: { receipt: 'UNIQUE_TOOL_RECEIPT' } }, disposition: 'executed' }, { invocationId: 'i', operationId: 'op', toolCallId: 'c' }),
        event(r, 7, 'model_response', { text: 'second', toolCalls: [] }, { invocationId: 'other', agentId: 'beta' }),
    ];
    const normalized = normalizeTrace(r, [...events].reverse());
    assert.equal(normalized.steps[0]!.sideEffects[0]!.eventId, 'event-5');
    assert.equal(normalized.steps[1]!.sideEffects.length, 0);
    const serialized = serializeWindow(buildWindows(normalized.steps, { size: 12, stride: 4 })[0]!, normalized.steps, resolveAnalysisConfiguration().evidence);
    assert.doesNotMatch(serialized.state, /HISTORY_SECRET|RAW_COPY/);
    assert.match(serialized.state, /SUPPORTED_REASONING/);
    assert.match(serialized.state, /DO_NOT_DROP/);
    assert.match(serialized.state, /UNIQUE_RAW_TOOL_FIELD/); assert.match(serialized.state, /UNIQUE_TOOL_HISTORY/); assert.match(serialized.state, /UNIQUE_TOOL_RECEIPT/);
    assert.equal(serialized.state.split('UNIQUE_BOARD').length - 1, 1);
    assert.match(serialized.state, /evidenceRef/);
    assert.deepEqual(normalizeTrace(r, events).source, normalized.source);
});

test('report lifecycle adapter associates actor-scoped report without manufacturing response', () => {
    const r = run(); const events = [
        event(r, 1, 'artifact_frozen', { value: 'FROZEN_OUTCOME' }),
        event(r, 2, 'model_requested', { phase: 'report' }, { invocationId: 'report-alpha' }),
        event(r, 3, 'report_submitted', { raw: 'FINAL_TEXT', parsed: null, invalid: false }),
    ];
    const trace = normalizeTrace(r, events);
    assert.equal(trace.steps.length, 1); assert.equal(trace.steps[0]!.closed, true);
    assert.equal(trace.steps[0]!.incomplete, false); assert.equal(trace.steps[0]!.report!.raw, 'FINAL_TEXT');
    assert.deepEqual(trace.contextEventIds, ['event-1']);
    assert.equal(trace.steps[0]!.assistantText, undefined);
    assert.equal(selectSteps(trace.steps, { phases: ['action'] }).length, 0);
    const state = serializeWindow(buildWindows(trace.steps, { size: 12, stride: 4 })[0]!, trace.steps, resolveAnalysisConfiguration().evidence).state;
    assert.equal(state.split('FINAL_TEXT').length - 1, 1); assert.doesNotMatch(state, /FROZEN_OUTCOME/);
});

test('incomplete invocations are diagnosed, open requests excluded, gaps alone do not imply lost outcomes', () => {
    const r = run(); r.status = 'failed';
    const trace = normalizeTrace(r, [
        event(r, 1, 'model_requested', { phase: 'action' }, { invocationId: 'closed' }),
        event(r, 3, 'model_response', { text: 'present', toolCalls: [{ id: 'pending', name: 'post_board', arguments: {} }] }, { invocationId: 'closed' }),
        event(r, 4, 'model_requested', { phase: 'action' }, { invocationId: 'open' }),
    ]);
    assert.ok(trace.diagnostics.some(d => d.code === 'sequence_gap'));
    assert.ok(trace.diagnostics.some(d => d.code === 'incomplete_run'));
    assert.ok(trace.steps[0]!.diagnostics.some(d => d.code === 'missing_tool_outcome'));
    assert.equal(trace.steps[0]!.toolCalls[0]!.status, 'proposed');
    assert.deepEqual(selectSteps(trace.steps, { phases: ['action'] }).map(s => s.ordinal), [1]);
    r.status = 'running'; assert.throws(() => normalizeTrace(r, []), /terminal/);
});

test('evidence selection removes nested sensitive payloads while keeping grid and attribution', () => {
    const s = step(7); s.providerReasoning = [{ text: 'REASONING_SENTINEL', source: 'explicit' }];
    s.toolCalls = [
        { id: 'memory', name: 'update_working_memory', arguments: { notes: 'MEMORY_SENTINEL' }, result: { notes: 'MEMORY_SENTINEL' }, status: 'executed', admission: 'admitted', eventIds: [] },
        { id: 'read', name: 'read_board', arguments: {}, result: { messages: [{ id: 'm', authorId: 'beta', sequence: 2, text: 'BOARD_SENTINEL' }] }, status: 'executed', admission: 'admitted', eventIds: [] },
        { id: 'artifact', name: 'read_artifact', arguments: {}, result: { value: 'ARTIFACT_SENTINEL' }, status: 'executed', admission: 'admitted', eventIds: [] },
        { id: 'generic', name: 'custom', arguments: { nested: { privateMemory: 'MEMORY_SENTINEL', reasoning: 'REASONING_SENTINEL', finalReport: 'REPORT_SENTINEL' } }, result: 42, status: 'executed', admission: 'admitted', eventIds: [] },
    ];
    s.sideEffects = [{ type: 'memory_updated', eventId: 'mem', sequence: 8, beforeVersion: 1, afterVersion: 2, messageIds: [], before: { notes: 'MEMORY_SENTINEL' }, after: { notes: 'MEMORY_SENTINEL' } }];
    const config = resolveAnalysisConfiguration({ evidence: { privateMemory: false, providerReasoning: false, boardContent: false, boardDelivery: false, artifactChanges: false, finalReports: false } });
    const window = buildWindows([s], config.window)[0]!;
    const serialized = serializeWindow(window, [s], config.evidence);
    assert.doesNotMatch(serialized.state, /MEMORY_SENTINEL|REASONING_SENTINEL|BOARD_SENTINEL|ARTIFACT_SENTINEL|REPORT_SENTINEL/);
    assert.match(serialized.state, /"result":42/); assert.equal(serialized.hasEvidence, true);
    assert.deepEqual(window.stepIds, ['s-7']); assert.equal(serialized.availability.privateMemory, true);
    const none = Object.fromEntries(Object.keys(config.evidence).map(k => [k, false])) as typeof config.evidence;
    assert.equal(serializeWindow(window, [s], none).hasEvidence, false);
});

test('source memory changes normalize notes and versions without historical conversation', () => {
    const r = run(); const call = { id: 'c', name: 'update_working_memory', arguments: { notes: 'new' } };
    const trace = normalizeTrace(r, [event(r, 1, 'model_requested', { phase: 'action' }, { invocationId: 'i' }), event(r, 2, 'model_response', { text: '', toolCalls: [call] }, { invocationId: 'i' }), event(r, 3, 'tool_requested', { call }, { invocationId: 'i', toolCallId: 'c', operationId: 'op' }), event(r, 4, 'memory_updated', { before: { version: 1, notes: 'old', messages: ['HISTORY'] }, after: { version: 2, notes: 'new', messages: ['HISTORY'] } }, { operationId: 'op' }), event(r, 5, 'tool_result', { result: { ok: true, version: 2 } }, { invocationId: 'i', toolCallId: 'c', operationId: 'op' })]);
    assert.doesNotMatch(JSON.stringify(trace.steps), /HISTORY/);
    assert.equal(trace.steps[0]!.sideEffects[0]!.afterVersion, 2);
});

test('immutable configuration, seed definitions and static task context preserve historical settings', () => {
    const evidence = { privateMemory: false }; const config = resolveAnalysisConfiguration({ evidence });
    evidence.privateMemory = true; assert.equal(config.evidence.privateMemory, false);
    assert.equal(config.model, 'jev-1.14.0'); assert.deepEqual(config.window, { size: 12, stride: 4 });
    assert.throws(() => { config.window.size = 3; });
    assert.throws(() => resolveAnalysisConfiguration({ evidence: { privateMemory: 'yes' } as never }));
    assert.throws(() => resolveAnalysisConfiguration({ window: { size: 4, stride: 5 } }));
    const seed = createSeedCodebook('researcher', '2026-11-07');
    assert.equal(seed.revision.definitions.length, 9);
    assert.equal(seed.revision.definitions.find(c => c.code === 'DELEGATE')!.definition, 'Asks a specific agent to perform part of a task or exchange');
    assert.throws(() => { seed.revision.definitions[0]!.definition = 'changed'; });
    const r = run(); r.config.scenario.assets = { hiddenAnswerKey: 'ASSET_SENTINEL' };
    assert.doesNotMatch(staticContextForRun(r).text, /ASSET_SENTINEL/);
    assert.equal(snapshotHash({ b: 2, a: 1 }), snapshotHash({ a: 1, b: 2 }));
});

test('canonical hashing uses locale-independent key order including accents and numeric keys', () => {
    // JSON itself orders integer-index keys numerically; remaining keys use codepoint order.
    const first = { 'é': 'accent', '10': 'ten', '2': 'two', 'a': { 'ä': 1, z: 2 }, Z: 'upper' };
    const second = { Z: 'upper', a: { z: 2, 'ä': 1 }, '2': 'two', '10': 'ten', 'é': 'accent' };
    assert.equal(stableStringify(first), '{"2":"two","10":"ten","Z":"upper","a":{"z":2,"ä":1},"é":"accent"}');
    assert.equal(stableStringify(first), stableStringify(second));
    assert.equal(snapshotHash(first), snapshotHash(second));
});

test('preflight batches questions only and leaves oversized state unchanged', () => {
    const config = resolveAnalysisConfiguration();
    const questions = Array.from({ length: 3 }, (_, i) => ({ codeId: `c${i}`, instructions: 'x'.repeat(100), criteria: { true: 'yes', false: 'no' } }));
    const state = 'STATE'; const singleQuestion = estimateTokens(JSON.stringify({ instructions: questions[0]!.instructions, criteria: questions[0]!.criteria }));
    const limits = { ...config.inputLimits, singleQuestionTokens: 1000, combinedQuestionTokens: estimateTokens(state) + singleQuestion + 20, headroomTokens: 0 };
    const budget = preflightQuestions(state, questions, limits);
    assert.equal(budget.oversized, false); assert.equal(budget.batches.length, 3);
    assert.deepEqual(budget.batches.flat(), questions);
    const oversized = preflightQuestions('z'.repeat(2000), questions, limits);
    assert.equal(oversized.oversized, true); assert.equal(oversized.batches.length, 0); assert.match(oversized.diagnostics.join(), /smaller windows/);
    assert.equal(preflightQuestions(state, questions, { ...limits, maxBodyBytes: 1 }).oversized, true);
    assert.ok(estimateTokens('🧪') > '🧪'.length);
});

test('real scripted harness fixture reconstructs every invocation and side effect without source mutation', async () => {
    const repository = new InMemoryRepository(); const snapshots = new Map<string, MemorySnapshot>();
    const source = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'normalizer-fixture');
    await repository.createRun(source);
    const finished = await new HarnessScheduler({ repository, adapter: new ScriptedAdapter(fixtureScript), memory: {
        async load(r, a) { return structuredClone(snapshots.get(`${r}/${a}`) ?? { version: 0, notes: '', messages: [] }); },
        async save(r, a, s) { snapshots.set(`${r}/${a}`, structuredClone(s)); },
    } }).run(source.id);
    assert.equal(finished.status, 'completed');
    const events = await repository.listEvents(finished.id, 0, 10_000); const sourceHash = snapshotHash(events);
    const trace = normalizeTrace(finished, events);
    assert.equal(trace.steps.length, events.filter(e => e.type === 'model_requested').length);
    assert.deepEqual(trace.diagnostics, []);
    assert.equal(trace.steps.filter(s => s.phase === 'report').length, 2);
    const sideEffects = events.filter(e => ['memory_updated', 'board_post', 'board_delivery', 'artifact_updated'].includes(e.type));
    assert.equal(trace.steps.flatMap(s => s.sideEffects).length, sideEffects.length);
    assert.equal(trace.availability.providerReasoning, false);
    assert.equal(snapshotHash(events), sourceHash);
    const config = resolveAnalysisConfiguration();
    const windows = buildWindows(selectSteps(trace.steps, config.selection), config.window);
    const payloads = windows.map(w => serializeWindow(w, trace.steps, config.evidence, staticContextForRun(finished).text));
    assert.ok(payloads.every(p => p.hasEvidence && p.bytes > 0));
});