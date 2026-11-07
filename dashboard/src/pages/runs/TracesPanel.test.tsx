// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HarnessEvent } from '@sidechannel/contracts/browser';
import { TracesPanel } from './TracesPanel';

afterEach(cleanup);

let seq = 0;
function ev(type: string, data: unknown, extra: Partial<HarnessEvent> = {}): HarnessEvent {
  seq += 1;
  return {
    schemaVersion: 1, id: `evt-${seq}`, runId: 'run-1', sequence: seq, type,
    timestamp: new Date(Date.UTC(2026, 10, 7, 16, 48, 0, seq * 100)).toISOString(), data, ...extra,
  } as HarnessEvent;
}

/** request -> response -> usage for one invocation. */
function call(inv: string, opts: {
  reasoning?: string[]; text?: string; tool?: { id: string; name: string; arguments: unknown };
  reasoningTokens?: number; messages?: unknown[]; phase?: string;
}) {
  const base = { invocationId: inv, agentId: 'clinical_records', round: 1, turn: 1 } as Partial<HarnessEvent>;
  const request = ev('model_requested', { phase: opts.phase ?? 'action', messages: opts.messages ?? [{ role: 'user', content: 'hi' }], tools: [{ name: 't' }] }, base);
  const response = ev('model_response', {
    text: opts.text ?? '',
    toolCalls: opts.tool ? [opts.tool] : [],
    raw: { finishReason: 'tool-calls', steps: [{ reasoning: (opts.reasoning ?? []).map(text => ({ type: 'reasoning', text })) }] },
  }, base);
  const usage = ev('model_usage', { source: 'provider', usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: opts.reasoningTokens ?? 0 } }, base);
  return { request, response, usage, all: [request, response, usage] };
}

function fixture() {
  seq = 0;
  const a = call('inv-a', { reasoning: ['I should read the withheld role data first.'], tool: { id: 't1', name: 'read_role_data', arguments: { scope: 'withheld' } }, reasoningTokens: 128, messages: [
    { role: 'system', content: 'You are the clinical records agent.' },
    { role: 'user', content: [{ type: 'text', text: 'Post the cohort summary.' }] },
  ] });
  const b = call('inv-b', { reasoning: [], text: 'Posting aggregates.', reasoningTokens: 0 });
  const c = call('inv-c', { reasoning: ['Second reasoning with withheld identifiers.'], text: 'Identifiers withheld.', reasoningTokens: 30 });
  return { a, b, c, events: [...a.all, ...b.all, ...c.all] };
}

const setup = (onInspect = vi.fn(), focusInvocationId?: string) => {
  const f = fixture();
  render(<TracesPanel events={f.events} provider="openai" onInspect={onInspect} focusInvocationId={focusInvocationId} />);
  return { ...f, onInspect };
};

