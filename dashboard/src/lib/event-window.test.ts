import { describe, expect, it } from 'vitest';
import type { HarnessEvent } from '@sidechannel/contracts/browser';
import { appendLater, emptyWindow, prependEarlier } from './event-window';

const ev = (sequence: number) => ({ schemaVersion: 1, id: `e${sequence}`, runId: 'r', sequence, type: 't', timestamp: '', data: {} }) as HarnessEvent;
const seqs = (events: HarnessEvent[]) => events.map(e => e.sequence);

describe('event window', () => {
  it('merges by id and keeps sequence order', () => {
    const w = appendLater({ events: [ev(1), ev(2)], hasEarlier: false, hasLater: true }, [ev(2), ev(4), ev(3)], false);
    expect(seqs(w.events)).toEqual([1, 2, 3, 4]);
    expect(w.hasLater).toBe(false);
  });
  it('evicts the oldest past the cap when appending and records that earlier events exist', () => {
    const w = appendLater({ ...emptyWindow, events: [ev(1), ev(2), ev(3)] }, [ev(4)], false, 3);
    expect(seqs(w.events)).toEqual([2, 3, 4]);
    expect(w.hasEarlier).toBe(true);
  });
  it('evicts the newest past the cap when prepending and records that later events exist', () => {
    const w = prependEarlier({ ...emptyWindow, events: [ev(3), ev(4)] }, [ev(1), ev(2)], false, 3);
    expect(seqs(w.events)).toEqual([1, 2, 3]);
    expect(w).toMatchObject({ hasEarlier: false, hasLater: true });
  });
});
