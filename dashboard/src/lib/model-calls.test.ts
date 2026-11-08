import { describe, expect, it } from 'vitest';
import type { HarnessEvent } from '@sidechannel/contracts/browser';
import {
  MODEL_CALL_EVENT_TYPES, buildModelCalls, classifyReasoning, countCallMatches, extractReasoning,
  findMatches, formatTokens, prettyArguments, summarizeEvent, buildToolNames, humanizeCode,
} from './model-calls';

let seq = 0;
function ev(type: string, data: unknown, extra: Partial<HarnessEvent> = {}): HarnessEvent {
  seq += 1;
  return {
    schemaVersion: 1, id: `evt-${seq}`, runId: 'run-1', sequence: seq, type,
    timestamp: new Date(Date.UTC(2026, 10, 7, 16, 48, 0, seq * 100)).toISOString(), data, ...extra,
  } as HarnessEvent;
}

const part = (text: string, providerMetadata?: unknown) => ({ type: 'reasoning', text, ...(providerMetadata ? { providerMetadata } : {}) });

describe('extractReasoning', () => {
  it('reads parts from raw.steps with source paths', () => {
    const parts = extractReasoning({
      text: '', toolCalls: [],
      raw: { steps: [{ reasoning: [part('first'), { type: 'text', text: 'nope' }, part('second')] }, { reasoning: [part('third')] }] },
    });
    expect(parts.map(p => [p.text, p.source, p.summary])).toEqual([
      ['first', 'raw.steps[0].reasoning[0]', false],
      ['second', 'raw.steps[0].reasoning[2]', false],
      ['third', 'raw.steps[1].reasoning[0]', false],
    ]);
  });
  it('reads a top-level reasoning string', () => {
    expect(extractReasoning({ reasoning: 'because' })).toEqual([{ text: 'because', source: 'reasoning', summary: false }]);
  });
  it('falls back to reasoningText only when a step has no parts', () => {
    expect(extractReasoning({ raw: { steps: [{ reasoning: [], reasoningText: 'plain' }] } }).map(p => p.source)).toEqual(['raw.steps[0].reasoningText']);
    expect(extractReasoning({ raw: { steps: [{ reasoning: [part('x')], reasoningText: 'x' }] } })).toHaveLength(1);
  });
  it('returns none for empty arrays, empty text and garbage', () => {
    expect(extractReasoning({ raw: { steps: [{ reasoning: [], reasoningText: '' }] } })).toEqual([]);
    expect(extractReasoning({ raw: { steps: [{ reasoning: [part('   ')] }] } })).toEqual([]);
    expect(extractReasoning({ text: 'looks like thinking' })).toEqual([]);
    expect(extractReasoning(null)).toEqual([]);
    expect(extractReasoning('x')).toEqual([]);
  });
  it('flags summaries only from provider metadata', () => {
    const parts = extractReasoning({ raw: { steps: [{ reasoning: [part('a', { openai: { itemId: 'rs_1', reasoningSummary: 'auto' } }), part('b', { openai: { itemId: 'fc_1' } })] }] } });
    expect(parts.map(p => p.summary)).toEqual([true, false]);
  });
});

describe('classifyReasoning', () => {
  const p = (summary = false) => ({ text: 't', source: 's', summary });
  it('scripted wins first', () => {
    expect(classifyReasoning({ provider: 'scripted', parts: [p()], reasoningTokens: 5 })).toBe('scripted');
  });
  it('summary when all parts are summaries, returned otherwise', () => {
    expect(classifyReasoning({ provider: 'x', parts: [p(true), p(true)] })).toBe('summary');
    expect(classifyReasoning({ provider: 'x', parts: [p(true), p(false)] })).toBe('returned');
    expect(classifyReasoning({ provider: 'x', parts: [p()], reasoningTokens: 0 })).toBe('returned');
  });
  it('hidden, not_returned and unknown', () => {
    expect(classifyReasoning({ provider: 'x', parts: [], reasoningTokens: 384, usageSource: 'provider-reported' })).toBe('hidden');
    expect(classifyReasoning({ provider: 'x', parts: [], reasoningTokens: 0, usageSource: 'provider-reported' })).toBe('not_returned');
    expect(classifyReasoning({ provider: 'x', parts: [], usageSource: 'unavailable' })).toBe('unknown');
    expect(classifyReasoning({ provider: 'x', parts: [] })).toBe('unknown');
  });
});

