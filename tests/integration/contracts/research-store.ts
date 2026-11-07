import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResearchRecord, ResearchStore } from '@sidechannel/contracts/analysis/store';

export interface ResearchStoreHarness {
    name: string;
    fixture(): Promise<{ store: ResearchStore; dispose(): Promise<void> }>;
}

const record = (id: string, revision = 1): ResearchRecord => ({ id, revision, createdAt: '2026-01-01T00:00:00.000Z' });

export function researchStoreContract(harness: ResearchStoreHarness): void {
    test(`${harness.name}: insert is unique and get returns the stored record`, async (t) => {
        const { store, dispose } = await harness.fixture();
        t.after(dispose);
        assert.equal(await store.insert('records', record('r1')), true);
        assert.equal(await store.insert('records', record('r1')), false);
        assert.deepEqual(await store.get('records', 'r1'), record('r1'));
        assert.equal(await store.get('records', 'missing'), null);
    });

    test(`${harness.name}: replace is a revision match, not a content change`, async (t) => {
        const { store, dispose } = await harness.fixture();
        t.after(dispose);
        await store.insert('records', record('r1'));
        assert.equal(await store.replace('records', 'r1', 1, record('r1')), true);
        assert.equal(await store.replace('records', 'r1', 0, record('r1', 2)), false);
        const next = { ...record('r1', 2), note: 'changed' } as ResearchRecord;
        assert.equal(await store.replace('records', 'r1', 1, next), true);
        assert.deepEqual(await store.get('records', 'r1'), next);
    });

    test(`${harness.name}: pages are ordered by id with an exclusive cursor`, async (t) => {
        const { store, dispose } = await harness.fixture();
        t.after(dispose);
        for (const id of ['r1', 'r2', 'r3', 'r4', 'r5'])
            await store.insert('records', { ...record(id), group: 'a' } as ResearchRecord);
        await store.insert('records', { ...record('r6'), group: 'b' } as ResearchRecord);
        const first = await store.page('records', { group: 'a' }, '', 2);
        assert.deepEqual(first.items.map(item => item.id), ['r1', 'r2']);
        assert.equal(first.nextCursor, 'r2');
        const second = await store.page('records', { group: 'a' }, first.nextCursor!, 10);
        assert.deepEqual(second.items.map(item => item.id), ['r3', 'r4', 'r5']);
        assert.equal(second.nextCursor, null);
    });

    test(`${harness.name}: leases are exclusive, renewable by owner and releasable`, async (t) => {
        const { store, dispose } = await harness.fixture();
        t.after(dispose);
        assert.equal(await store.claim('scope', 'job', 'owner-a', 30_000), true);
        assert.equal(await store.claim('scope', 'job', 'owner-b', 30_000), false);
        assert.equal(await store.renew('scope', 'job', 'owner-b', 30_000), false);
        assert.equal(await store.renew('scope', 'job', 'owner-a', 30_000), true);
        await store.release('scope', 'job', 'owner-b');
        assert.equal(await store.claim('scope', 'job', 'owner-b', 30_000), false);
        await store.release('scope', 'job', 'owner-a');
        assert.equal(await store.claim('scope', 'job', 'owner-b', 30_000), true);
    });
}
