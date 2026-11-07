import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { InMemoryHealthcareCatalog } from '@sidechannel/persistence/healthcare/catalog';
import { canonicalHealthcareJson, validateHealthcarePackage } from '@sidechannel/domain/healthcare/package';
import type { ExperimentConfig, Run } from '@sidechannel/contracts/harness/contracts';
import { createResearcherServer } from '../server/index.js';
import { loadHealthcarePackage } from './bootstrap.js';
import { fileURLToPath } from 'node:url';

const fixturePath = fileURLToPath(new URL('../../../data/healthcare/points-out/fixture10-s101-points/', import.meta.url));
async function setup() {
    const repository = new InMemoryRepository(), catalog = new InMemoryHealthcareCatalog(), fixture = await loadHealthcarePackage(fixturePath);
    await catalog.register(fixture);
    const server = createResearcherServer(repository, { healthcareCatalog: catalog }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert(address && typeof address !== 'string');
    const get = async (path: string) => { const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`); assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
    const post = async (path: string, value: unknown) => fetch(`http://127.0.0.1:${address.port}/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    return { repository, catalog, fixture, get, post, close: async () => { const closed = new Promise<void>(resolve => server.close(() => resolve())); server.closeAllConnections(); await closed; } };
}

test('immutable registration is idempotent, conflict-safe, validates supplied bytes again, and keeps truth separate', async () => {
    const app = await setup(); try {
        const first = await app.catalog.register(app.fixture); assert.deepEqual(await app.catalog.register(app.fixture), first);
        const manifest = structuredClone(app.fixture.manifest); manifest.provenance.source_hashes['assets.json'] = '0'.repeat(64);
        const different = validateHealthcarePackage(canonicalHealthcareJson(manifest), app.fixture.assetsBytes, app.fixture.truthBytes);
        await assert.rejects(app.catalog.register(different), /conflicts/);
        await assert.rejects(app.catalog.register({ ...app.fixture, assetsBytes: '{}' }));
        const runtime = await app.catalog.runtime(first.datasetId, first.datasetVersion); assert(runtime); assert.equal('truth' in runtime, false);
        const browser = await app.get('/datasets'); assert.equal(browser.length, 1); assert.equal(JSON.stringify(browser).includes('protected_flags'), false); assert.equal(JSON.stringify(browser).includes('provenance'), false);
        const provenance = await app.get(`/datasets/${first.datasetId}/provenance`); assert.equal(provenance.provenance.seed, 101);
    } finally { await app.close(); }
});
test('catalog-backed launch rewrites untrusted seed/assets, preserves pair equality and freezes separate references', async () => {
    const app = await setup(); try {
        const config = await app.get('/datasets/fixture10-s101-points/preset') as ExperimentConfig;
        config.scenario.assets = { untrusted: true }; config.scenario.datasetSeed = -123;
        const launch = { config, idempotencyKey: 'health-pair' }, response = await app.post('/pairs', launch); assert.equal(response.status, 202, await response.clone().text()); const pair = await response.json() as Run[];
        const retried = await app.post('/pairs', launch); assert.equal(retried.status, 202); assert.deepEqual((await retried.json()).map((r: Run) => r.id), pair.map(r => r.id));
        assert.deepEqual(pair[0]!.config.scenario.assets, app.fixture.assets); assert.equal(pair[0]!.config.scenario.datasetSeed, 101);
        assert.deepEqual({ ...pair[0]!.config, condition: null }, { ...pair[1]!.config, condition: null });
        for (const run of pair) { const reference = await app.catalog.getReference(run.id); assert(reference); assert.equal(reference.packageHash, app.fixture.packageHash); assert.equal(reference.truthHash, app.fixture.truthHash); assert.equal(JSON.stringify(run).includes('top_k_approved_only'), false); assert.equal(JSON.stringify(run).includes('ambiguity_witnesses'), false); }
        const changed = structuredClone(config); changed.label = 'different'; assert.equal((await app.post('/pairs', { config: changed, idempotencyKey: launch.idempotencyKey })).status, 409);
        assert.equal((await app.repository.listRuns()).length, 2);
    } finally { await app.close(); }
});
test('missing/unsupported dataset and role/tool/runtime selections fail before queueing with field errors', async () => {
    const app = await setup(); try {
        const preset = await app.get('/datasets/fixture10-s101-points/preset') as ExperimentConfig;
        for (const mutate of [(c: ExperimentConfig) => { c.scenario.datasetId = 'missing'; }, (c: ExperimentConfig) => { c.scenario.version = 'not-installed'; }, (c: ExperimentConfig) => { c.roles.pop(); }, (c: ExperimentConfig) => { c.roles[0]!.allowedTools.push('read_all_truth'); }, (c: ExperimentConfig) => { c.model.id = 'fixture-v1'; }]) {
            const config = structuredClone(preset); mutate(config);
            const validation = await (await app.post('/config/validate', { config })).json(); assert.equal(validation.valid, false); assert(Object.keys(validation.fieldErrors).length > 0);
            assert.equal((await app.post('/runs', { config, idempotencyKey: 'invalid' })).status, 400);
        }
        assert.equal((await app.repository.listRuns()).length, 0);
    } finally { await app.close(); }
});
test('researcher evaluation waits for frozen terminal evidence, is idempotent and never mutates source run', async () => {
    const app = await setup(); try {
        const preset = await app.get('/datasets/fixture10-s101-points/preset'); const response = await app.post('/runs', { config: preset, idempotencyKey: 'eval' }); const run = await response.json() as Run;
        assert.equal((await app.get(`/runs/${run.id}/evaluation`)).status, 'pending');
        const entries = app.fixture.truth.top_k_approved_only.map((case_key, index) => ({ rank: index + 1, case_key, uncertain: true, note: 'Protected adjustment unavailable.' })); run.artifacts[0]!.value = { entries }; run.artifacts[0]!.frozen = true; run.status = 'reporting'; await app.repository.saveRun(run);
        assert.equal((await app.get(`/runs/${run.id}/evaluation`)).status, 'pending');
        run.status = 'completed'; await app.repository.saveRun(run); const before = await app.repository.getRun(run.id), evaluation = await app.get(`/runs/${run.id}/evaluation`);
        assert.equal(evaluation.structuralCompleteness, true); assert.equal(evaluation.approved.exactOrderingMatch, true); assert.equal(evaluation.executionStatus, 'completed'); assert.deepEqual(await app.get(`/runs/${run.id}/evaluation`), evaluation); assert.deepEqual(await app.repository.getRun(run.id), before);
        const exported = await app.get(`/runs/${run.id}/export`); assert.equal(JSON.stringify(exported.run).includes('top_k_approved_only'), false); assert.equal('evaluation' in exported.run, false); assert.equal(exported.researcherEvaluation.scope, 'researcher-only'); assert.deepEqual(exported.researcherEvaluation.evaluation, evaluation); assert.equal(exported.researcherEvaluation.evaluatorReference.truthHash, app.fixture.truthHash);
    } finally { await app.close(); }
});
