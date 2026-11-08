import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisValidation, type AnalysisResult } from '@sidechannel/contracts/analysis/jev-repository';
import type { Decision, ReviewContext, ReviewMember } from '@sidechannel/contracts/analysis/jev-reviews';
import { binIndex, parseBatchStrategy, ReviewService } from '@sidechannel/domain/analysis/jev-reviews';
import { InMemoryAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { MemoryReviewStore } from '@sidechannel/persistence/analysis/review-repository';
import { createValidationRouteHandler } from '../../api/src/routes/jev-validation.js';
import { reviewContext } from '../../api/src/routes/review-routes.js';
import { analysisJob, analysisWindow } from './contracts/fixtures.js';

// Twelve windows scored for `supply`. With bins 0, .3, .7, 1 they fall as:
//   [0, .3):  w0 .00  w1 .05  w2 .10  w3 .15  w4 .20  w5 .25      (6 windows)
//   [.3, .7): w6 .30  w7 .50                                         (2 windows; .3 is the lower edge, inclusive)
//   [.7, 1]:  w8 .70  w9 1.00 w10 .90 w11 .95                        (4 windows; .7 and 1.0 land here)
const scores = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.5, 0.7, 1, 0.9, 0.95];
const context: ReviewContext = { analysisId: 'a', runId: 'r', definitionRevision: 'rev-1', evidenceRevision: 'ev-1', codeIds: ['supply', 'challenge'],
    windows: scores.map((p, i) => ({ id: `w${i}`, eventIds: [`e${i}`], stepIds: [`s${i}`], probabilities: { supply: p, challenge: 0.5 } })) };
const service = () => new ReviewService(new MemoryReviewStore(), async () => structuredClone(context));
const bins: Record<string, string[]> = { low: ['w0', 'w1', 'w2', 'w3', 'w4', 'w5'], mid: ['w6', 'w7'], high: ['w8', 'w9', 'w10', 'w11'] };

async function members(s: ReviewService, batchId: string) { const page = await s.getBatch('a', batchId, { provenance: true, limit: 500 }); return page.items as ReviewMember[]; }

test('bin edges are lower-inclusive and the last edge is inclusive', () => {
    const edges = [0, 0.3, 0.7, 1];
    assert.deepEqual([0, 0.299, 0.3, 0.699, 0.7, 1].map(p => binIndex(edges, p)), [0, 0, 1, 1, 2, 2]);
    assert.equal(binIndex(edges, 1.01), -1);
});

test('strategy validation applies the spec defaults and rejects malformed input', () => {
    assert.deepEqual(parseBatchStrategy({ kind: 'stratified' }), { kind: 'stratified', bins: [0, 0.3, 0.7, 1], perBin: 10 });
    assert.deepEqual(parseBatchStrategy({ kind: 'disagreement' }), { kind: 'disagreement', minGap: 0.5 });
    assert.equal(parseBatchStrategy(undefined), undefined);
    for (const bad of [{ kind: 'nope' }, { kind: 'stratified', bins: [0.5] }, { kind: 'stratified', bins: [0, 0.5, 0.5, 1] }, { kind: 'stratified', bins: [0, 2] },
        { kind: 'stratified', perBin: 0 }, { kind: 'disagreement', minGap: 0 }, { kind: 'disagreement', minGap: 1.5 }, 'stratified']) assert.throws(() => parseBatchStrategy(bad), AnalysisValidation);
});

test('stratified batches fill each bin, report the short bin and record the reason and strategy', async () => {
    const s = service();
    const batch = await s.createBatch('a', { seed: 'seed-1', codeIds: ['supply'], strategy: { kind: 'stratified', perBin: 3 } });
    // low has 6 (draw 3), mid has 2 (short by one), high has 4 (draw 3): 3 + 2 + 3 = 8 windows
    assert.equal(batch.selectedCount, 8);
    assert.deepEqual(batch.strategy, { kind: 'stratified', bins: [0, 0.3, 0.7, 1], perBin: 3 });
    assert.deepEqual(batch.shortfalls, [{ codeId: 'supply', bin: 1, requested: 3, drawn: 2 }]);
    assert.equal(batch.randomSize, 0);
    const picked = (await members(s, batch.id)).filter(m => m.selected);
    assert.ok(picked.every(m => m.reasons.length === 1 && m.reasons[0] === 'stratified'), 'no flagged or random reason is recorded');
    const ids = picked.map(m => m.windowId);
    assert.equal(ids.filter(id => bins.low!.includes(id)).length, 3);
    assert.deepEqual(ids.filter(id => bins.mid!.includes(id)).sort(), ['w6', 'w7']);
    assert.equal(ids.filter(id => bins.high!.includes(id)).length, 3);
    assert.deepEqual((await s.listBatches('a')).items[0]!.strategy, batch.strategy, 'the strategy is persisted');
});

