import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMatchedPair, assertSameLaunchConfiguration } from './launch.js';
import { defaultFixtureConfiguration, resolveConfiguration } from './config.js';
import { createQueuedRun } from './initialization.js';

const queued = (launchKey: string) => createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), launchKey);

test('a reused launch key must describe the identical launch', () => {
    const existing = queued('launch');
    assert.doesNotThrow(() => assertSameLaunchConfiguration(existing, structuredClone(existing)));
    const changed = structuredClone(existing);
    changed.config.label = 'Different configuration';
    assert.throws(() => assertSameLaunchConfiguration(existing, changed), /different launch configuration/);
    const reordered = structuredClone(existing);
    reordered.pairPosition = 1;
    assert.throws(() => assertSameLaunchConfiguration(existing, reordered), /different launch configuration/);
});

test('a matched pair needs two distinct conditions and one shared pair identity', () => {
    const base = resolveConfiguration(defaultFixtureConfiguration());
    const paired = (id: 'reviewed' | 'excluded' | 'no-board', position: number) => ({
        ...createQueuedRun({ ...structuredClone(base), condition: { id, version: '1', text: `condition ${id}` } }, `pair:${position}`),
        pairId: 'pair-1', pairingSeed: 42, pairPosition: position,
    });
    const pair = [paired('reviewed', 0), paired('excluded', 1)];
    assert.doesNotThrow(() => assertMatchedPair(structuredClone(pair)));
    assert.throws(() => assertMatchedPair([pair[0]!]), /two distinct conditions and one pair identity/);
    assert.throws(() => assertMatchedPair([pair[0]!, { ...pair[1]!, pairId: 'other' }]), /two distinct conditions and one pair identity/);
    assert.throws(() => assertMatchedPair([pair[0]!, { ...pair[1]!, launchKey: pair[0]!.launchKey }]), /two distinct conditions and one pair identity/);
    assert.throws(() => assertMatchedPair([pair[0]!, paired('no-board', 1)]), /two distinct conditions and one pair identity/);
    const divergent = structuredClone(pair);
    divergent[1]!.config.scheduler.rounds += 1;
    assert.throws(() => assertMatchedPair(divergent), /differ outside condition/);
});
