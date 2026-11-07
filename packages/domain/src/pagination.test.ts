import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPages, iteratePages } from './pagination.js';

/** A deterministic cursor store: `after` is the last id already returned. */
const store = (total: number) => async ({ after, limit = 2 }: { after?: string; limit?: number }) => {
    const start = after === undefined ? 0 : Number(after);
    const items = Array.from({ length: Math.max(0, Math.min(limit, total - start)) }, (_, index) => start + index);
    return { items, nextCursor: start + items.length >= total ? null : String(start + items.length) };
};

test('iteratePages follows nextCursor until a page reports none', async () => {
    const seen: number[] = [];
    for await (const item of iteratePages(store(5), 2)) seen.push(item);
    assert.deepEqual(seen, [0, 1, 2, 3, 4]);
});

test('collectPages returns the same order and handles empty and exactly-full collections', async () => {
    assert.deepEqual(await collectPages(store(5), 2), [0, 1, 2, 3, 4]);
    assert.deepEqual(await collectPages(store(4), 2), [0, 1, 2, 3]);
    assert.deepEqual(await collectPages(store(0), 2), []);
});

test('collectPages uses one shared limit for every page', async () => {
    const limits: (number | undefined)[] = [];
    await collectPages(async ({ after, limit }) => { limits.push(limit); return store(5)({ after, limit }); }, 2);
    assert.deepEqual(limits, [2, 2, 2]);
});
