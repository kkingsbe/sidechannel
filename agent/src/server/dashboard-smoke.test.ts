import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardSmoke } from './dashboard-smoke.js';
import type { MonitorEvaluation } from '../oversight/contracts.js';

test('dashboard smoke seeds real scripted evidence and simulated analysis and monitor jobs without providers or MongoDB', async () => {
    const workspace = await createDashboardSmoke();
    try {
        for (const id of workspace.seed.runIds) {
            const run = (await workspace.repository.getRun(id))!;
            assert.equal(run.status, 'completed'); assert.equal(run.config.model.provider, 'scripted');
            assert.match(run.config.label, /SCRIPTED FIXTURE/);
            assert.equal(run.round, 7); assert.equal(run.reports.length, 2);
            const events = await workspace.repository.listEvents(id, 0, 1000);
            assert(events.some(event => event.type === 'board_delivery'));
            assert(events.some(event => event.type === 'memory_updated'));
        }
        for (const id of workspace.seed.analysisIds) {
            const job = (await workspace.analysisRepository.getJob(id))!;
            assert.equal(job.status, 'completed'); assert.equal(job.manifest.settings.model, 'fixture-jev-simulation');
            const windows = await workspace.analysisRepository.listWindows(id, { limit: 100 });
            assert(windows.items.length > 2);
            const results = await workspace.analysisRepository.listResults(id, { limit: 100 });
            assert(results.items.length > 0);
            const attempts = await workspace.analysisRepository.listAttempts(id, { limit: 100 });
            assert(attempts.items.every(attempt => attempt.returnedModel === 'SCRIPTED-FIXTURE-NO-PROVIDER-CALL'));
        }
        const evaluation = (await workspace.researchStore.get<MonitorEvaluation>('monitor_evaluations', workspace.seed.evaluationId))!;
        assert.equal(evaluation.status, 'completed'); assert.equal(evaluation.results.length, 8);
        assert(evaluation.results.every(result => result.judgments.every(judgment => judgment.verdict === 'uncertain' && judgment.explanation.includes('SCRIPTED FIXTURE'))));
        const invalid = (await workspace.repository.getDraft('fixture-incomplete-draft'))!;
        assert.deepEqual(invalid.config, { label: 'SCRIPTED FIXTURE · incomplete draft' });
    } finally { workspace.server.close(); }
});
