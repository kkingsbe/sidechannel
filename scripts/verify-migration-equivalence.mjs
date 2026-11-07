import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const load = path => import(new URL(`packages/domain/dist/${path}.js`, root));
const config = await load('harness/config');
const initialization = await load('harness/initialization');
const configuration = await load('analysis/configuration');
const normalization = await load('analysis/normalization');
const windows = await load('analysis/windows');
const serialization = await load('analysis/serialization');
const provider = await load('analysis/jev-questions');
const testing = await import('../packages/contracts/dist/testing.js');
assert.deepEqual(testing.defaultFixtureConfiguration(), config.defaultFixtureConfiguration());
const fixture = JSON.parse(await readFile(new URL('agent/examples/completed-fixture.json', root), 'utf8'));
const resolved = config.resolveConfiguration(config.defaultFixtureConfiguration());
const queued = initialization.createQueuedRun(resolved, 'migration-equivalence', 'matched-pair');
delete queued.id; delete queued.createdAt; delete queued.updatedAt;
const trace = normalization.normalizeTrace(fixture.run, fixture.events);
const settings = configuration.resolveAnalysisConfiguration();
const selected = windows.selectSteps(trace.steps, settings.selection);
const context = configuration.staticContextForRun(fixture.run);
const definitions = configuration.createSeedCodebook('migration-test', '2026-11-07T00:00:00.000Z').revision.definitions;
const questions = provider.buildBehaviorQuestions(definitions);
const serialized = windows.buildWindows(selected, settings.window).map(window => serialization.serializeWindow(window, selected, settings.evidence, context.text));
const result = Object.fromEntries(Object.entries({ resolved, pair: config.resolvePair(resolved), queued, trace, context, definitions, questions, serialized,
    requests: serialized.map(value => provider.buildSystemOnePayload({ state: value.state, questions }))
}).map(([key, value]) => [key, configuration.snapshotHash(value)]));
const baseline = new URL('tests/fixtures/service-layout-baseline.json', root);
// These hashes were captured from the original modules before their extraction.
assert.deepEqual(result, JSON.parse(await readFile(baseline, 'utf8')));
console.log('Migration equivalence passed: configuration, pair, initial state, normalized trace, windows, definitions, and exact Jev payloads.');