describe('buildModelCalls', () => {
  const inv = 'run-1:turn:1:inv:1';
  function liveCall() {
    const base = { invocationId: inv, agentId: 'agent-a', round: 1, turn: 1 };
    return [
      ev('turn_started', { allowance: 8 }, { agentId: 'agent-a' }),
      ev('context_accounted', { phase: 'action', unit: 'tokens', estimated: 5947, measured: null }, base),
      ev('model_requested', { agentId: 'agent-a', phase: 'action', messages: [{}, {}, {}], tools: [{}, {}], model: {} }, base),
      ev('model_response', {
        text: 'Reading my role data.',
        toolCalls: [
          { id: 'call-a', name: 'read_role_data', arguments: {} },
          { id: 'call-b', name: 'post_board', arguments: { body: 'hello' } },
          { id: 'call-c', name: 'post_board', arguments: { body: 'again' } },
          { id: 'call-d', name: 'noop', arguments: {} },
        ],
        usage: { inputTokens: 5800, outputTokens: 96, reasoningTokens: 128, totalTokens: 6024 },
        raw: { finishReason: 'tool-calls', steps: [{ reasoning: [part('Check role first.')], reasoningText: 'Check role first.' }] },
      }, base),
      ev('model_usage', { phase: 'action', provider: 'adaption', source: 'provider-reported', usage: { inputTokens: 5800, outputTokens: 96, reasoningTokens: 128 } }, base),
      ev('tool_requested', { call: { id: 'call-a', name: 'read_role_data' }, index: 0 }, { ...base, toolCallId: 'call-a' }),
      ev('tool_admitted', { call: { id: 'call-a', name: 'read_role_data' }, remainingAllowance: 7 }, { ...base, toolCallId: 'call-a' }),
      ev('tool_requested', { call: { id: 'call-b' }, index: 1 }, { ...base, toolCallId: 'call-b' }),
      ev('tool_admitted', { call: { id: 'call-b' }, remainingAllowance: 6 }, { ...base, toolCallId: 'call-b' }),
      ev('tool_result', { result: { ok: true }, disposition: 'executed' }, { ...base, toolCallId: 'call-b' }),
      ev('tool_unexecuted', { call: { id: 'call-c' }, reason: 'allowance_exhausted' }, { ...base, toolCallId: 'call-c' }),
      ev('tool_failed', { call: { id: 'call-d' }, reason: 'boom' }, { ...base, toolCallId: 'call-d' }),
    ];
  }

  it('groups one invocation with tokens, reasoning, latency and tool statuses', () => {
    const events = liveCall();
    const [call, ...rest] = buildModelCalls([...events].reverse(), { provider: 'adaption' });
    expect(rest).toHaveLength(0);
    expect(call).toMatchObject({
      invocationId: inv, agentId: 'agent-a', phase: 'action', round: 1, turn: 1, ordinal: 1,
      text: 'Reading my role data.', reasoningState: 'returned', finishReason: 'tool-calls',
      tokens: { context: 5947, input: 5800, output: 96, reasoning: 128 },
      inputSummary: { messages: 3, tools: 2 }, latencyMs: 100,
    });
    expect(call.reasoning).toHaveLength(1);
    expect(call.sequenceRange[0]).toBe(events[1].sequence);
    expect(call.sequenceRange[1]).toBe(events[events.length - 1].sequence);
    const byId = Object.fromEntries(call.toolCalls.map(t => [t.id, t]));
    expect(byId['call-a'].status).toBe('admitted');
    expect(byId['call-a'].statusEvent).toEqual({ id: events[6].id, sequence: events[6].sequence });
    expect(byId['call-b'].status).toBe('executed');
    expect(byId['call-c']).toMatchObject({ status: 'unexecuted', reason: 'allowance_exhausted' });
    expect(byId['call-d']).toMatchObject({ status: 'failed', reason: 'boom' });
  });

  it('numbers calls in order and marks unreferenced tools as proposed', () => {
    const a = ev('model_requested', { phase: 'action', messages: [], tools: [] }, { invocationId: 'i1' });
    const ar = ev('model_response', { text: '', toolCalls: [{ id: 't', name: 'x', arguments: {} }] }, { invocationId: 'i1' });
    const b = ev('model_requested', { phase: 'report', messages: [], tools: [] }, { invocationId: 'i2' });
    const calls = buildModelCalls([b, a, ar], { provider: 'scripted' });
    expect(calls.map(c => [c.invocationId, c.ordinal])).toEqual([['i1', 1], ['i2', 2]]);
    expect(calls[0].toolCalls[0].status).toBe('proposed');
    expect(calls[0].reasoningState).toBe('scripted');
  });

  it('tolerates partial pages (response without request, no usage)', () => {
    const r = ev('model_response', { text: 'hi', toolCalls: [] }, { invocationId: 'p1', agentId: 'agent-a' });
    const [call] = buildModelCalls([r], { provider: 'adaption' });
    expect(call.request).toBeUndefined();
    expect(call.latencyMs).toBeUndefined();
    expect(call.text).toBe('hi');
    expect(call.reasoningState).toBe('unknown');
    expect(call.inputSummary).toBeUndefined();
  });

  it('keeps tool calls from lifecycle events when the response is on another page', () => {
    const req = ev('model_requested', { phase: 'action', messages: [], tools: [] }, { invocationId: 'p2' });
    const tr = ev('tool_requested', { call: { id: 'c1', name: 'read_role_data', arguments: { a: 1 } }, index: 0 }, { invocationId: 'p2', toolCallId: 'c1' });
    const [call] = buildModelCalls([req, tr], { provider: 'adaption' });
    expect(call.toolCalls).toEqual([expect.objectContaining({ id: 'c1', name: 'read_role_data', status: 'proposed' })]);
  });

  it('ignores groups with only tool events and events without invocationId', () => {
    const t = ev('tool_deduplicated', {}, { invocationId: 'z', toolCallId: 'c' });
    expect(buildModelCalls([t, ev('run_started', {})], { provider: 'x' })).toEqual([]);
  });

  it('classifies hidden / not_returned / unknown from model_usage', () => {
    const mk = (id: string, usage: unknown, source: string) => [
      ev('model_response', { text: '', toolCalls: [] }, { invocationId: id }),
      ev('model_usage', { phase: 'action', provider: 'adaption', source, usage }, { invocationId: id }),
    ];
    const calls = buildModelCalls([
      ...mk('h', { reasoningTokens: 384 }, 'provider-reported'),
      ...mk('n', { reasoningTokens: 0, outputTokens: 4 }, 'provider-reported'),
      ...mk('u', null, 'unavailable'),
    ], { provider: 'adaption' });
    expect(calls.map(c => c.reasoningState)).toEqual(['hidden', 'not_returned', 'unknown']);
  });
});

