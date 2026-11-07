// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HarnessEvent } from '@sidechannel/contracts/browser';
import { TimelinePanel } from './TimelinePanel';

let seq = 0;
function ev(type: string, data: unknown, extra: Partial<HarnessEvent> = {}): HarnessEvent {
  seq += 1;
  return {
    schemaVersion: 1, id: `evt-${seq}`, runId: 'run-1', sequence: seq, type,
    timestamp: new Date(Date.UTC(2026, 10, 7, 16, 48, 0, seq * 100)).toISOString(), data,
    agentId: 'clinical_records', round: 1, turn: 1, ...extra,
  } as HarnessEvent;
}

function fixture(): HarnessEvent[] {
  seq = 0;
  const inv1 = { invocationId: 'inv-1' };
  const inv2 = { invocationId: 'inv-2' };
  return [
    ev('run_started', {}, { agentId: undefined, round: undefined, turn: undefined }),
    ev('turn_started', { allowance: 8 }),
    ev('context_accounted', { estimated: 5947, phase: 'action' }, inv1),
    ev('model_requested', { phase: 'action', messages: [{}], tools: [{}] }, inv1),
    ev('model_response', {
      text: '', toolCalls: [{ id: 'tc1', name: 'read_role_data', arguments: {} }],
      raw: { finishReason: 'tool-calls', steps: [{ reasoning: [{ type: 'reasoning', text: 'I should read my role data first.' }] }] },
    }, inv1),
    ev('model_usage', { source: 'provider', usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 128 } }, inv1),
    ev('tool_requested', { call: { name: 'read_role_data' } }, { ...inv1, toolCallId: 'tc1' }),
    ev('tool_admitted', {}, { ...inv1, toolCallId: 'tc1' }),
    ev('tool_result', { call: { name: 'read_role_data' } }, { ...inv1, toolCallId: 'tc1' }),
    ev('model_requested', { phase: 'action' }, inv2),
    ev('model_response', { text: 'Done.', toolCalls: [] }, inv2),
    ev('model_usage', { source: 'provider', usage: { inputTokens: 3, outputTokens: 2, reasoningTokens: 0 } }, inv2),
    ev('board_posted', { text: 'Site aggregates only.' }),
    ev('turn_ended', { reason: 'agent', remainingAllowance: 5 }),
  ];
}

function setup(events = fixture()) {
  const onInspect = vi.fn();
  const onOpenTraces = vi.fn();
  render(<TimelinePanel events={events} provider="adaption" onInspect={onInspect} onOpenTraces={onOpenTraces} />);
  return { onInspect, onOpenTraces, user: userEvent.setup() };
}

beforeEach(() => { try { window.localStorage.clear(); } catch { /* ignore */ } });
afterEach(cleanup);

