// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { HarnessEvent } from '@sidechannel/contracts/browser';
import { FakeEventSource } from '../testing/fake-event-source';
import { useRunEvents } from './use-run-events';

const ev = (sequence: number) => ({ schemaVersion: 1, id: `e${sequence}`, runId: 'run-1', sequence, type: 'step', timestamp: '2026-11-07T12:00:00Z', agentId: 'alpha', round: 1, turn: 1, data: {} }) as HarnessEvent;
function mockPages(page: (path: string) => unknown) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const path = String(input).replace(/^\/api/, '');
    calls.push(path);
    return new Response(JSON.stringify(page(path)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return calls;
}

beforeEach(() => { FakeEventSource.reset(); vi.stubGlobal('EventSource', FakeEventSource); });
afterEach(() => vi.unstubAllGlobals());

describe('useRunEvents', () => {
  it('opens at the newest turn, then follows the stream until the run ends', async () => {
    const calls = mockPages(() => ({ events: [ev(4), ev(5)], hasMore: true }));
    const { result } = renderHook(() => useRunEvents('run-1', { actor: 'alpha' }, { start: 'latest', follow: true, enabled: true }));
    await waitFor(() => expect(result.current.events.map(e => e.sequence)).toEqual([4, 5]));
    expect(result.current.hasEarlier).toBe(true);
    expect(calls[0]).toContain('before=9007199254740991');
    expect(calls[0]).toContain('snap=turn');
    expect(calls[0]).toContain('actor=alpha');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe('/api/runs/run-1/events/stream?actor=alpha&after=5');
    act(() => source.open());
    expect(result.current.status).toBe('live');
    act(() => source.emit('harness_event', ev(6)));
    await waitFor(() => expect(result.current.events.at(-1)?.sequence).toBe(6));
    act(() => source.emit('end', { status: 'completed' }));
    expect(result.current.status).toBe('ended');
  });

  it('opens at an anchor without streaming and loads earlier turns on request', async () => {
    const calls = mockPages(path => path.includes('before=20') ? { events: [ev(18), ev(19)], hasMore: false } : { events: [ev(20), ev(21)], hasMore: false });
    const { result } = renderHook(() => useRunEvents('run-1', {}, { start: 20, follow: false, enabled: true }));
    await waitFor(() => expect(result.current.events).toHaveLength(2));
    expect(calls[0]).toContain('after=19');
    expect(result.current.hasEarlier).toBe(true);
    let added = 0;
    await act(async () => { added = await result.current.loadEarlier(); });
    expect(added).toBe(2);
    expect(result.current.events.map(e => e.sequence)).toEqual([18, 19, 20, 21]);
    expect(result.current.hasEarlier).toBe(false);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('reopens exactly one stream from the new window when filters change while following', async () => {
    mockPages(path => (path.includes('actor=beta') ? { events: [ev(9)], hasMore: false } : { events: [ev(4), ev(5)], hasMore: false }));
    const { result, rerender } = renderHook(({ actor }) => useRunEvents('run-1', { actor }, { start: 'latest', follow: true, enabled: true }), { initialProps: { actor: 'alpha' } });
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    rerender({ actor: 'beta' });
    await waitFor(() => expect(result.current.events.map(e => e.sequence)).toEqual([9]));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    expect(FakeEventSource.instances[0]!.readyState).toBe(FakeEventSource.CLOSED);
    expect(FakeEventSource.instances[1]!.url).toBe('/api/runs/run-1/events/stream?actor=beta&after=9');
  });

  it('falls back to polling when the stream is closed by the browser', async () => {
    mockPages(() => ({ events: [ev(1)], hasMore: false }));
    const { result } = renderHook(() => useRunEvents('run-1', {}, { start: 'latest', follow: true, enabled: true }));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0]!;
    act(() => { source.readyState = FakeEventSource.CLOSED; source.onerror?.(); });
    expect(result.current.status).toBe('polling');
  });
});