test('a stratified draw is deterministic per seed and the seed changes the draw', async () => {
    const draw = async (seed: string) => { const s = service(); const b = await s.createBatch('a', { seed, codeIds: ['supply'], strategy: { kind: 'stratified', perBin: 2 } }); return (await members(s, b.id)).filter(m => m.selected).map(m => m.windowId).sort().join(); };
    assert.equal(await draw('same'), await draw('same'));
    const distinct = new Set(await Promise.all(['s1', 's2', 's3', 's4', 's5', 's6'].map(draw)));
    assert.ok(distinct.size > 1);
});

test('custom bins and several codes draw per code', async () => {
    const s = service();
    // challenge scores .5 everywhere: with edges 0, .5, 1 all twelve fall in the upper bin, so perBin 2 draws 2 and the lower bin is empty
    const batch = await s.createBatch('a', { seed: 'x', codeIds: ['challenge'], strategy: { kind: 'stratified', bins: [0, 0.5, 1], perBin: 2 } });
    assert.equal(batch.selectedCount, 2);
    assert.deepEqual(batch.shortfalls, [{ codeId: 'challenge', bin: 0, requested: 2, drawn: 0 }]);
});

test('manual picks still join a strategy batch and absent strategy keeps the v1 reasons', async () => {
    const s = service();
    const strategy = { kind: 'stratified', perBin: 1 };
    const baseline = await s.createBatch('a', { seed: 'x', codeIds: ['supply'], strategy });
    const drawn = (await members(s, baseline.id)).some(m => m.windowId === 'w7');
    const withManual = await s.createBatch('a', { seed: 'x', codeIds: ['supply'], strategy, manualWindowIds: ['w7'] });
    assert.deepEqual((await members(s, withManual.id)).find(m => m.windowId === 'w7')!.reasons, drawn ? ['stratified', 'manual'] : ['manual']);
    const v1 = await s.createBatch('a', { seed: 'pilot', randomSize: 0, threshold: 0.9, codeIds: ['supply'] });
    assert.equal(v1.strategy, undefined); assert.equal(v1.shortfalls, undefined);
    assert.deepEqual((await members(s, v1.id)).filter(m => m.selected).map(m => [m.windowId, m.reasons]).sort(), [['w10', ['flagged']], ['w11', ['flagged']], ['w9', ['flagged']]]);
    const explicit = await s.createBatch('a', { seed: 'pilot', randomSize: 0, threshold: 0.9, codeIds: ['supply'], strategy: { kind: 'flagged-plus-random' } });
    assert.equal(explicit.selectedCount, 3);
});

test('blind batches hide strategy-derived reasons, order and shortfalls until the reviewer has reviewed', async () => {
    const s = service();
    const batch = await s.createBatch('a', { seed: 'seed-1', codeIds: ['supply'], strategy: { kind: 'stratified', perBin: 3 }, mode: 'blind' });
    const queue = await s.getBatch('a', batch.id, { reviewer: 'carol', limit: 500 });
    assert.equal(queue.items.length, 8);
    assert.ok(queue.items.every(item => !('reasons' in item) && !('order' in item) && !('eligible' in item)));
    assert.ok(!('shortfalls' in queue.batch) && !('seed' in queue.batch) && !('codeIds' in queue.batch));
    const first = queue.items[0]!.windowId;
    await s.save('a', { subjectId: first, scope: 'window', codeId: 'supply', definitionRevision: 'rev-1', evidenceRevision: 'ev-1', reviewer: 'carol', decision: 'present', rationale: 'Reviewed window.', eventIds: [], stepIds: [], predictionsVisible: false });
    const after = await s.getBatch('a', batch.id, { reviewer: 'carol', limit: 500 });
    assert.deepEqual(after.items.find(m => m.windowId === first)!.reasons, ['stratified']);
    assert.ok(after.items.filter(m => m.windowId !== first).every(m => !('reasons' in m)));
});