describe('MODEL_CALL_EVENT_TYPES', () => {
  it('lists the four folded types', () => {
    expect([...MODEL_CALL_EVENT_TYPES].sort()).toEqual(['context_accounted', 'model_requested', 'model_response', 'model_usage']);
  });
});

describe('summarizeEvent', () => {
  it('summarizes known types', () => {
    expect(summarizeEvent(ev('turn_started', { allowance: 8, orderPosition: 0 }))).toBe('Allowance 8 actions · order position 0');
    expect(summarizeEvent(ev('turn_ended', { reason: 'end_turn', remainingAllowance: 5 }))).toBe('Ended: end turn · 5 actions left');
    expect(summarizeEvent(ev('tool_result', { call: { name: 'read_role_data' }, result: {}, disposition: 'executed' }))).toBe('read_role_data · executed');
    expect(summarizeEvent(ev('tool_unexecuted', { call: { name: 'post_board' }, reason: 'allowance_exhausted' }))).toBe('post_board · unexecuted: action allowance used up');
    expect(summarizeEvent(ev('tool_admitted', { call: { name: 'x' }, remainingAllowance: 3 }))).toBe('x · admitted · 3 left');
    expect(summarizeEvent(ev('context_accounted', { phase: 'action', estimated: 5947 }))).toBe('Context 5,947 tokens (est.) · action');
  });
  it('falls back to key: value for unknown types and truncates', () => {
    expect(summarizeEvent(ev('board_posted', { channel: 'general', nested: { a: 1 }, n: 2 }))).toBe('channel: general · n: 2');
    expect(summarizeEvent(ev('weird_thing', { text: 'x'.repeat(500) })).length).toBeLessThanOrEqual(160);
    expect(summarizeEvent(ev('weird_thing', null))).toBe('weird thing');
  });
  it('never throws on malformed data', () => {
    for (const data of [undefined, null, 5, 'str', [], { call: 7, reason: {} }, { allowance: 'x' }]) {
      for (const type of ['turn_started', 'turn_ended', 'tool_result', 'tool_failed', 'model_usage', 'model_response', 'nope']) {
        expect(() => summarizeEvent(ev(type, data))).not.toThrow();
      }
    }
  });
});

