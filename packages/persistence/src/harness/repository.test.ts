import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryRepository } from './repository.js';
import { defaultFixtureConfiguration, resolveConfiguration, resolvePair } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';

test('duplicate launch, exclusive claim, immutable snapshot and concurrent cancel', async () => {
    const repo = new InMemoryRepository();
    const run = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'launch');
    await repo.createRun(run);
    assert.equal((await repo.createRun(createQueuedRun(run.config, 'launch'))).id, run.id);
    assert.deepEqual(await Promise.all([repo.claimRun(run.id, 'one'), repo.claimRun(run.id, 'two')]), [true, false]);
    const stale = (await repo.getRun(run.id))!;
    await repo.requestCancel(run.id);
    stale.config.label = 'illegal change';
    stale.status = 'completed';
    await repo.saveRun(stale);
    const saved = (await repo.getRun(run.id))!;
    assert.equal(saved.config.label, 'Development fixture');
    assert.equal(saved.cancelRequested, true);
    assert.equal(saved.status, 'stopping');
});

test('matched pair validation and identity checks are atomic', async () => {
    const repo = new InMemoryRepository();
    const pair = resolvePair(defaultFixtureConfiguration()).map((config, position) => ({ ...createQueuedRun(config, `pair:${position}`, 'pair'), pairingSeed: 42, pairPosition: position }));
    const invalid = structuredClone(pair);
    invalid[1]!.config.scheduler.rounds += 1;
    await assert.rejects(repo.createPair(invalid), /differ outside condition/);
    assert.equal((await repo.listRuns()).length, 0);
    await repo.createRun(pair[0]!);
    await assert.rejects(repo.createPair(pair), /Incomplete pair/);
    assert.equal((await repo.listRuns()).length, 1);
    const other = new InMemoryRepository();
    const created = await other.createPair(pair);
    const retry = pair.map(run => ({ ...run, id: 'retry-' + run.id }));
    assert.deepEqual((await other.createPair(retry)).map(run => run.id), created.map(run => run.id));
    const changedSeed = retry.map(run => ({ ...run, pairingSeed: 3 }));
    await assert.rejects(other.createPair(changedSeed), /Idempotency/);
    const stale = (await other.getRun(created[0]!.id))!;
    stale.pairId = 'mutated'; stale.pairingSeed = 3;
    await other.saveRun(stale);
    assert.equal((await other.getRun(stale.id))!.pairId, 'pair');
    assert.equal((await other.getRun(stale.id))!.pairingSeed, 42);
});
