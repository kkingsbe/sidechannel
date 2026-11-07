// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HarnessEvent } from '@sidechannel/contracts/browser';
import { ModelCallDetail } from './ModelCallDetail';

afterEach(cleanup);

let seq = 0;
function ev(type: string, data: unknown, extra: Partial<HarnessEvent> = {}): HarnessEvent {
  seq += 1;
  return {
    schemaVersion: 1, id: `evt-${seq}`, runId: 'run-1', sequence: seq, type,
    timestamp: new Date(Date.UTC(2026, 10, 7, 16, 48, 0, seq * 100)).toISOString(), data, ...extra,
  } as HarnessEvent;
}

function fixture() {
  seq = 0;
  const out: Record<string, HarnessEvent> = {};
  const events: HarnessEvent[] = [];
  for (const inv of ['one', 'two', 'three']) {
    const base = { invocationId: inv, agentId: 'a', round: 1, turn: 1 } as Partial<HarnessEvent>;
    const request = ev('model_requested', { phase: 'action', messages: [], tools: [] }, base);
    const response = ev('model_response', {
      text: `text of ${inv}`,
      toolCalls: [{ id: `tc-${inv}`, name: 'post_board', arguments: { k: inv } }],
      raw: { finishReason: 'tool-calls', steps: [{ reasoning: [{ type: 'reasoning', text: `thinking about ${inv}` }] }] },
    }, base);
    const usage = ev('model_usage', { source: 'provider', usage: { inputTokens: 1, outputTokens: 164, reasoningTokens: 211 } }, base);
    const admitted = ev('tool_admitted', {}, { ...base, toolCallId: `tc-${inv}` });
    out[`${inv}Response`] = response;
    out[`${inv}Request`] = request;
    out[`${inv}Admitted`] = admitted;
    events.push(request, response, usage, admitted);
  }
  return { events, ...out } as { events: HarnessEvent[] } & Record<`${'one' | 'two' | 'three'}${'Request' | 'Response' | 'Admitted'}`, HarnessEvent>;
}

const setup = (which: 'one' | 'two' | 'three', extra: Partial<React.ComponentProps<typeof ModelCallDetail>> = {}) => {
  const f = fixture();
  const onNavigate = vi.fn();
  const event = f[`${which}Response`];
  render(<ModelCallDetail event={event} events={f.events} provider="openai" onNavigate={onNavigate} {...extra} />);
  return { ...f, onNavigate };
};

it('shows the readable view by default with usage tiles and the proposals note', () => {
  setup('two');
  expect(screen.getByText('Call #5 · 2 of 3 in the loaded turns')).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Readable' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText('thinking about two')).toBeTruthy();
  expect(screen.getByText('text of two')).toBeTruthy();
  expect(screen.getByText('post_board')).toBeTruthy();
  for (const label of ['Context (est.)', 'Output', 'Reasoning', 'Finish']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  expect(screen.getByText('tool-calls', { selector: 'dd' })).toBeTruthy();
  expect(screen.getByText(/Tool requests are proposals until an admission and result are recorded/)).toBeTruthy();
});

it('navigates to neighbouring calls and disables at the ends', async () => {
  const { onNavigate, oneResponse, threeResponse } = setup('two');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Previous model call' }));
  expect(onNavigate).toHaveBeenLastCalledWith(oneResponse.id, oneResponse.sequence);
  await user.click(screen.getByRole('button', { name: 'Next model call' }));
  expect(onNavigate).toHaveBeenLastCalledWith(threeResponse.id, threeResponse.sequence);
  cleanup();
  setup('one');
  expect((screen.getByRole('button', { name: 'Previous model call' }) as HTMLButtonElement).disabled).toBe(true);
  cleanup();
  setup('three');
  expect((screen.getByRole('button', { name: 'Next model call' }) as HTMLButtonElement).disabled).toBe(true);
});

it('navigates to linked events and offers Open in Model & traces', async () => {
  const onOpenTraces = vi.fn();
  const { onNavigate, twoRequest } = setup('two', { onOpenTraces });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: `Request #${twoRequest.sequence}` }));
  expect(onNavigate).toHaveBeenLastCalledWith(twoRequest.id, twoRequest.sequence);
  await user.click(screen.getByRole('button', { name: 'Open in Model & traces' }));
  expect(onOpenTraces).toHaveBeenCalledWith('two');
});

it('falls back to the JSON view for an unknown invocation', () => {
  const f = fixture();
  const stray = ev('model_response', { text: 'x' }, { invocationId: 'ghost' });
  render(<ModelCallDetail event={stray} events={f.events} provider="openai" onNavigate={vi.fn()} />);
  expect(screen.queryByRole('tablist')).toBeNull();
  expect(screen.getByText('Recorded payload')).toBeTruthy();
});

it('shows the event JSON on the Raw JSON tab', async () => {
  const { twoResponse } = setup('two');
  await userEvent.setup().click(screen.getByRole('tab', { name: 'Raw JSON' }));
  expect(screen.getByRole('tab', { name: 'Raw JSON' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.queryByText('thinking about two')).toBeNull();
  expect(document.querySelector('pre')!.textContent).toContain(twoResponse.id);
});