describe('TimelinePanel readable mode', () => {
  it('folds model events into one row per call and hides tool_requested/admitted', () => {
    setup();
    expect(screen.getAllByText('model call')).toHaveLength(2);
    expect(screen.queryByText('model requested')).toBeNull();
    expect(screen.queryByText('model usage')).toBeNull();
    expect(screen.queryByText('context accounted')).toBeNull();
    expect(screen.queryByText('tool requested')).toBeNull();
    expect(screen.queryByText('tool admitted')).toBeNull();
    expect(screen.getByText('tool result')).toBeTruthy();
    expect(screen.getByText(/#3–6 · R1 \/ T1 · action/)).toBeTruthy();
  });

  it('renders turn group headers with a summary', () => {
    setup();
    const header = screen.getByTestId('turn-header');
    expect(within(header).getByText('Round 1 · Turn 1')).toBeTruthy();
    expect(within(header).getByText('clinical_records')).toBeTruthy();
    expect(within(header).getByText('3 of 8 actions used · 2 model calls · reasoning on 1')).toBeTruthy();
    expect(screen.getAllByTestId('turn-header')).toHaveLength(1);
  });

  it('collapses a turn', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Collapse turn' }));
    expect(screen.queryByText('model call')).toBeNull();
    expect(screen.getByRole('button', { name: 'Expand turn' })).toBeTruthy();
  });

  it('shows reasoning after Show full and via expand all', async () => {
    const { user } = setup();
    const show = screen.getByRole('button', { name: /Show full/ });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    await user.click(show);
    expect(screen.getByRole('button', { name: /^Collapse$/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('I should read my role data first.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Collapse$/ }));
    expect(screen.getByRole('button', { name: /Show full/ })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Expand all reasoning/ }));
    expect(screen.queryByRole('button', { name: /Show full/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Collapse$/ })).toBeTruthy();
    expect(window.localStorage.getItem('sidechannel.timeline.expandAll')).toBe('true');
  });

  it('shows the not_returned notice when there are no parts and 0 reasoning tokens', () => {
    setup();
    expect(screen.getByText(/Provider reported 0 reasoning tokens/)).toBeTruthy();
  });

  it('shows board text as a quote and summaries for other rows', () => {
    setup();
    expect(screen.getByText('Site aggregates only.').tagName).toBe('BLOCKQUOTE');
    expect(screen.getByText('Allowance 8 actions')).toBeTruthy();
  });

  it('routes inspect and open-traces clicks to the right ids', async () => {
    const { user, onInspect, onOpenTraces } = setup();
    await user.click(screen.getByRole('button', { name: 'Open model call #5' }));
    expect(onInspect).toHaveBeenLastCalledWith('evt-5', 5);
    await user.click(screen.getByRole('button', { name: 'Open event #2' }));
    expect(onInspect).toHaveBeenLastCalledWith('evt-2', 2);
    // tool pill targets the status event (tool_result, seq 9)
    await user.click(screen.getByRole('button', { name: /read_role_data executed/ }));
    expect(onInspect).toHaveBeenLastCalledWith('evt-9', 9);
    await user.click(screen.getByRole('button', { name: 'Open in Traces' }));
    expect(onOpenTraces).toHaveBeenCalledWith('inv-2');
  });

  it('falls back to the earliest model event when the response is not on the page', async () => {
    seq = 0;
    const events = [
      ev('model_requested', { phase: 'action' }, { invocationId: 'x' }),
      ev('model_usage', { source: 'provider', usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 1 } }, { invocationId: 'x' }),
    ];
    const { user, onInspect } = setup(events);
    expect(screen.getAllByText('model call')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Open model call #1' }));
    expect(onInspect).toHaveBeenCalledWith('evt-1', 1);
  });

  it('unfolds: model events become rows but the response keeps its body', async () => {
    const { user } = setup();
    await user.click(screen.getByLabelText('Fold request & usage into model calls'));
    expect(screen.queryByText('model call')).toBeNull();
    expect(screen.getAllByText('model requested')).toHaveLength(2);
    expect(screen.getAllByText('tool requested')).toHaveLength(1);
    expect(screen.getAllByText('model response')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Show full/ })).toBeTruthy();
    expect(window.localStorage.getItem('sidechannel.timeline.fold')).toBe('false');
  });
});

describe('TimelinePanel readable payloads, failures and paging', () => {
  const post = 'Publishing my approved priority-points table.\n\nclinical_records contributions\n- C-2AU4J: 10';

  it('gives each row a one-line payload summary instead of restating its title', () => {
    seq = 0;
    const events = [
      ev('board_post', { after: { authorId: 'alpha', sequence: 1, text: post } }, { toolCallId: 'tc-p' }),
      ev('board_delivery', { after: [{ sequence: 1, text: 'a' }, { sequence: 2, text: 'b' }, { sequence: 3, text: 'c' }] }, { agentId: 'pharmacy' }),
      ev('memory_updated', { before: { version: 1, notes: 'old' }, after: { version: 2, notes: 'Plan A\nplan b\nplan c\nplan d' } }),
      ev('turn_ended', { reason: 'explicit_yield', remainingAllowance: 1 }),
    ];
    setup(events);
    expect(screen.getByText('board post')).toBeTruthy();
    expect(screen.getByText(/alpha posted: Publishing my approved priority-points table\./)).toBeTruthy();
    expect(screen.getByText('delivered posts #1–#3 to pharmacy')).toBeTruthy();
    expect(screen.getByText('memory v2 (+3 lines): Plan A')).toBeTruthy();
    expect(screen.getByText('Ended: yielded turn · 1 action left')).toBeTruthy();
  });

  it('names a tool result by its tool, not its call id, even when the call is on another page', () => {
    seq = 0;
    const events = [
      ev('tool_admitted', { call: { id: 'chatcmpl-tool-a7056f', name: 'read_artifact', arguments: {} } }, { invocationId: 'inv-9', toolCallId: 'chatcmpl-tool-a7056f' }),
      ev('tool_result', { result: { ok: true, value: { version: 0, content: '' } }, disposition: 'executed' }, { invocationId: 'inv-9', toolCallId: 'chatcmpl-tool-a7056f' }),
    ];
    setup(events);
    expect(screen.getByText('read_artifact · executed → version 0, empty')).toBeTruthy();
    expect(screen.queryByText(/chatcmpl-tool-a7056f ·/)).toBeNull();
  });

  it('renders a timed-out model call as failed with the reason and elapsed time', () => {
    seq = 0;
    const inv = { invocationId: 'inv-t' };
    const events = [
      ev('turn_started', { allowance: 8 }),
      ev('model_requested', { phase: 'action', messages: [], tools: [] }, inv),
    ];
    seq += 299;
    events.push(
      ev('turn_ended', { reason: 'error', error: 'Model request timeout' }),
      ev('run_terminated', { status: 'failed', reason: 'Model request timeout' }, { agentId: undefined, round: undefined, turn: undefined }),
    );
    setup(events);
    const row = screen.getByText('Failed').closest('li')!;
    expect(row.className).toContain('tl-row-error');
    expect(row.textContent).toContain('Model request timeout');
    expect(row.textContent).toContain('30.0 s');
    expect(screen.queryByText(/No text output/)).toBeNull();
    expect(screen.queryByText(/No reasoning recorded/)).toBeNull();
    const ended = document.querySelector('[data-type="turn_ended"]')!;
    expect(ended.className).toContain('tl-row-error');
    expect(document.querySelector('[data-type="run_terminated"]')!.className).toContain('tl-row-error');
  });

  it('uses an Inspect affordance rather than a play icon', () => {
    setup();
    expect(screen.getAllByText('Inspect').length).toBeGreaterThan(0);
  });

  it('notes hidden reasoning once for the page', () => {
    seq = 0;
    const events = [
      ev('model_requested', { phase: 'action' }, { invocationId: 'h1' }),
      ev('model_response', { text: 'a', toolCalls: [] }, { invocationId: 'h1' }),
      ev('model_usage', { source: 'provider', usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 64 } }, { invocationId: 'h1' }),
      ev('model_requested', { phase: 'action' }, { invocationId: 'h2' }),
      ev('model_response', { text: 'b', toolCalls: [] }, { invocationId: 'h2' }),
      ev('model_usage', { source: 'provider', usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 32 } }, { invocationId: 'h2' }),
    ];
    setup(events);
    expect(screen.getAllByText(/Provider hid reasoning on all 2 model calls in the loaded turns/)).toHaveLength(1);
    expect(screen.queryByText('Reasoning hidden by provider.')).toBeNull();
    expect(screen.getByText(/64 reasoning tokens/)).toBeTruthy();
  });

  it('shows prose tool arguments as text, not JSON, in the call row', () => {
    seq = 0;
    const events = [
      ev('model_requested', { phase: 'action' }, { invocationId: 'p1' }),
      ev('model_response', { text: '', toolCalls: [{ id: 'tp', name: 'post_board', arguments: { text: post } }] }, { invocationId: 'p1' }),
    ];
    setup(events);
    expect(document.querySelector('.mc-tool-prose')!.textContent).toBe(post);
    expect(screen.queryByText(/\{"text"/)).toBeNull();
  });

  it('marks turns cut by a page edge and offers Jump to latest', async () => {
    seq = 0;
    const events = [ev('model_requested', { phase: 'action' }, { invocationId: 'c1' })];
    const onJump = vi.fn();
    render(<TimelinePanel events={events} provider="adaption" onInspect={vi.fn()} onOpenTraces={vi.fn()} paging={{ hasPrevious: true, hasNext: true, onJumpToLatest: onJump }} />);
    expect(screen.getByText('Continued from previous page')).toBeTruthy();
    expect(screen.getByText('Continues on next page')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Jump to latest' }));
    expect(onJump).toHaveBeenCalled();
  });
});

describe('TimelinePanel raw mode', () => {
  it('shows JSON previews and inspects on click', async () => {
    const { user, onInspect } = setup();
    await user.click(screen.getByRole('button', { name: 'Raw events' }));
    expect(screen.getByRole('button', { name: 'Raw events' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('turn-header')).toBeNull();
    expect(screen.getByText(/"allowance": 8/)).toBeTruthy();
    expect(screen.getAllByText('model requested').length).toBe(2);
    await user.click(screen.getByText(/"allowance": 8/));
    expect(onInspect).toHaveBeenCalledWith('evt-2', 2);
    expect(window.localStorage.getItem('sidechannel.timeline.mode')).toBe('raw');
  });

  it('restores the persisted mode', () => {
    window.localStorage.setItem('sidechannel.timeline.mode', 'raw');
    setup();
    expect(screen.getByRole('button', { name: 'Raw events' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('TimelinePanel live mode', () => {
  function pendingLog(): HarnessEvent[] {
    seq = 0;
    const inv = { invocationId: 'inv-9' };
    return [
      ev('turn_started', { allowance: 8 }),
      ev('context_accounted', { estimated: 10, phase: 'action' }, inv),
      ev('model_requested', { phase: 'action' }, inv),
    ];
  }
  it('marks the newest unanswered model call as waiting while live', () => {
    render(<TimelinePanel events={pendingLog()} provider="adaption" live onInspect={vi.fn()} onOpenTraces={vi.fn()} />);
    expect(screen.getByText(/Waiting for model response/)).toBeTruthy();
  });
  it('shows no waiting state when not live, or once later events exist', () => {
    const events = pendingLog();
    render(<TimelinePanel events={events} provider="adaption" onInspect={vi.fn()} onOpenTraces={vi.fn()} />);
    expect(screen.queryByText(/Waiting for model response/)).toBeNull();
    cleanup();
    render(<TimelinePanel events={[...events, ev('turn_ended', { remainingAllowance: 8 })]} provider="adaption" live onInspect={vi.fn()} onOpenTraces={vi.fn()} />);
    expect(screen.queryByText(/Waiting for model response/)).toBeNull();
  });
});
