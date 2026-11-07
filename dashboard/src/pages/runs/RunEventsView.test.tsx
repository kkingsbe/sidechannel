// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { HarnessEvent, TurnSummary } from '@sidechannel/contracts/browser';
import { TurnNavigator } from './TurnNavigator';
import { useFollowScroll } from './use-follow-scroll';

afterEach(cleanup);
const ev = (sequence: number) => ({ schemaVersion: 1, id: `e${sequence}`, runId: 'r', sequence, type: 't', timestamp: '', data: {} }) as HarnessEvent;
const turns: TurnSummary[] = [
  { agentId: 'alpha', round: 1, turn: 1, firstSequence: 2, lastSequence: 6, eventCount: 5, modelCalls: 1, failures: 1 },
  { agentId: 'beta', round: 1, turn: 2, firstSequence: 7, lastSequence: 9, eventCount: 3, modelCalls: 1, failures: 0 },
];

describe('TurnNavigator', () => {
  it('selects the turn containing the start, labels turns and jumps to a turn or the newest events', () => {
    const onJump = vi.fn();
    render(<TurnNavigator turns={turns} start={8} onJump={onJump} />);
    const select = screen.getByLabelText('Jump to turn') as HTMLSelectElement;
    expect(select.value).toBe('7');
    expect(screen.getByRole('option', { name: 'Round 1 · Turn 1 · alpha · 5 events · 1 failed' })).toBeTruthy();
    expect(screen.getByText('2 turns · 8 events in turns')).toBeTruthy();
    fireEvent.change(select, { target: { value: '2' } });
    expect(onJump).toHaveBeenLastCalledWith(2);
    fireEvent.change(select, { target: { value: 'end' } });
    expect(onJump).toHaveBeenLastCalledWith('end');
  });
});

describe('useFollowScroll', () => {
  it('keeps the end in view while pinned and counts arrivals once the reader scrolls up', () => {
    const end = document.createElement('div');
    document.body.append(end);
    const scrollIntoView = vi.fn();
    end.scrollIntoView = scrollIntoView;
    let bottom = 0;
    end.getBoundingClientRect = () => ({ bottom }) as DOMRect;
    const ref = { current: end };
    const { result, rerender } = renderHook(({ events }) => useFollowScroll(ref, events, true), { initialProps: { events: [ev(1)] } });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    rerender({ events: [ev(1), ev(2)] });
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(result.current.unseen).toBe(0);
    bottom = 5000;
    act(() => { window.dispatchEvent(new Event('scroll')); });
    rerender({ events: [ev(1), ev(2), ev(3), ev(4)] });
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(result.current.unseen).toBe(2);
    act(() => result.current.jump());
    expect(result.current.unseen).toBe(0);
    end.remove();
  });
});