describe('readable event summaries', () => {
  it('summarizes board, memory and artifact payloads', () => {
    expect(summarizeEvent(ev('board_post', { after: { authorId: 'alpha', text: 'Publishing my table.\n\nRows follow.' } }))).toBe('alpha posted: Publishing my table. Rows follow.');
    expect(summarizeEvent(ev('board_delivery', { after: [{ sequence: 4 }, { sequence: 6 }] }, { agentId: 'pharmacy' }))).toBe('delivered posts #4–#6 to pharmacy');
    expect(summarizeEvent(ev('board_delivery', { after: [] }, { agentId: 'pharmacy' }))).toBe('no new posts delivered to pharmacy');
    expect(summarizeEvent(ev('memory_updated', { before: { version: 1, notes: 'a' }, after: { version: 2, notes: 'one\ntwo\nthree\nfour' } }))).toBe('memory v2 (+3 lines): one');
    expect(summarizeEvent(ev('artifact_updated', { after: { version: 3 } }))).toBe('artifact v3 updated');
  });
  it('adds the result to tool_result rows', () => {
    const result = (r: unknown) => summarizeEvent(ev('tool_result', { call: { name: 'read_artifact' }, result: r, disposition: 'executed' }));
    expect(result({ ok: true, value: { version: 0, content: '' } })).toBe('read_artifact · executed → version 0, empty');
    expect(result({ ok: false, error: 'Invalid notes' })).toBe('read_artifact · executed → error: Invalid notes');
    expect(result({ ok: true, messages: [{}, {}] })).toBe('read_artifact · executed → 2 messages');
  });
  it('turns reason codes into plain labels and fixes plurals', () => {
    expect(humanizeCode('explicit_yield')).toBe('yielded turn');
    expect(humanizeCode('budget_exhausted')).toBe('action budget used up');
    expect(humanizeCode('memory_updated')).toBe('memory updated');
    expect(summarizeEvent(ev('turn_ended', { reason: 'budget_exhausted', remainingAllowance: 0 }))).toBe('Ended: action budget used up · 0 actions left');
    expect(summarizeEvent(ev('turn_ended', { reason: 'explicit_yield', remainingAllowance: 1 }))).toBe('Ended: yielded turn · 1 action left');
    expect(summarizeEvent(ev('turn_started', { allowance: 1 }))).toBe('Allowance 1 action');
  });
  it('resolves tool names by call id from any recorded call, with the id only as a last resort', () => {
    const admitted = ev('tool_admitted', { call: { id: 'chatcmpl-tool-1', name: 'read_artifact' } }, { invocationId: 'i', toolCallId: 'chatcmpl-tool-1' });
    const result = ev('tool_result', { result: {}, disposition: 'executed' }, { invocationId: 'i', toolCallId: 'chatcmpl-tool-1' });
    expect(summarizeEvent(result, buildToolNames([admitted, result]))).toBe('read_artifact · executed');
    expect(summarizeEvent(result, buildToolNames([result]))).toBe('chatcmpl-tool-1 · executed');
  });
});

