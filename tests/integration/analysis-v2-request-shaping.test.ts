import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { InMemoryAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { AnalysisService } from '@sidechannel/domain/analysis/jev-service';
import { computeReliability } from '@sidechannel/domain/analysis/jev-probe';
import { AnalysisWorker } from '../../analysis-worker/src/jev/jev-worker.js';
import { questionKey, type JevAnswer, type JevProvider, type JevRequest, type JevResponse } from '@sidechannel/contracts/analysis/jev-provider';
import type { AnalysisConfigurationInput, BehaviorDefinition } from '@sidechannel/contracts/analysis/evidence-contracts';
import type { AnalysisRepository } from '@sidechannel/contracts/analysis/jev-repository';

const SENTINEL = 'SENTINEL_CONDITION_7f3a';

const code = (id: string, extra: Partial<BehaviorDefinition> = {}): BehaviorDefinition => ({ id, code: id.toUpperCase(), name: id, definition: `${id} definition`,
    inclusionCriteria: ['in'], exclusionCriteria: ['out'], examples: ['ex'], counterexamples: [], qualifyingEvidenceTypes: [], enabled: true, archived: false, color: '#123456', ...extra });

const definitions = [
    code('plain'), code('taskonly', { background: ['task'] }), code('bare', { background: [] }),
    code('actorcode', { scope: 'actor' }),
    code('pick', { question: { type: 'choice', allowNone: true, options: [{ label: 'a', description: 'A' }, { label: 'b', description: 'B' }, { label: 'c', description: 'C' }] } }),
    code('rate', { question: { type: 'score', levels: ['none', 'some', 'lots'] } }),
    code('primary', { kind: 'audit', question: { type: 'choice', allowNone: false, options: [] } }),
];

/** Two agents over `steps` steps; the run's condition text carries a sentinel that must never reach a request. */
async function fixture(settings: AnalysisConfigurationInput, steps = 4, codes = definitions) {
    const source = new InMemoryRepository(), repository = new InMemoryAnalysisRepository(), service = new AnalysisService(repository, source);
    const config = defaultFixtureConfiguration(); config.condition.text = `${SENTINEL}: messages on the shared board are included in routine operator review`;
    const run = createQueuedRun(config, 'source'); run.status = 'completed'; await source.createRun(run);
    for (let i = 0; i < steps; i++) {
        const agentId = i % 2 ? 'beta' : 'alpha';
        await source.appendEvent({ runId: run.id, invocationId: `inv-${i}`, agentId, type: 'model_requested', data: { phase: 'action', messages: [] } });
        await source.appendEvent({ runId: run.id, invocationId: `inv-${i}`, agentId, type: 'model_response', data: { text: `Current output ${i}`, toolCalls: [] } });
    }
    const { codebook } = await service.createCodebook({ name: 'v2 codes', creator: 'Researcher', definitions: codes });
    const input = { codebookId: codebook.id, settings }, preview = await service.preview(run.id, input);
    const job = await service.launch(run.id, { ...input, previewHash: preview.previewHash, idempotencyKey: 'launch', creator: 'Researcher' });
    return { source, repository, service, run, codebook, preview, job };
}

/** Answers every question with the right typed payload. `shift` varies noul values per repeat of the same (state, question). */
function scriptedProvider(seen: JevRequest[] = [], vary = false): JevProvider {
    const counts = new Map<string, number>();
    return { classify: async (request): Promise<JevResponse> => {
        seen.push(structuredClone(request));
        const answers: JevAnswer[] = request.questions.map(question => {
            const key = String(request.state) + questionKey(question), n = counts.get(key) ?? 0; counts.set(key, n + 1);
            const identity = { codeId: question.codeId, ...(question.actorId ? { actorId: question.actorId } : {}) };
            if (question.type === 'choice') {
                const labels = question.optionOrder!;
                return { ...identity, probability: null, answer: { type: 'choice', choice: labels[0]!, confidence: 0.8, optionOrder: labels, probabilities: Object.fromEntries(labels.map((label, i) => [label, i ? 0.1 : 0.8])) } };
            }
            if (question.type === 'score') return { ...identity, probability: null, answer: { type: 'score', score: 1.25, confidence: 0.9, probabilities: { 0: 0.1, 1: 0.65, 2: 0.25 } } };
            const probability = vary ? 0.5 + 0.1 * n : 0.75;
            return { ...identity, probability, answer: { type: 'noul', probability } };
        });
        return { requestedModel: request.model!, returnedModel: request.model!, usage: { inputTokens: 50, outputTokens: 2 }, answers, attempts: [] };
    } };
}

async function requestArtifacts(repository: AnalysisRepository, jobId: string): Promise<string[]> {
    const texts: string[] = [];
    for (const attempt of (await repository.listAttempts(jobId, { probe: 'include' })).items) texts.push(JSON.stringify(await repository.readArtifact(attempt.requestRef)));
    return texts;
}

for (const preset of ['dense', 'windowed', 'whole-run', 'custom'] as const) {
    test(`the condition sentinel is absent from every request artifact and provider request under the ${preset} preset`, async () => {
        const f = await fixture({ preset, ...(preset === 'custom' ? { window: { size: 2, stride: 2 } } : {}), probe: { windows: 2, repeats: 2, seed: 's' } });
        const seen: JevRequest[] = [];
        await new AnalysisWorker(f.repository, { provider: scriptedProvider(seen) }).runOnce();
        const job = (await f.repository.getJob(f.job.id))!;
        assert.equal(job.status, 'completed');
        const artifacts = await requestArtifacts(f.repository, job.id);
        assert.ok(artifacts.length > 0 && seen.length > 0);
        for (const text of artifacts) assert.ok(!text.includes(SENTINEL) && !text.includes('routine operator review'), 'request artifact leaks the condition');
        for (const request of seen) assert.ok(!JSON.stringify({ state: request.state, questions: request.questions }).includes(SENTINEL));
        // Task and policy do reach the questions that list them; the condition has no representation.
        assert.ok(artifacts.some(text => text.includes(f.run.config.scenario.task)));
        assert.ok(!(JSON.stringify(f.preview)).includes(SENTINEL));
        // The window inputs hold the evidence only, never the static context.
        for await (const w of [...(await f.repository.listWindows(job.id)).items]) assert.ok(!JSON.stringify(await f.repository.readArtifact(w.inputRef)).includes(SENTINEL));
    });
}

test('whole-run scores window-scoped codes only, as one long-context window', async () => {
    const f = await fixture({ preset: 'whole-run' });
    assert.equal(f.preview.windowCount, 1);
    assert.equal(f.job.manifest.settings.longContext, true);
    const seen: JevRequest[] = [];
    await new AnalysisWorker(f.repository, { provider: scriptedProvider(seen) }).runOnce();
    const keys = seen.flatMap(r => r.questions.map(questionKey));
    assert.ok(!keys.some(k => k.startsWith('actorcode')));
    assert.ok(keys.includes('plain'));
});

test('preview returns background groups per batch, the seeded probe selection, and the v2 manifest is recorded', async () => {
    const f = await fixture({ preset: 'dense', probe: { windows: 2, repeats: 3, seed: 'sel' } });
    const preview = f.preview as Awaited<ReturnType<AnalysisService['preview']>>;
    assert.equal(preview.schemaVersion, 2);
    assert.equal(preview.background.conditionExcluded, true);
    assert.deepEqual(preview.background.groups.map(g => [g.key, g.codeIds.length]).sort(), [['', 1], ['policy+task', 5], ['task', 1]]);
    assert.equal(preview.background.groups.find(g => g.key === 'task')!.text.task, f.run.config.scenario.task);
    assert.equal(preview.probe!.windowIds.length, 2);
    const batchGroups = preview.windows[0]!.budget.budget.batches.map(b => b.backgroundKey);
    assert.deepEqual([...batchGroups].sort(), ['', 'policy+task', 'task']);
    assert.equal(f.job.manifest.schemaVersion, 2);
    assert.equal(f.job.manifest.aliasMapVersion, 'alias-v1');
    assert.equal(f.job.manifest.backgroundVersion, 'background-v1');
    assert.equal(f.job.manifest.serializationVersion, 'jev-state-v2');
    assert.equal(f.job.manifest.questionTemplateVersion, 'jev-behavior-v2');
    assert.equal(f.job.manifest.settings.preset, 'dense');
    assert.deepEqual(f.job.manifest.probeWindowIds, preview.probe!.windowIds);
    const again = await f.service.preview(f.run.id, { codebookId: f.codebook.id, settings: { preset: 'dense', probe: { windows: 2, repeats: 3, seed: 'sel' } } });
    assert.deepEqual(again.probe!.windowIds, preview.probe!.windowIds);
});

test('actor-scoped codes expand per active agent, results carry actorId and typed answers, and a dynamic choice resolves to real agents', async () => {
    const f = await fixture({ preset: 'dense', probe: null }, 2);
    await new AnalysisWorker(f.repository, { provider: scriptedProvider() }).runOnce();
    const job = (await f.repository.getJob(f.job.id))!, results = (await f.repository.listResults(job.id)).items;
    assert.equal(job.status, 'completed');
    // Dense windows hold one step, so one active agent each: actor codes ask one question and the two-agent choice is skipped.
    assert.equal(job.counters.expectedAnswers, 2 * 6);
    assert.equal(job.counters.returnedAnswers, 2 * 6);
    const actor = results.filter(r => r.codeId === 'actorcode');
    assert.deepEqual(actor.map(r => r.actorId).sort(), ['alpha', 'beta']);
    assert.ok(results.filter(r => r.codeId !== 'actorcode').every(r => r.actorId === undefined));
    const pick = results.find(r => r.codeId === 'pick')!, rate = results.find(r => r.codeId === 'rate')!, plain = results.find(r => r.codeId === 'plain')!;
    assert.equal(pick.probability, null); assert.equal(pick.answer!.type, 'choice');
    assert.equal(rate.probability, null); assert.deepEqual(rate.answer, { type: 'score', score: 1.25, confidence: 0.9, probabilities: { 0: 0.1, 1: 0.65, 2: 0.25 } });
    assert.equal(plain.probability, 0.75); assert.deepEqual(plain.answer, { type: 'noul', probability: 0.75 });
    // Windowed over two agents: actor codes expand to both, and the choice over agents is asked.
    const wide = await fixture({ window: { size: 2, stride: 2 }, probe: null }, 2);
    const seen: JevRequest[] = [];
    await new AnalysisWorker(wide.repository, { provider: scriptedProvider(seen) }).runOnce();
    const keys = seen.flatMap(r => r.questions.map(questionKey));
    assert.ok(keys.includes('actorcode@alpha') && keys.includes('actorcode@beta') && keys.includes('primary'));
    const primary = (await wide.repository.listResults(wide.job.id)).items.find(r => r.codeId === 'primary')!;
    assert.ok(primary.answer?.type === 'choice' && ['alpha', 'beta'].includes(primary.answer.choice));
    // Every choice request records the shuffled order it sent.
    const picks = seen.flatMap(r => r.questions).filter(q => q.codeId === 'pick');
    assert.ok(picks.length && picks.every(q => q.optionOrder!.length === 4 && q.optionOrder!.at(-1) === 'none_of_these'));
});

test('probe results never overwrite primaries and reliability matches the stored probe results', async () => {
    const f = await fixture({ preset: 'dense', probe: { windows: 2, repeats: 3, seed: 'p' } }, 4, [code('plain'), code('rate', { question: { type: 'score', levels: ['a', 'b', 'c'] } })]);
    await new AnalysisWorker(f.repository, { provider: scriptedProvider([], true) }).runOnce();
    const job = (await f.repository.getJob(f.job.id))!;
    assert.equal(job.status, 'completed');
    // Primaries: one per window and code, first call of each series (0.5), untouched by the probe.
    const primaries = (await f.repository.listResults(job.id)).items;
    assert.equal(primaries.length, 4 * 2);
    assert.ok(primaries.every(r => !r.probe));
    assert.ok(primaries.filter(r => r.codeId === 'plain').every(r => r.probability === 0.5));
    assert.equal(job.counters.returnedAnswers, job.counters.expectedAnswers);
    // Probes: 2 windows x 2 codes x 3 repeats, flagged and stored separately.
    const probes = (await f.repository.listResults(job.id, { probe: 'only' })).items;
    assert.equal(probes.length, 2 * 2 * 3);
    assert.ok(probes.every(r => r.probe === true));
    assert.deepEqual(new Set(probes.map(r => r.windowId)), new Set(job.manifest.probeWindowIds));
    const plain = probes.filter(r => r.codeId === 'plain');
    assert.deepEqual(plain.map(r => r.probability).sort(), [0.6, 0.6, 0.7, 0.7, 0.8, 0.8].map(Number).sort());
    // Hand-computed: each noul series is 0.6, 0.7, 0.8 (sd 0.1, spread 0.2); each score series is constant (sd 0).
    const reliability = job.reliability!;
    assert.ok(Math.abs(reliability.perCode.plain!.sd - 0.1) < 1e-9); assert.ok(Math.abs(reliability.perCode.plain!.maxSpread - 0.2) < 1e-9);
    assert.equal(reliability.perCode.plain!.n, 2);
    assert.equal(reliability.perCode.rate!.sd, 0); assert.equal(reliability.perCode.rate!.maxSpread, 0);
    assert.ok(Math.abs(reliability.overall.meanSd - 0.05) < 1e-9); assert.ok(Math.abs(reliability.overall.maxSd - 0.1) < 1e-9);
    assert.equal(reliability.overall.probedWindows, 2); assert.equal(reliability.overall.repeats, 3);
    assert.deepEqual({ ...computeReliability(probes, 3, reliability.completedAt) }, reliability);
    // Probe attempts are flagged, counted in usage, and exported as probe_attempt; the export carries reliability and alias maps.
    const attempts = (await f.repository.listAttempts(job.id, { probe: 'include' })).items;
    assert.equal(attempts.filter(a => a.probe).length, 2 * 3);
    assert.equal((await f.repository.listAttempts(job.id)).items.some(a => a.probe), false);
    assert.equal(job.usage!.providerAttempts, attempts.length);
    const types: string[] = []; for await (const row of f.service.exportAnalysis(job.id)) types.push(row.type);
    for (const type of ['probe_attempt', 'reliability', 'alias_map', 'result', 'attempt']) assert.ok(types.includes(type), type);
});

test('a retry resumes the probe without duplicating primary or probe results', async () => {
    const f = await fixture({ preset: 'dense', probe: { windows: 1, repeats: 2, seed: 'r' } }, 2, [code('plain')]);
    const worker = new AnalysisWorker(f.repository, { provider: scriptedProvider() });
    await worker.runOnce();
    await f.service.retry(f.job.id); await worker.runOnce();
    assert.equal((await f.repository.listResults(f.job.id)).items.length, 2);
    assert.equal((await f.repository.listResults(f.job.id, { probe: 'only' })).items.length, 2);
});

test('a window whose evidence quotes the condition is refused rather than sent', async () => {
    const fresh = new InMemoryRepository(), repository = new InMemoryAnalysisRepository(), service = new AnalysisService(repository, fresh);
    const config = defaultFixtureConfiguration(); config.condition.text = `${SENTINEL} is the condition`;
    const run = createQueuedRun(config, 'quote'); run.status = 'completed'; await fresh.createRun(run);
    await fresh.appendEvent({ runId: run.id, invocationId: 'i', agentId: 'alpha', type: 'model_requested', data: { phase: 'action', messages: [] } });
    await fresh.appendEvent({ runId: run.id, invocationId: 'i', agentId: 'alpha', type: 'model_response', data: { text: `I recall: ${SENTINEL} is the condition`, toolCalls: [] } });
    const { codebook } = await service.createCodebook({ name: 'q', creator: 'R', definitions: [code('plain')] });
    const input = { codebookId: codebook.id, settings: { preset: 'dense' as const, probe: null } }, preview = await service.preview(run.id, input);
    assert.equal(preview.background.conditionQuotedWindows.length, 1);
    const job = await service.launch(run.id, { ...input, previewHash: preview.previewHash, idempotencyKey: 'k', creator: 'R' });
    const seen: JevRequest[] = [];
    await new AnalysisWorker(repository, { provider: scriptedProvider(seen) }).runOnce();
    assert.equal(seen.length, 0);
    assert.notEqual((await repository.getJob(job.id))!.status, 'completed');
});