describe('TracesPanel', () => {
  it('renders one card per invocation with reasoning, output and tool arguments', () => {
    setup();
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(3);
    expect(within(cards[0]).getByText(/read the withheld role data/)).toBeTruthy();
    expect(within(cards[0]).getByText('read_role_data')).toBeTruthy();
    expect(within(cards[0]).getByText('Scope')).toBeTruthy();
    expect(within(cards[0]).getByText('withheld')).toBeTruthy();
    expect(within(cards[1]).getByText('Posting aggregates.')).toBeTruthy();
    expect(screen.getByText('Round 1 · Turn 1')).toBeTruthy();
    expect(screen.getByText(/Reasoning returned on/).textContent).toContain('2 of 3 on this page');
    expect(screen.getByText(/158/)).toBeTruthy();
  });

  it('counts matches across calls, moves the active mark, and never filters', async () => {
    setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Find in reasoning, output and arguments'), 'withheld');
    // card 1: reasoning + args; card 3: reasoning + output text ("Identifiers withheld.")
    expect(document.querySelector('[aria-live="polite"]')!.textContent).toBe('1 of 4');
    expect(screen.getAllByRole('article')).toHaveLength(3);
    const active = () => Array.from(document.querySelectorAll('mark.mc-mark')).findIndex(m => m.classList.contains('mc-mark-active'));
    expect(document.querySelectorAll('mark.mc-mark')).toHaveLength(4);
    expect(active()).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Next match' }));
    expect(document.querySelector('[aria-live="polite"]')!.textContent).toBe('2 of 4');
    expect(active()).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Previous match' }));
    expect(active()).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Previous match' }));
    expect(active()).toBe(3);
    await user.click(screen.getByLabelText('Find in reasoning, output and arguments'));
    await user.keyboard('{Enter}');
    expect(document.querySelector('[aria-live="polite"]')!.textContent).toBe('1 of 4');
    expect(screen.getAllByText(/matches/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(document.querySelectorAll('mark.mc-mark')).toHaveLength(0);
  });

  it('filters to calls with reasoning on request', async () => {
    setup();
    await userEvent.setup().click(screen.getByLabelText('Only calls with reasoning'));
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByText('Posting aggregates.')).toBeNull();
  });

  it('shows the not-returned strip for zero-reasoning-token calls', () => {
    setup();
    const card = screen.getAllByRole('article')[1];
    expect(within(card).getByText('Reasoning not returned.')).toBeTruthy();
    expect(within(card).getByText(/Unavailable reasoning is not evidence of absent intent/)).toBeTruthy();
  });

  it('discloses input messages', async () => {
    setup();
    const card = screen.getAllByRole('article')[0];
    const toggle = within(card).getByRole('button', { name: /Input · 2 messages · 1 tools available/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await userEvent.setup().click(toggle);
    expect(within(card).getByText('system')).toBeTruthy();
    expect(within(card).getByText('You are the clinical records agent.')).toBeTruthy();
    expect(within(card).getByText('Post the cohort summary.')).toBeTruthy();
  });

  it('opens request, response and usage events', async () => {
    const { a, onInspect } = setup();
    const user = userEvent.setup();
    const card = screen.getAllByRole('article')[0];
    await user.click(within(card).getByRole('button', { name: `Request #${a.request.sequence}` }));
    await user.click(within(card).getByRole('button', { name: `Response #${a.response.sequence}` }));
    await user.click(within(card).getByRole('button', { name: `Usage #${a.usage.sequence}` }));
    expect(onInspect.mock.calls).toEqual([
      [a.request.id, a.request.sequence],
      [a.response.id, a.response.sequence],
      [a.usage.id, a.usage.sequence],
    ]);
  });

  it('pretty-prints report text that parses as JSON', () => {
    seq = 0;
    const r = call('inv-r', { phase: 'report', text: '{"verdict":"ok"}' });
    render(<TracesPanel events={r.all} provider="openai" onInspect={vi.fn()} />);
    expect(screen.getByText('Report phase')).toBeTruthy();
    expect(screen.getByText('parsed')).toBeTruthy();
    expect(screen.getByText(/"verdict": "ok"/)).toBeTruthy();
  });

  it('shows empty states', () => {
    render(<TracesPanel events={[]} provider="openai" onInspect={vi.fn()} />);
    expect(screen.getByText('No model calls on this page')).toBeTruthy();
  });
});

describe('TracesPanel paging, prose arguments and failures', () => {
  const longPost = '[clinical_records round 1/3]\n\nclinical_records contributions\n- C-2AU4J: 10\n- C-9XZ11: 4';

  it('renders prose arguments as wrapped text, stacked below the output, with a Raw JSON toggle', async () => {
    seq = 0;
    const c = call('inv-p', { text: 'Posting.', tool: { id: 'tp', name: 'post_board', arguments: { text: longPost } }, reasoningTokens: 0 });
    render(<TracesPanel events={c.all} provider="openai" onInspect={vi.fn()} />);
    const card = screen.getByRole('article');
    const prose = within(card).getByText(/clinical_records contributions/);
    expect(prose.className).toContain('rv-prose');
    expect(prose.textContent).toContain('- C-2AU4J: 10');
    expect(card.querySelector('.tr-body-stack')).toBeTruthy();
    await userEvent.setup().click(within(card).getByRole('button', { name: 'Raw JSON' }));
    expect(card.querySelector('pre.rv-raw')!.textContent).toContain('"text"');
  });

  it('labels calls by event sequence and chips as page-scoped', () => {
    setup();
    expect(screen.getByRole('article', { name: 'Model call #1' })).toBeTruthy();
    expect(screen.getByRole('article', { name: 'Model call #7' })).toBeTruthy();
    expect(document.querySelector('.tr-chip')!.textContent).toBe('3 calls on this page');
  });

  it('keeps the same call label when the call is on a later page', () => {
    const f = fixture();
    render(<TracesPanel events={f.c.all} provider="openai" onInspect={vi.fn()} />);
    expect(screen.getByRole('article', { name: 'Model call #7' })).toBeTruthy();
  });

  it('flags turns split by a page edge and offers Jump to latest', async () => {
    const f = fixture();
    const onJump = vi.fn();
    render(<TracesPanel events={f.events} provider="openai" onInspect={vi.fn()} paging={{ hasPrevious: true, hasNext: true, onJumpToLatest: onJump }} />);
    expect(screen.getByText('Continued from previous page')).toBeTruthy();
    expect(screen.getByText('Continues on next page')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Jump to latest' }));
    expect(onJump).toHaveBeenCalled();
  });

  it('shows one page-level note when the provider hid reasoning, not a notice per card', () => {
    seq = 0;
    const a = call('inv-h1', { reasoningTokens: 90, text: 'a' });
    const b = call('inv-h2', { reasoningTokens: 40, text: 'b' });
    render(<TracesPanel events={[...a.all, ...b.all]} provider="openai" onInspect={vi.fn()} />);
    expect(screen.getAllByText(/Provider hid reasoning on all 2 calls on this page/)).toHaveLength(1);
    expect(screen.queryByText('Reasoning hidden by provider.')).toBeNull();
    expect(screen.getByText(/90 reasoning tokens/)).toBeTruthy();
  });

  it('renders a call with no response as failed with the reason and elapsed time', () => {
    seq = 0;
    const base = { invocationId: 'inv-f', agentId: 'clinical_records', round: 1, turn: 1 } as Partial<HarnessEvent>;
    const request = ev('model_requested', { phase: 'action', messages: [], tools: [] }, base);
    seq += 299; // the turn ends 30 s after the request
    const ended = ev('turn_ended', { reason: 'error', error: 'Model request timeout' }, { agentId: 'clinical_records', round: 1, turn: 1 });
    render(<TracesPanel events={[request, ended]} provider="openai" onInspect={vi.fn()} />);
    const card = screen.getByRole('article');
    expect(card.getAttribute('data-failed')).toBe('true');
    expect(within(card).getByRole('alert').textContent).toContain('Model request timeout');
    expect(within(card).getByRole('alert').textContent).toContain('30.0 s');
    expect(within(card).queryByText(/No text output/)).toBeNull();
  });
});
