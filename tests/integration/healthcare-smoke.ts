import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import type { ExperimentConfig, Run } from '@sidechannel/contracts/harness/contracts';
import type { HealthcareEvaluation } from '@sidechannel/contracts/healthcare/contracts';
import { MongoRepository } from '@sidechannel/persistence/harness/repository';
import { MongoHealthcareCatalog } from '@sidechannel/persistence/healthcare/catalog';
import { canonicalHealthcareJson, validateHealthcarePackage } from '@sidechannel/domain/healthcare/package';
import { createResearcherServer } from '../../api/src/server/index.js';
import { loadHealthcarePackage } from '../../api/src/healthcare/bootstrap.js';

/** HTTP launch -> actual production worker queue loop -> Mongo reload and researcher results. */
export async function runHealthcareSmoke(keep = false) {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const database = 'sc_healthcare_smoke_' + randomUUID().replaceAll('-', '');
    const uri = process.env.TEST_MONGODB_URI ?? process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0';
    const repository = await MongoRepository.connect(uri, database);
    const catalog = new MongoHealthcareCatalog(repository.client, repository.db);
    await catalog.initialize();
    const server = createResearcherServer(repository, { healthcareCatalog: catalog });
    let worker: ChildProcess | undefined, workerOutput = '';
    try {
        const fixture = await loadHealthcarePackage(resolve(root, 'data/healthcare/points-out/fixture10-s101-points'));
        const first = await catalog.register(fixture);
        assert.deepEqual(await catalog.register(fixture), first);
        const changedManifest = canonicalHealthcareJson({ ...fixture.manifest, provenance: { ...fixture.manifest.provenance, source_hashes: { ...fixture.manifest.provenance.source_hashes, 'assets.json': '0'.repeat(64) } } });
        const conflicting = validateHealthcarePackage(changedManifest, fixture.assetsBytes, fixture.truthBytes);
        await assert.rejects(catalog.register(conflicting), /conflict/i);
        assert.equal((await catalog.runtime(first.datasetId, first.datasetVersion))?.item.packageHash, fixture.packageHash);
        const key = `${first.datasetId}:${first.datasetVersion}`;
        await repository.db.collection('healthcare_datasets').updateOne({ key }, { $set: { assetsBytes: fixture.assetsBytes + ' ' } });
        assert.equal(await catalog.runtime(first.datasetId, first.datasetVersion), null);
        await repository.db.collection('healthcare_datasets').updateOne({ key }, { $set: { assetsBytes: fixture.assetsBytes } });
        // A partial installation must not be selectable or launchable.
        await repository.db.collection('healthcare_datasets').insertOne({ key: 'partial:0.3', item: { ...first, datasetId: 'partial' }, truthHash: fixture.truthHash });
        assert.equal(await catalog.runtime('partial', '0.3'), null);
        await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
        const address = server.address(); assert(address && typeof address !== 'string');
        const base = `http://127.0.0.1:${address.port}/api`;
        const get = async <T>(path: string): Promise<T> => { const response = await fetch(base + path); assert.equal(response.status, 200, await response.clone().text()); return response.json() as Promise<T>; };
        const post = async (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        assert.equal((await get<unknown[]>('/datasets')).length, 1);
        const preset = await get<ExperimentConfig>('/datasets/fixture10-s101-points/preset');
        assert.equal(preset.tokenBudget?.maxInputTokens, 120000);
        const validation = await post('/config/validate', { config: preset });
        const validated = await validation.json() as { valid: boolean; errors: string[] }; assert.equal(validated.valid, true, JSON.stringify(validated));
        const invalid = await post('/pairs', { config: { ...preset, scenario: { ...preset.scenario, datasetId: 'partial' } }, idempotencyKey: 'partial' });
        assert.equal(invalid.status, 400);
        const request = { config: { ...preset, scenario: { ...preset.scenario, assets: { attackerReplacement: true }, datasetSeed: -999 } }, idempotencyKey: 'scripted-healthcare-smoke', pairingSeed: 42 };
        const launch = await post('/pairs', request); assert.equal(launch.status, 202, await launch.clone().text());
        const pair = await launch.json() as Run[]; assert.equal(pair.length, 2);
        const duplicate = await post('/pairs', request); assert.equal(duplicate.status, 202);
        assert.deepEqual((await duplicate.json() as Run[]).map(run => run.id), pair.map(run => run.id));
        assert.equal((await repository.listRuns()).length, 2);
        for (const run of pair) {
            assert.deepEqual(run.config.scenario.assets, fixture.assets);
            assert.equal(run.config.scenario.datasetSeed, fixture.manifest.provenance.seed);
            const ref = await catalog.getReference(run.id); assert(ref); assert.equal(ref.truthHash, fixture.truthHash);
        }
        const stripCondition = (config: ExperimentConfig) => ({ ...config, condition: undefined });
        assert.deepEqual(stripCondition(pair[0]!.config), stripCondition(pair[1]!.config));
        worker = spawn(process.execPath, ['--import', 'tsx', resolve(root, 'experiment-worker/src/main.ts')], {
            cwd: root, env: { ...process.env, MONGODB_URI: uri, MONGODB_DB_NAME: database, MASTRA_DB_NAME: database + '_memory' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        });
        worker.stdout?.on('data', chunk => { workerOutput = (workerOutput + String(chunk)).slice(-12000); });
        worker.stderr?.on('data', chunk => { workerOutput = (workerOutput + String(chunk)).slice(-12000); });
        const deadline = Date.now() + 180000;
        while (Date.now() < deadline) {
            const active = await repository.queryRuns({ status: 'queued,running,reporting,stopping', offset: 0, limit: 2 });
            if (active.total === 0) break;
            if (worker.exitCode !== null) throw new Error(`Worker exited ${worker.exitCode}: ${workerOutput}`);
            await setTimeout(500);
        }
        const finished = await repository.listRuns();
        const evaluations: HealthcareEvaluation[] = [];
        for (const run of finished) {
            assert.equal(run.status, 'completed', `${run.failureReason ?? run.status}\n${workerOutput}`);
            assert.equal(run.reports.length, 5); assert(run.reports.every(report => report.parsed !== null));
            assert.equal(run.turn, 15); assert.equal(run.artifacts.at(-1)?.frozen, true);
            const evaluation = await get<HealthcareEvaluation>(`/runs/${run.id}/evaluation`);
            assert.equal(evaluation.structuralCompleteness, true);
            assert.equal(evaluation.approved.membershipOverlap, 3);
            assert.equal(evaluation.approved.exactOrderingMatch, true);
            assert.deepEqual(await get(`/runs/${run.id}/evaluation`), evaluation);
            evaluations.push(evaluation);
            const events = await repository.listEvents(run.id);
            assert(events.some(event => event.type === 'board_delivery' && event.agentId === 'outside_analytics'));
            assert(events.some(event => event.type === 'context_accounted'));
            assert(events.filter(event => event.type === 'memory_updated').length > 0);
            assert.equal(events.filter(event => event.type === 'report_submitted').length, 5);
            const artifactFreeze = events.find(event => event.type === 'artifact_frozen')!;
            assert(artifactFreeze.sequence < events.find(event => event.type === 'report_submitted')!.sequence);
            const exported = await get<{ run: Run; events: unknown[]; researcherEvaluation: { evaluatorReference: { truthHash: string }; evaluation: HealthcareEvaluation } }>(`/runs/${run.id}/export`);
            assert.equal(exported.run.reports.length, 5); assert.equal(exported.events.length, events.length);
            assert.equal(exported.researcherEvaluation.evaluatorReference.truthHash, fixture.truthHash);
            assert.deepEqual(exported.researcherEvaluation.evaluation, evaluation);
            assert(!JSON.stringify(exported.run).includes('top_k_approved_only'));
            assert(!JSON.stringify(exported.run).includes('ambiguity_witnesses'));
            const board = await get<{ items: unknown[]; total: number }>(`/runs/${run.id}/board?offset=0&limit=2`);
            assert.equal(board.items.length, 2); assert.equal(board.total, 4);
            const reloaded = await MongoRepository.connect(uri, database);
            try {
                assert.deepEqual((await reloaded.getRun(run.id))?.reports, run.reports);
                const reloadedCatalog = new MongoHealthcareCatalog(reloaded.client, reloaded.db);
                assert.deepEqual(await reloadedCatalog.getEvaluation(run.id, evaluation.artifactVersion, evaluation.evaluatorVersion), evaluation);
                assert.equal((await reloadedCatalog.getReference(run.id))?.packageHash, fixture.packageHash);
            } finally { await reloaded.close(); }
        }
        const otherIds = new Set(finished[1]!.board.map(post => post.id));
        assert(finished[0]!.board.every(post => post.runId === finished[0]!.id && !otherIds.has(post.id)));
        return { designation: 'SCRIPTED INSTRUMENTATION CHECK — no live inference', database, retained: keep, datasetId: first.datasetId, packageHash: fixture.packageHash, profile: { version: preset.configVersion, rounds: preset.scheduler.rounds, callsPerTurn: preset.scheduler.toolCallsPerTurn, modelStepsPerTurn: preset.limits.maxModelStepsPerTurn }, runIds: pair.map(run => run.id), pairId: pair[0]!.pairId, evaluations };
    } finally {
        if (worker && worker.exitCode === null) { const exited = once(worker, 'exit'); worker.kill(); await exited; }
        server.closeAllConnections(); await new Promise<void>(resolveClose => server.close(() => resolveClose()));
        if (!keep) { await repository.client.db(database + '_memory').dropDatabase(); await repository.db.dropDatabase(); }
        await repository.close();
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runHealthcareSmoke(process.argv.includes('--keep')).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
}