test('disagreement batches select windows where a latest label and the score differ by at least minGap', async () => {
    const s = service();
    const label = (subjectId: string, decision: Decision, reviewer = 'alice', expectedRevision?: number) => s.save('a', { subjectId, scope: 'window', codeId: 'supply', definitionRevision: 'rev-1', evidenceRevision: 'ev-1', reviewer, decision, rationale: 'Label.', eventIds: [], stepIds: [], predictionsVisible: true, ...(expectedRevision ? { expectedRevision } : {}) });
    await label('w0', 'present');   // score .00, gap 1.0
    await label('w9', 'absent');    // score 1.00, gap 1.0
    await label('w8', 'present');   // score .70, gap .3
    await label('w6', 'absent');    // score .30, gap .3
    await label('w1', 'uncertain'); // never qualifies
    await label('w4', 'present'); await label('w4', 'absent', 'alice', 1); // superseded: latest label absent at .20, gap .2
    await label('w2', 'absent', 'bob'); // agrees with score .10
    const pick = async (minGap: number) => { const b = await s.createBatch('a', { seed: 'x', codeIds: ['supply'], strategy: { kind: 'disagreement', minGap } }); return (await members(s, b.id)).filter(m => m.selected).map(m => [m.windowId, ...m.reasons].join(':')).sort(); };
    assert.deepEqual(await pick(0.5), ['w0:disagreement', 'w9:disagreement']);
    assert.deepEqual(await pick(0.3), ['w0:disagreement', 'w6:disagreement', 'w8:disagreement', 'w9:disagreement']);
    // w4's first label (present, gap .8) was superseded; its latest label is absent at .20, a gap of exactly .2
    assert.deepEqual(await pick(0.2), ['w0:disagreement', 'w4:disagreement', 'w6:disagreement', 'w8:disagreement', 'w9:disagreement']);
});

// ---- Route handler and probe handling ---------------------------------------------------------------------------------

async function seeded(options: { labels?: (Decision | null)[][]; reliability?: number } = {}) {
    const analyses = new InMemoryAnalysisRepository(), reviews = new MemoryReviewStore();
    const definition = (id: string, enabled = true) => ({ id, code: id, name: id, definition: '', inclusionCriteria: [], exclusionCriteria: [], examples: [], counterexamples: [], qualifyingEvidenceTypes: [], enabled, archived: false, color: '#000' });
    const revision = { id: 'rev-1', codebookId: 'book', revision: 1, createdAt: '2026-01-01T00:00:00.000Z', createdBy: 't', definitions: [definition('supply'), definition('off', false)] };
    await analyses.saveCodebook({ id: 'book', name: 'Book', currentRevisionId: 'rev-1', createdAt: revision.createdAt, updatedAt: revision.createdAt }, revision, undefined);
    const base = analysisJob('job-1');
    const job = { ...base, manifest: { ...base.manifest, codebook: revision, settings: { ...base.manifest.settings, model: 'jev-test' } }, ...(options.reliability === undefined ? {} : { reliability: { perCode: { supply: { sd: options.reliability, maxSpread: 0.1, n: 6 } }, overall: { meanSd: options.reliability, maxSd: options.reliability, probedWindows: 6, repeats: 4 }, completedAt: revision.createdAt } }) };
    await analyses.reserveJob(job);
    const claimed = await analyses.claim('owner', new Date().toISOString(), 60_000);
    for (let i = 0; i < 4; i++) await analyses.putWindow({ ...analysisWindow('job-1', `w${i}`), eventIds: [`e${i}`], stepIds: [`s${i}`] });
    const result = (windowId: string, probability: number, probe = false): AnalysisResult => ({ id: `${windowId}-${probe}`, jobId: 'job-1', windowId, codeId: 'supply', probability, ...(probe ? { probe } : {}), attemptId: 'at', createdAt: revision.createdAt });
    // The probe result for w0 is stored under a distinct code so the primary one is untouched but must still be ignored.
    const all = [result('w0', 0.9), result('w1', 0.8), result('w2', 0.2), result('w3', 0.1), { ...result('w0', 0.01, true), codeId: 'probe-only' }];
    await analyses.finishAttempt(claimed!.lease, { id: 'at', jobId: 'job-1', windowId: 'w0', codeIds: ['supply'], requestRef: 'x', startedAt: revision.createdAt, status: 'succeeded', requestedModel: 'jev-test' }, all);
    const service = new ReviewService(reviews, async () => ({ analysisId: 'job-1', runId: 'run-1', definitionRevision: 'rev-1', evidenceRevision: 'evidence-hash', codeIds: ['supply'], windows: [0, 1, 2, 3].map(i => ({ id: `w${i}`, eventIds: [`e${i}`], stepIds: [`s${i}`], probabilities: {} })) }));
    const decisions: [string, Decision][] = [['w0', 'present'], ['w1', 'absent'], ['w2', 'present'], ['w3', 'absent']];
    for (const [subjectId, decision] of decisions) await service.save('job-1', { subjectId, scope: 'window', codeId: 'supply', definitionRevision: 'rev-1', evidenceRevision: 'evidence-hash', reviewer: 'alice', decision, rationale: 'Label.', eventIds: [], stepIds: [], predictionsVisible: false });
    const handler = createValidationRouteHandler(analyses, reviews);
    const get = (path: string) => { const url = new URL('http://local' + path); return handler({ method: 'GET', path: url.pathname, query: url.searchParams, body: async () => ({}) }); };
    return { analyses, get };
}

