// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { defaultFixtureConfiguration } from '@sidechannel/contracts/testing';
import { FakeEventSource } from '../../testing/fake-event-source';
import Runs from '../Runs';

const config = defaultFixtureConfiguration();
const runOf = (status: string) => ({ id: 'run-1', config, configHash: 'abcdef0123456789', status, round: 1, turn: 1, createdAt: '2026-11-07T12:00:00Z', updatedAt: '2026-11-07T12:00:00Z', artifacts: [], reports: [], board: [] });
const event = (sequence: number, type = 'turn_started') => ({ schemaVersion: 1, id: `e${sequence}`, runId: 'run-1', sequence, type, timestamp: '2026-11-07T12:00:00Z', agentId: 'alpha', round: 1, turn: 1, data: {} });
const turns = [{ agentId: 'alpha', round: 1, turn: 1, firstSequence: 2, lastSequence: 5, eventCount: 4, modelCalls: 0, failures: 0 }];

function mockApi(status: string) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const path = String(input).replace(/^\/api/, '');
    calls.push(path);
    const body = path === '/runs/run-1' || path === '/runs/run-1/progress' ? runOf(status)
      : path.startsWith('/runs/run-1/events?') ? { events: [event(4), event(5)], hasMore: true, nextCursor: 5 }
        : path === '/runs/run-1/turns' ? { turns }
          : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return calls;
}
const open = (entry = '/run-1') => render(<MemoryRouter initialEntries={[entry]}><Runs /></MemoryRouter>);

beforeEach(() => { FakeEventSource.reset(); vi.stubGlobal('EventSource', FakeEventSource); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

it('opens an active run at its newest turn and appends streamed events', async () => {
  const calls = mockApi('running');
  open();
  await waitFor(() => expect(calls.some(p => p.startsWith('/runs/run-1/events?') && p.includes('before=9007199254740991') && p.includes('snap=turn'))).toBe(true));
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
  const source = FakeEventSource.instances[0]!;
  expect(source.url).toContain('after=5');
  act(() => source.open());
  expect(await screen.findByText('● Live')).toBeTruthy();
  act(() => source.emit('harness_event', event(6, 'board_posted')));
  expect(await screen.findByText('board posted', { selector: 'strong' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Load earlier turns' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
});

it('opens a finished run at its first event without streaming, and jumps to a turn from the navigator', async () => {
  const calls = mockApi('completed');
  open();
  expect(await screen.findByRole('button', { name: 'Load later turns' })).toBeTruthy();
  expect(calls.some(p => p.startsWith('/runs/run-1/events?') && p.includes('after=0'))).toBe(true);
  expect(FakeEventSource.instances).toHaveLength(0);
  fireEvent.change(await screen.findByLabelText('Jump to turn'), { target: { value: '2' } });
  await waitFor(() => expect(calls.some(p => p.startsWith('/runs/run-1/events?') && p.includes('after=1'))).toBe(true));
});