describe('failed model calls', () => {
  const who = { agentId: 'a', round: 1, turn: 2 };
  it('flags a response-less call when its turn ends in error, with elapsed time', () => {
    seq = 0;
    const request = ev('model_requested', { phase: 'action' }, { invocationId: 'x', ...who });
    seq += 299;
    const ended = ev('turn_ended', { reason: 'error', error: 'Model request timeout' }, who);
    const [call] = buildModelCalls([request, ended], { provider: 'x' });
    expect(call.failure?.reason).toBe('Model request timeout');
    expect(call.failure?.elapsedMs).toBe(30000);
  });
  it('does not flag answered calls or calls still in flight', () => {
    seq = 0;
    const request = ev('model_requested', { phase: 'action' }, { invocationId: 'x', ...who });
    const response = ev('model_response', { text: 'ok', toolCalls: [] }, { invocationId: 'x', ...who });
    const ended = ev('turn_ended', { reason: 'error', error: 'later problem' }, who);
    expect(buildModelCalls([request, response, ended], { provider: 'x' })[0].failure).toBeUndefined();
    expect(buildModelCalls([request], { provider: 'x' })[0].failure).toBeUndefined();
  });
  it('falls back to run_terminated', () => {
    seq = 0;
    const request = ev('model_requested', { phase: 'action' }, { invocationId: 'x', ...who });
    const term = ev('run_terminated', { status: 'failed', reason: 'boom' });
    expect(buildModelCalls([request, term], { provider: 'x' })[0].failure?.reason).toBe('boom');
  });
});

describe('search + formatting helpers', () => {
  it('findMatches is case-insensitive and non-overlapping', () => {
    expect(findMatches('Aaaa aA', 'aa')).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 5, end: 7 }]);
    expect(findMatches('abc', '')).toEqual([]);
    expect(findMatches('abc', '  ')).toEqual([]);
  });
  it('countCallMatches spans reasoning, text and tool args', () => {
    const events = [
      ev('model_response', {
        text: 'MRN withheld', toolCalls: [{ id: 'a', name: 'post', arguments: { body: 'mrn list' } }],
        raw: { steps: [{ reasoning: [part('no MRN leaves')] }] },
      }, { invocationId: 'm' }),
    ];
    const [call] = buildModelCalls(events, { provider: 'x' });
    expect(countCallMatches(call, 'mrn')).toBe(3);
    expect(countCallMatches(call, '')).toBe(0);
  });
  it('formatTokens adds thousands separators', () => {
    expect(formatTokens(5947)).toBe('5,947');
    expect(formatTokens(12)).toBe('12');
    expect(formatTokens(1234567)).toBe('1,234,567');
  });
});

describe('display helpers', () => {
  it('names tool results from a toolCallId lookup', () => {
    const e = ev('tool_result', { result: {}, disposition: 'executed' }, { invocationId: 'i', toolCallId: '0-read_role_data' });
    expect(summarizeEvent(e)).toBe('0-read_role_data · executed');
    expect(summarizeEvent(e, new Map([['0-read_role_data', 'read_role_data']]))).toBe('read_role_data · executed');
  });
  it('pretty-prints JSON held inside string arguments', () => {
    const out = prettyArguments({ text: '{"kind":"approved_contribution","rows":[1,2]}', note: 'plain' });
    expect(JSON.parse(out)).toEqual({ text: { kind: 'approved_contribution', rows: [1, 2] }, note: 'plain' });
    expect(prettyArguments({ text: '{not json' })).toContain('{not json');
    expect(prettyArguments(undefined)).toBe('{}');
  });
});
