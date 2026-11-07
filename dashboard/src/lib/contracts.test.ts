// @vitest-environment node
import { expect, expectTypeOf, it } from 'vitest';
import type { ArtifactVersion, BoardMessage, HarnessEvent, Run, RunStatus, RunSummary } from '@sidechannel/contracts/browser';
import type { BoardPage, MemoryPage, OffsetPage, Page, RunProgress, RunTab } from './contracts';
import { mergeProgress } from './contracts';
import type { RunsClient } from './clients/runs';

it('declares one cursor envelope and one offset envelope', () => {
    expectTypeOf<Page<{ id: string }>>().toEqualTypeOf<{ items: { id: string }[]; nextCursor: string | null }>();
    expectTypeOf<OffsetPage<{ id: string }>>().toEqualTypeOf<{ items: { id: string }[]; total: number; nextOffset: number | null }>();
    expect(Object.keys({} as Page<never>)).toEqual([]);
});

it('types each /runs/:id/:tab response instead of Record<string, unknown> | unknown[]', () => {
    expectTypeOf<BoardPage['items']>().toEqualTypeOf<BoardMessage[]>();
    expectTypeOf<BoardPage['deliveries']>().toEqualTypeOf<HarnessEvent[]>();
    expectTypeOf<MemoryPage['items']>().toEqualTypeOf<HarnessEvent[]>();
    expectTypeOf<ArtifactVersion>().not.toBeNever();
    expectTypeOf<RunTab>().toEqualTypeOf<'board' | 'artifacts' | 'reports' | 'memory'>();
});

it('keeps the run list a summary and the progress endpoint explicit', () => {
    expectTypeOf<RunSummary['status']>().toEqualTypeOf<RunStatus>();
    expectTypeOf<RunProgress['executionPhase']>().toEqualTypeOf<'action' | 'report'>();
    expectTypeOf<ReturnType<RunsClient['progress']>>().toEqualTypeOf<Promise<RunProgress>>();
});

it('merges progress with an explicit authority order and never partially retypes the record', () => {
    // eslint-disable-next-line no-restricted-syntax -- minimal fixture only exercises mergeProgress
    const run = { id: 'r1', status: 'running', round: 1, turn: 2, updatedAt: 'a', config: { label: 'Frozen' }, board: [], artifacts: [], reports: [], operations: {}, usage: {} } as unknown as Run;
    const progress: RunProgress = { id: 'r1', status: 'completed', round: 3, turn: 6, updatedAt: 'b', observedAt: 'c', executionPhase: 'report', rounds: 7, usage: { tokens: 1 } };
    const merged = mergeProgress(run, progress);
    expect(merged.status).toBe('completed');
    expect(merged.round).toBe(3);
    expect(merged.config).toBe(run.config);
    expect(merged.usage).toEqual({ tokens: 1 });
    expect(mergeProgress(run, undefined)).toBe(run);
});