test('GET /codebooks/:id/validation computes per-code metrics for the current revision and model', async () => {
    const { get } = await seeded({ reliability: 0.03 });
    const response = await get('/codebooks/book/validation?model=jev-test');
    const data = response!.data as unknown as { definitionRevision: string; model: string; items: { codeId: string; labels: number; positives: number; precision: number; recall: number; noiseFloor: number; status: string }[] };
    assert.equal(response!.status, 200); assert.equal(data.definitionRevision, 'rev-1');
    assert.deepEqual(data.items.map(i => i.codeId), ['supply'], 'disabled codes are not validated');
    // w0 .9 present (tp), w1 .8 absent (fp), w2 .2 present (fn), w3 .1 absent (tn): precision 1/2, recall 1/2
    const [row] = data.items; assert.deepEqual([row!.labels, row!.positives, row!.precision, row!.recall, row!.noiseFloor, row!.status], [4, 2, 0.5, 0.5, 0.03, 'unvalidated']);
    const other = await get('/codebooks/book/validation?model=another-model');
    assert.equal((other!.data as unknown as { items: { labels: number }[] }).items[0]!.labels, 0, 'only analyses that used the model contribute');
});

test('GET /codebooks/:id/disagreements groups the labelled windows by gap', async () => {
    const { get } = await seeded();
    const response = await get('/codebooks/book/disagreements?model=jev-test&codeId=supply');
    const data = response!.data as unknown as { modelHighHumanAbsent: { windowId: string; gap: number }[]; modelLowHumanPresent: { windowId: string }[] };
    assert.deepEqual(data.modelHighHumanAbsent.map(r => r.windowId), ['w1', 'w3']); assert.ok(Math.abs(data.modelHighHumanAbsent[0]!.gap - 0.8) < 1e-9);
    assert.deepEqual(data.modelLowHumanPresent.map(r => r.windowId), ['w2', 'w0']);
});

test('validation routes reject a missing model, an unknown code and an unknown codebook, and ignore other paths', async () => {
    const { get } = await seeded();
    await assert.rejects(get('/codebooks/book/validation'), /model is required/);
    await assert.rejects(get('/codebooks/book/disagreements?model=jev-test'), /codeId/);
    await assert.rejects(get('/codebooks/book/disagreements?model=jev-test&codeId=off'), /codeId/);
    await assert.rejects(get('/codebooks/nope/validation?model=m'), /not found/);
    assert.equal(await get('/codebooks/book'), null);
});

test('probe results never feed batch selection', async () => {
    const { analyses } = await seeded();
    const context = await reviewContext(analyses, 'job-1');
    assert.equal(context.windows.find(w => w.id === 'w0')!.probabilities.supply, 0.9);
    assert.equal(context.windows.find(w => w.id === 'w0')!.probabilities['probe-only'], undefined);
});
