import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { MongoRepository } from '@sidechannel/persistence/harness/repository';
import { HarnessScheduler } from '../../experiment-worker/src/harness/scheduler.js';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { ScriptedAdapter, fixtureScript } from '../../experiment-worker/src/harness/scripted-adapter.js';
import type { MemorySnapshot } from '@sidechannel/contracts/harness/contracts';
import { MongoAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { AnalysisService } from '@sidechannel/domain/analysis/jev-service';
import { AnalysisWorker } from '../../analysis-worker/src/jev/jev-worker.js';
import { createSeedCodebook } from '@sidechannel/domain/analysis/configuration';

if (!process.env.TYPESAFE_API_KEY && !process.env.TYPESAFE_AI_API_KEY) throw new Error('Configure TYPESAFE_API_KEY or TYPESAFE_AI_API_KEY for the live smoke.');

const name = 'sidechannel_jev_smoke_' + randomUUID().replaceAll('-', '');

const source = await MongoRepository.connect(process.env.TEST_MONGODB_URI ?? process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0', name);

try {
    const snapshots = new Map<string, MemorySnapshot>();
    const run = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'jev-smoke'); await source.createRun(run);
    const finished = await new HarnessScheduler({ runState: source, events: source, adapter: new ScriptedAdapter(fixtureScript), memory: {
        async load(runId, actor) { return structuredClone(snapshots.get(runId + ':' + actor) ?? { version: 0, notes: '', messages: [] }); },
        async save(runId, actor, snapshot) { snapshots.set(runId + ':' + actor, structuredClone(snapshot)); },
    } }).run(run.id);
    if (finished.status !== 'completed') throw new Error('Scripted source fixture did not complete');
    const repository = new MongoAnalysisRepository(source.client, source.db); await repository.initialize();
    const service = new AnalysisService(repository, source);
    const definitions = createSeedCodebook().revision.definitions.filter(code => code.id === 'comply');
    const { codebook } = await service.createCodebook({ name: 'Live smoke: COMPLY only', creator: 'live-smoke', definitions });
    const input = { codebookId: codebook.id, settings: { window: { size: 1, stride: 1 }, selection: { phases: ['action' as const], startOrdinal: 1, endOrdinal: 1 }, concurrency: 1, maxAttempts: 1, timeoutMs: 60000 } };
    const preview = await service.preview(run.id, input);
    if (preview.windowCount !== 1 || preview.scoredCodeCount !== 1) throw new Error('Smoke must send exactly one window and one code');
    const job = await service.launch(run.id, { ...input, previewHash: preview.previewHash, idempotencyKey: 'smoke', creator: 'live-smoke' });
    await new AnalysisWorker(repository).runOnce();
    const final = await service.getJob(job.id), results = await repository.listResults(job.id), attempts = await repository.listAttempts(job.id);
    const exportRows = []; for await (const row of service.exportAnalysis(job.id)) exportRows.push(row);
    const output = new URL(`../../data/exports/jev-live-${new Date().toISOString().replaceAll(':', '-')}.json`, import.meta.url);
    await mkdir(new URL('../../data/exports/', import.meta.url), { recursive: true });
    await writeFile(output, JSON.stringify({ schemaVersion: 1, source: 'scripted development fixture, not a research finding', job: final, results: results.items, attempts: attempts.items, export: exportRows }, null, 2));
    console.log(JSON.stringify({ status: final.status, sourceRunId: run.id, analysisId: job.id, answers: results.items.length, returnedModel: attempts.items[0]?.returnedModel, usage: final.usage, output: output.pathname }));
    if (final.status !== 'completed' || results.items.length !== 1) throw new Error(`Live Jev smoke did not complete: ${final.error ?? attempts.items[0]?.error ?? final.status}`);
} finally { await source.db.dropDatabase(); await source.close(); }