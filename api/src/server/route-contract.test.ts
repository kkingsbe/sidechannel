import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { recordRouteContract } from './route-contract-cases.js';

const snapshotPath = fileURLToPath(new URL('./route-contract.snapshot.json', import.meta.url));

test('API route contract snapshot is unchanged', async () => {
    const actual = await recordRouteContract();
    if (process.env.UPDATE_ROUTE_CONTRACT === '1') {
        await writeFile(snapshotPath, JSON.stringify(actual, null, 2) + '\n');
        return;
    }
    const committed: unknown = JSON.parse(await readFile(snapshotPath, 'utf8'));
    assert.deepEqual(actual, committed, 'Route contract changed: review the diff, then re-record with UPDATE_ROUTE_CONTRACT=1 only if the change is intended.');
});
