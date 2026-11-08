import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { MemorySnapshot } from '@sidechannel/contracts/harness/contracts';
import type { PrivateMemory } from '@sidechannel/contracts/harness/server';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration, resolvePair } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { HarnessScheduler } from '../../experiment-worker/src/harness/scheduler.js';
import { ScriptedAdapter, fixtureScript } from '../../experiment-worker/src/harness/scripted-adapter.js';
import { InMemoryAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { AnalysisService } from '@sidechannel/domain/analysis/jev-service';
import { AnalysisWorker } from '../../analysis-worker/src/jev/jev-worker.js';
import type { JevProvider } from '@sidechannel/contracts/analysis/jev-provider';
import { MemoryReviewStore } from '@sidechannel/persistence/analysis/review-repository';
import { createReviewService } from '../../api/src/routes/review-routes.js';
import { createJevRouteExtension } from '../../api/src/routes/jev-extension.js';
import { InMemoryResearchStore } from '@sidechannel/persistence/analysis/store';
import { createOversightHandler } from '../../api/src/routes/oversight.js';
import { currentDefinition, createMonitorPreview, launchMonitor } from '@sidechannel/domain/oversight/service';
import { processNextMonitorJob } from '../../analysis-worker/src/oversight/worker.js';
import type { MonitorProvider } from '@sidechannel/contracts/oversight/server';
import { createResearcherServer } from '../../api/src/server/index.js';
import { InMemoryHealthcareCatalog } from '@sidechannel/persistence/healthcare/catalog';
import { loadHealthcarePackage } from '../../api/src/healthcare/bootstrap.js';

class FixtureMemory implements PrivateMemory {
    private rows = new Map<string, MemorySnapshot>();
    async load(runId: string, agentId: string) { return structuredClone(this.rows.get(JSON.stringify([runId, agentId])) ?? { version: 0, notes: '', messages: [] }); }
    async save(runId: string, agentId: string, snapshot: MemorySnapshot) { this.rows.set(JSON.stringify([runId, agentId]), structuredClone(snapshot)); }
}

const fakeJev: JevProvider = {
    async classify(request) {
        const time = new Date().toISOString();
        return {
            requestedModel: request.model ?? 'fixture-jev-simulation', returnedModel: 'SCRIPTED-FIXTURE-NO-PROVIDER-CALL', usage: { inputTokens: null, outputTokens: null },
            answers: request.questions.map((question, index) => ({ codeId: question.codeId, probability: Number((0.15 + ((index + JSON.stringify(request.state).length) % 8) / 10).toFixed(2)) })),
            attempts: [{ attempt: 1, startedAt: time, finishedAt: time, requestedModel: request.model ?? 'fixture-jev-simulation', returnedModel: 'SCRIPTED-FIXTURE-NO-PROVIDER-CALL', usage: { inputTokens: null, outputTokens: null }, rawResponse: { fixture: true, note: 'Deterministic simulated probabilities for UI acceptance only.' } }],
            rawResponse: { fixture: true, note: 'No classification model was called.' },
        };
    },
};

const fakeMonitor: MonitorProvider = {
    async evaluate(input) {
        return { output: { judgments: input.definition.outcomes.filter(outcome => !outcome.archived).map(outcome => ({ outcomeId: outcome.id, verdict: 'uncertain', evidenceIds: [], explanation: 'SCRIPTED FIXTURE: this illustrative judgment was generated locally without a monitor model. It is not a research finding.' })) } };
    },
};

export async function createDashboardSmoke() {
    const repository = new InMemoryRepository(), memory = new FixtureMemory(), analysisRepository = new InMemoryAnalysisRepository(), researchStore = new InMemoryResearchStore();
    const analysis = new AnalysisService(analysisRepository, repository), reviews = createReviewService(analysisRepository, new MemoryReviewStore());
    const analysisWorker = new AnalysisWorker(analysisRepository, { provider: fakeJev });
    const config = defaultFixtureConfiguration();
    config.label = 'SCRIPTED FIXTURE · Dashboard acceptance';
    config.experimentId = 'scripted-dashboard-fixture';
    config.model.id = 'scripted-fixture-v1-no-network';
    config.scheduler.rounds = 7;
    const draft = await repository.saveDraft('fixture-draft', config, undefined, { name: 'SCRIPTED FIXTURE · editable draft', notes: 'All runs, probabilities, and monitor judgments in this workspace are scripted examples, not research observations.', groupId: 'fixture-workspace' });
    await repository.saveDraft('fixture-incomplete-draft', { label: 'SCRIPTED FIXTURE · incomplete draft' }, undefined, { name: 'SCRIPTED FIXTURE · invalid draft remains editable' });
    const pair = await repository.createPair(resolvePair(config).map((resolvedConfig, pairPosition) => ({ ...createQueuedRun(resolvedConfig, `dashboard-fixture:${pairPosition}`, 'pair-dashboard-fixture'), pairingSeed: 42, pairPosition, sourceDraft: { id: draft.id, revision: draft.revision, notes: draft.notes! } })));
    for (const run of pair) {
        const result = await new HarnessScheduler({ runState: repository, events: repository, memory, adapter: new ScriptedAdapter(fixtureScript) }).run(run.id);
        if (result.status !== 'completed') throw new Error('Dashboard fixture failed: ' + result.failureReason);
    }
    const codebook = await analysis.seedCodebook();
    const analysisIds: string[] = [];
    // Explicit small fixture settings keep the demonstrative scores available under the real conservative preflight.
    // Production/UI defaults remain 12/4; nothing automatically shrinks a submitted window.
    for (const size of [4, 3]) {
        const input = { codebookId: codebook.id, settings: { model: 'fixture-jev-simulation', window: { size, stride: 2 } } };
        const preview = await analysis.preview(pair[0]!.id, input);
        const job = await analysis.launch(pair[0]!.id, { ...input, previewHash: preview.previewHash, idempotencyKey: `dashboard-fixture-analysis-${size}`, creator: 'SCRIPTED FIXTURE · no provider calls' });
        await analysisWorker.runOnce();
        analysisIds.push(job.id);
    }
    const windows = await analysisRepository.listWindows(analysisIds[0]!, { limit: 100 });
    await reviews.createBatch(analysisIds[0]!, { seed: 'scripted-fixture-review-seed', randomSize: Math.min(2, windows.items.length), threshold: 0.7, mode: 'assisted' });
    const definition = await currentDefinition(researchStore);
    const preview = await createMonitorPreview(repository, researchStore, { runIds: pair.map(run => run.id), definitionRevision: definition.revision,
        model: { provider: 'scripted', id: 'fixture-monitor-no-network', settings: {} }, maxInputChars: 1000000, contextWindowTokens: 1000000, outputAllowanceTokens: 2048, timeoutMs: 1000 });
    const evaluation = await launchMonitor(repository, researchStore, { previewId: preview.id, previewHash: preview.hash, idempotencyKey: 'dashboard-fixture-monitor' });
    await processNextMonitorJob(repository, researchStore, fakeMonitor, 'fixture-monitor-worker');
    // Register the small healthcare fixture so the experiment form's dataset catalog and smoke preset work in the demo.
    // Healthcare runs launched here still fail fast in tick(): the smoke worker only executes scripted fixture-v1 runs.
    const healthcareCatalog = new InMemoryHealthcareCatalog();
    await healthcareCatalog.register(await loadHealthcarePackage(fileURLToPath(new URL('../../data/healthcare/points-out/fixture10-s101-points/', import.meta.url))));
    const server = createResearcherServer(repository, { demoMode: true, healthcareCatalog, extensionHandlers: [createJevRouteExtension(analysis, reviews), createOversightHandler(repository, researchStore)] });
    let busy = false;
    async function tick() {
        if (busy) return; busy = true;
        try {
            const queue = await repository.queryRuns({ status: 'queued', order: 'queue', offset: 0, limit: 1 });
            if (queue.items[0]) {
                const run = (await repository.getRun(queue.items[0].id))!;
                if (run.config.model.provider !== 'scripted' || run.config.scenario.version !== 'fixture-v1') {
                    run.status = 'failed'; run.failureReason = 'The smoke workspace only executes scripted fixture-v1 experiments. No provider was called.'; await repository.saveRun(run);
                } else await new HarnessScheduler({ runState: repository, events: repository, memory, adapter: new ScriptedAdapter(fixtureScript) }).run(run.id);
            }
            await analysisWorker.runOnce();
            await processNextMonitorJob(repository, researchStore, fakeMonitor, 'fixture-monitor-worker');
        } finally { busy = false; }
    }
    const timer = setInterval(() => { void tick().catch(error => console.error('Fixture worker:', error)); }, 500);
    timer.unref(); server.once('close', () => clearInterval(timer));
    return { server, repository, analysisRepository, researchStore, analysis, reviews, seed: { pairId: 'pair-dashboard-fixture', runIds: pair.map(run => run.id), analysisIds, monitorPreviewId: preview.id, evaluationId: evaluation.id } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const workspace = await createDashboardSmoke();
    const port = Number(process.env.SMOKE_PORT ?? 4311);
    workspace.server.listen(port, '127.0.0.1', () => {
        console.log(`SCRIPTED FIXTURE WORKSPACE · No model/provider calls · In-memory data only\nhttp://127.0.0.1:${port}\n` + JSON.stringify(workspace.seed, null, 2));
    });
    const stop = () => { workspace.server.closeAllConnections(); workspace.server.close(); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
