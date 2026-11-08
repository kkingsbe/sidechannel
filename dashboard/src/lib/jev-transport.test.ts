// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { AnalysisConfiguration, BehaviorDefinition, CodebookRevision, SerializedWindow } from '@sidechannel/contracts/browser';
import type { AnalysisJob as CanonicalJob, WindowRecord } from '@sidechannel/contracts/browser';
import type { Review } from '@sidechannel/contracts/browser';
import type { AnalysisJob, AnalysisPreview, AnalysisSettings, AnalysisWindow, HumanReview, Page, WindowDetail } from './analysis-types';
import { jevTransport } from './jev-transport';

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
let sequence = 0;
const code: BehaviorDefinition = { id: 'supply', code: 'SUPPLY', name: 'Supply', definition: 'A qualifying successful supply.',
 inclusionCriteria: ['Successful action'], exclusionCriteria: ['Proposal only'], examples: ['An executed post'], counterexamples: ['Unexecuted post'],
 qualifyingEvidenceTypes: ['boardContent'], enabled: true, archived: false, color: '#123456' };
function fixture() {
 const id = `transport-${++sequence}`, runId = `run-${sequence}`;
 const settings: AnalysisConfiguration = { version: 1, model: 'jev-1.14.0', window: { size: 12, stride: 4 },
  selection: { phases: ['action'], startOrdinal: 101, endOrdinal: 122 },
  evidence: { assistantText: true, toolArguments: true, toolResults: false, boardContent: false, boardDelivery: true,
   artifactChanges: false, privateMemory: false, providerReasoning: false, finalReports: true },
  inputLimits: { singleQuestionTokens: 30000, combinedQuestionTokens: 60000, maxBodyBytes: 30000000,
   headroomTokens: 4321, estimatorVersion: 'utf8-bytes-conservative-v1' }, concurrency: 3, timeoutMs: 45000, maxAttempts: 4,
  retryBaseMs: 2500, longContext: false };
 const revision: CodebookRevision = { id: `revision-${sequence}`, codebookId: `book-${sequence}`, revision: 3,
  createdAt: '2026-11-07T12:00:00Z', createdBy: 'Researcher', definitions: [code] };
 const job: CanonicalJob = { id, runId, idempotencyKey: 'launch-key', launchHash: 'launch-hash', ready: true,
  status: 'partial', createdAt: '2026-11-07T12:00:00Z', updatedAt: '2026-11-07T12:00:01Z', cancelRequested: false, fence: 1,
  counters: { preparedWindows: 2, submittedWindows: 2, finishedWindows: 1, failedWindows: 1, skippedWindows: 0, returnedAnswers: 1, expectedAnswers: 2 },
  manifest: { version: 1, source: { runId, configHash: 'config-hash', status: 'completed', sequenceBoundary: 1234,
   eventCount: 1000, evidenceHash: 'evidence-hash', normalizerVersion: 'normalizer-v1' }, sourceArtifact: `${id}:source`,
   settings, codebook: revision, settingsHash: 'settings-hash', staticContext: { version: 'task-policy-v1', hash: 'context-hash' },
   normalizerVersion: 'normalizer-v1', serializationVersion: 'serialization-v1', questionTemplateVersion: 'questions-v1',
   providerAdapterVersion: 'adapter-v1', sdkVersion: '0.7.0', diagnostics: [], availability: {
    assistantText: true, toolArguments: true, toolResults: true, boardContent: true, boardDelivery: true,
    artifactChanges: false, privateMemory: true, providerReasoning: false, finalReports: true }, creator: 'Researcher' } };
 const window: WindowRecord = { id: `window-${sequence}`, jobId: id, ordinal: 0, index: 0, startOrdinal: 101, endOrdinal: 112,
  stepIds: ['step-101', 'step-102'], eventIds: ['event-101', 'event-102'], partial: false, incomplete: true,
  status: 'failed', inputRef: 'input-ref', inputHash: 'exact-input-hash', inputBytes: 3456, estimatedTokens: 3456,
  diagnostics: ['One requested code has no answer.'], batches: [['supply', 'missing-code']] };
 const input: SerializedWindow = { serializationVersion: 'serialization-v1', windowId: window.id,
  state: '{"steps":[{"text":"EXACT_FROZEN_EVIDENCE","eventIds":["event-101"]}]}', hash: window.inputHash,
  bytes: window.inputBytes, estimatedTokens: window.estimatedTokens, estimatorVersion: settings.inputLimits.estimatorVersion,
  hasEvidence: true, availability: job.manifest.availability, selection: settings.evidence };
 return { id, runId, settings, revision, job, window, input };
}
function stub(handler: (path: string, options?: RequestInit) => unknown | Promise<unknown>) {
 const calls: { path: string; options?: RequestInit; body?: any }[] = [];
 return { calls, fetch: async <T,>(path: string, options?: RequestInit): Promise<T> => {
  calls.push({ path, options, body: options?.body ? JSON.parse(String(options.body)) : undefined });
  return structuredClone(await handler(path, options)) as T;
 } };
}
function summary(f: ReturnType<typeof fixture>) {
 return { previewHash: `preview-${f.id}`, runId: f.runId, windowCount: 1, scoredCodeCount: 1, partialWindows: 0,
  evidenceAvailability: f.job.manifest.availability, diagnostics: [], windows: [{ id: f.window.id, index: 0,
   startOrdinal: 101, endOrdinal: 112, partial: false, incomplete: true, hasEvidence: true, bytes: 3456, estimatedTokens: 3456,
   budget: { oversized: false, diagnostics: [], batches: [[{ codeId: 'supply', instructions: 'Does supply occur?' }]],
    budget: { estimatorVersion: f.settings.inputLimits.estimatorVersion, effectiveLimits: f.settings.inputLimits } } }] };
}
describe('canonical Jev transport', () => {
 it('sends the form’s captured revision ID after another GET observes a newer book revision', async () => {
  const f = fixture(), book = { id: f.revision.codebookId, name: 'Study', currentRevisionId: f.revision.id, createdAt: f.revision.createdAt, updatedAt: f.revision.createdAt };
  let current = f.revision.id;
  const server = stub((path, options) => {
   if (path === '/jev/codebooks') return { items: [{ ...book, currentRevisionId: current }], nextCursor: null };
   if (options?.method === 'PATCH') {
    const input = JSON.parse(String(options.body));
    if (input.expectedRevisionId !== current) throw Object.assign(new Error('Codebook revision changed'), { status: 409 });
    return { codebook: book, revision: f.revision };
   }
   return path.endsWith('/' + f.revision.id) ? f.revision : book;
  });
  await jevTransport('/codebooks/' + book.id, undefined, server.fetch);
  current = 'a-teammates-new-revision';
  await jevTransport('/codebooks', undefined, server.fetch);
  await expect(jevTransport('/codebooks/' + book.id, { method: 'PATCH', body: JSON.stringify({ expectedRevisionId: f.revision.id, codes: [code], name: 'My unsaved edits', author: 'Researcher' }) }, server.fetch)).rejects.toMatchObject({ status: 409 });
  expect(server.calls.at(-1)!.body.expectedRevisionId).toBe(f.revision.id);
  expect(server.calls.at(-1)!.body.definitions).toEqual([code]);
 });
 it('rejects codebook PATCH without its explicit revision instead of guessing a mutable cached value', async () => {
  const server = stub(() => { throw new Error('Must not send'); });
  await expect(jevTransport('/codebooks/study', { method: 'PATCH', body: JSON.stringify({ expectedRevision: 3 }) }, server.fetch)).rejects.toThrow('revision ID is required');
  expect(server.calls).toHaveLength(0);
 });
 it('preserves every resolved setting and restricted evidence category when duplicating an existing analysis', async () => {
  const f = fixture(), server = stub(path => path.endsWith('/preview') ? summary(f) : f.job);
  const loaded = (await jevTransport<AnalysisJob>('/analyses/' + f.id, undefined, server.fetch))!.value;
  await jevTransport('/runs/' + f.runId + '/analyses/preview', post(loaded.manifest.settings), server.fetch);
  expect(server.calls.at(-1)!.body.settings).toEqual(f.settings);
  expect(server.calls.at(-1)!.body.settings.evidence.toolResults).toBe(false);
  expect(server.calls.at(-1)!.body.settings.evidence.boardContent).toBe(false);
  expect(loaded.manifest.staticContext).toEqual({ version: f.job.manifest.staticContext.version });
  expect(loaded.manifest.selectedStepCount).toBeUndefined();
  expect(loaded.manifest.partialWindowCount).toBeUndefined();
 });
 it('launches the selected codebook/model/window/evidence with token headroom and frozen preview hash', async () => {
  const f = fixture(), server = stub(() => f.job);
  const view: AnalysisSettings = { codebookId: 'chosen-book', codebookRevisionId: 'chosen-revision', model: 'jev-custom',
   windowSize: 7, stride: 2, phases: ['report'], startStep: 9, endStep: 16, evidence: ['memory', 'assistant'],
   headroom: 1234, timeoutMs: 23456, maxAttempts: 2, creator: 'Claimed creator', parentAnalysisId: 'previous-analysis' };
  await jevTransport('/runs/' + f.runId + '/analyses', post({ ...view, previewToken: 'frozen-preview', idempotencyKey: 'explicit-launch' }), server.fetch);
  const sent = server.calls[0]!.body;
  expect(sent.codebookRevisionId).toBe('chosen-revision'); expect(sent.previewHash).toBe('frozen-preview');
  expect(sent.creator).toBe(view.creator); expect(sent.parentAnalysisId).toBe('previous-analysis');
  expect(sent.idempotencyKey).toBe('explicit-launch'); expect(sent.settings.model).toBe('jev-custom');
  expect(sent.settings.window).toEqual({ size: 7, stride: 2 });
  expect(sent.settings.selection).toEqual({ phases: ['report'], startOrdinal: 9, endOrdinal: 16 });
  expect(sent.settings.inputLimits.headroomTokens).toBe(1234);
  expect(Object.entries(sent.settings.evidence).filter(([, enabled]) => enabled).map(([name]) => name).sort()).toEqual(['assistantText', 'privateMemory']);
 });
 it('maps actual nested preview budgets and retrieves exact inputs using the same preview settings', async () => {
  const f = fixture(), server = stub(path => path.includes('/preview/windows/') ? { input: f.input } : summary(f));
  const view: AnalysisSettings = { codebookId: f.revision.codebookId, codebookRevisionId: f.revision.id, model: 'jev-1.14.0',
   windowSize: 12, stride: 4, phases: ['action'], evidence: ['assistant'], headroom: 4321, timeoutMs: 60000, maxAttempts: 2, creator: 'Researcher' };
  const result = (await jevTransport<AnalysisPreview>('/runs/' + f.runId + '/analyses/preview', post(view), server.fetch))!.value;
  expect(result.manifest.selectedStepCount).toBeUndefined();
  expect(result.windows[0]!.budget).toMatchObject({ headroom: 4321, perQuestionLimit: 30000, perRequestLimit: 60000,
   batches: [['supply']], oversized: false, estimatedTokens: 3456, estimatorVersion: f.settings.inputLimits.estimatorVersion });
  const previewBody = server.calls[0]!.body;
  const exact = (await jevTransport<{ state: string }>(`/analysis-previews/${result.previewToken}/windows/${f.window.id}`, undefined, server.fetch))!.value;
  expect(exact.state).toBe(f.input.state);
  expect(server.calls.at(-1)!.body).toEqual({ ...previewBody, previewHash: result.previewToken });
 });
 it('preserves zero probabilities and missing siblings while loading manifest provenance before a direct windows link', async () => {
  const f = fixture(), result = { id: 'zero-result', jobId: f.id, windowId: f.window.id, codeId: 'supply', probability: 0, attemptId: 'attempt-zero', createdAt: f.job.createdAt };
  const server = stub(path => path.includes('/windows?') ? { items: [{ ...f.window, results: [result] }], nextCursor: 'next-page' } : f.job);
  const page = (await jevTransport<Page<AnalysisWindow>>('/analyses/' + f.id + '/windows?after=previous&limit=20', undefined, server.fetch))!.value;
  expect(page.nextCursor).toBe('next-page'); expect(page.items[0]!.results).toHaveLength(1);
  expect(page.items[0]!.results![0]!.probability).toBe(0);
  expect(page.items[0]!.results!.find(item => item.codeId === 'missing-code')).toBeUndefined();
  expect(page.items[0]!.results![0]!.returnedModel).toBeUndefined();
  expect(page.items[0]!.runId).toBe(f.runId); expect(page.items[0]!.budget.headroom).toBe(4321);
  expect(server.calls[1]!.path).toContain('withResults=true'); expect(server.calls[1]!.path).toContain('after=previous');
 });
 it('returns exact window state and real source event membership without fabricating empty raw event coverage', async () => {
  const f = fixture(), server = stub(path => path.includes('/windows/') ? { window: f.window, input: f.input, results: { items: [], nextCursor: null } } : f.job);
  const detail = (await jevTransport<WindowDetail>(`/analyses/${f.id}/windows/${f.window.id}`, undefined, server.fetch))!.value;
  expect(detail.window.state).toBe(f.input.state); expect(detail.sourceEventIds).toEqual(f.window.eventIds);
  expect(detail.events).toBeUndefined(); expect(detail.window.stepIds).toEqual(f.window.stepIds);
 });
 it('retains event subjects and expected review revision and rejects accidental multi-event annotations', async () => {
  const f = fixture();
  const saved: Review = { id: `review-${f.id}`, analysisId: f.id, subjectId: 'event-101', scope: 'event', codeId: 'supply',
   definitionRevision: f.revision.id, evidenceRevision: f.job.manifest.source.evidenceHash, reviewer: 'Researcher', identityVerified: false,
   decision: 'uncertain', rationale: 'Missing evidence', eventIds: ['event-101'], stepIds: [], predictionsVisible: false,
   revision: 7, createdAt: f.job.createdAt };
  const server = stub((path, options) => path.includes('/windows/') ? { window: f.window, input: f.input, results: { items: [], nextCursor: null } }
   : path.includes('/reviews') ? options?.method === 'POST' ? { ...saved, revision: 8 } : { items: [saved], nextCursor: null } : f.job);
  await jevTransport(`/analyses/${f.id}/windows/${f.window.id}`, undefined, server.fetch);
  const history = (await jevTransport<Page<HumanReview>>(`/analyses/${f.id}/reviews?windowId=${f.window.id}`, undefined, server.fetch))!.value;
  expect(history.items[0]!.windowId).toBe(f.window.id); expect(history.items[0]!.subjectId).toBe('event-101');
  const input = { ...history.items[0]!, supersedesId: saved.id };
  await jevTransport(`/analyses/${f.id}/reviews`, post(input), server.fetch);
  expect(server.calls.at(-1)!.body).toMatchObject({ expectedRevision: 7, subjectId: 'event-101', definitionRevision: f.revision.id,
   evidenceRevision: f.job.manifest.source.evidenceHash, predictionsVisible: false });
  const before = server.calls.length;
  await expect(jevTransport(`/analyses/${f.id}/reviews`, post({ ...input, eventIds: ['event-101', 'event-102'] }), server.fetch)).rejects.toThrow('exactly one source event');
  expect(server.calls).toHaveLength(before);
 });
 it('never reconstructs hidden blind sampling reasons, thresholds, seed or score ordering cues', async () => {
  const f = fixture(), raw = { batch: { id: 'blind-batch', analysisId: f.id, createdAt: f.job.createdAt,
   definitionRevision: f.revision.id, evidenceRevision: 'source-hash', populationHash: 'population', populationSize: 20,
   randomSize: 5, selectedCount: 7, mode: 'blind' }, items: [{ windowId: 'random-id' }], nextCursor: 'opaque-next' };
  const server = stub(() => raw);
  const result = (await jevTransport<{ batch: Record<string, unknown>; selections: Page<Record<string, unknown>> }>(`/analyses/${f.id}/review-batches/blind-batch?reviewer=Alice`, undefined, server.fetch))!.value;
  expect(result.batch.threshold).toBeUndefined(); expect(result.batch.seed).toBeUndefined(); expect(result.batch.codeIds).toBeUndefined();
  expect(result.selections.items[0]!.reasons).toBeUndefined(); expect(result.selections.items[0]!.order).toBeUndefined();
  expect(result.selections.nextCursor).toBe('opaque-next');
 });
 it('leaves independent run outcomes and monitor API calls untouched', async () => {
  const server = stub(() => { throw new Error('Must not call Jev'); });
  expect(await jevTransport('/runs/source/outcomes', undefined, server.fetch)).toBeUndefined();
  expect(await jevTransport('/monitor-evaluations', undefined, server.fetch)).toBeUndefined();
  expect(server.calls).toHaveLength(0);
 });
 it('forwards exact latest-review and whole-population queue filters with opaque cursors unchanged', async () => {
  const f = fixture(), rawBatch = { id: 'filtered-batch', analysisId: f.id, createdAt: f.job.createdAt,
   definitionRevision: f.revision.id, evidenceRevision: 'source-hash', populationHash: 'population', populationSize: 1000,
   randomSize: 50, threshold: 0.7, codeIds: ['supply'], selectedCount: 80, mode: 'assisted' };
  const server = stub(path => path.includes('/review-batches/') ? { batch: rawBatch, items: [{ windowId: 'late-match', reasons: ['random'] }], nextCursor: 'filtered:cursor' }
   : path.includes('/reviews?') ? { items: [], nextCursor: 'history:cursor' } : f.job);
  const filter = new URLSearchParams({ windowId: f.window.id, reviewer: 'Alice Name', subjectId: 'event-101', scope: 'event', codeId: 'supply', latest: 'true', limit: '1', after: 'opaque:cursor' });
  await jevTransport(`/analyses/${f.id}/reviews?${filter}`, undefined, server.fetch);
  expect(new URL(server.calls.at(-1)!.path, 'http://local').searchParams.toString()).toBe(filter.toString());
  const queueFilter = new URLSearchParams({ filter: 'disagreement', reviewer: 'Alice Name', limit: '30', after: 'opaque:queue' });
  const page = (await jevTransport<{ selections: Page<{ windowId: string }> }>(`/analyses/${f.id}/review-batches/filtered-batch?${queueFilter}`, undefined, server.fetch))!.value;
  expect(new URL(server.calls.at(-1)!.path, 'http://local').searchParams.toString()).toBe(queueFilter.toString());
  expect(page.selections.items).toHaveLength(1); expect(page.selections.items[0]!.windowId).toBe('late-match');
  expect(page.selections.nextCursor).toBe('filtered:cursor');
 });
});

it('adapts the global analysis collection and preserves pagination', async () => {
 const f = fixture();
 const mock = stub(path => {
  expect(path).toBe('/jev/analyses?limit=30&after=saved-cursor');
  return {items:[f.job],nextCursor:'next-page'};
 });
 const response = await jevTransport<Page<AnalysisJob>>('/analyses?limit=30&after=saved-cursor', undefined, mock.fetch);
 expect(response?.value.nextCursor).toBe('next-page');
 expect(response?.value.items[0].manifest.settings.windowSize).toBe(f.settings.window.size);
 expect(response?.value.items[0].runId).toBe(f.runId);
 });
 it('maps archive state, passes the archived filter, and sends archive/restore requests with the actor', async () => {
  const f = fixture();
  const active = { id: 'a', name: 'Active', currentRevisionId: 'r1', createdAt: f.revision.createdAt, updatedAt: f.revision.createdAt };
  const archived = { ...active, id: 'b', name: 'Old', archivedAt: '2026-11-08T00:00:00Z', archivedBy: 'Lead' };
  const server = stub((path, options) => {
   if (path.startsWith('/jev/codebooks?')) return { items: [active, archived], nextCursor: 'c2' };
   if (path === '/jev/codebooks/b/restore') return { codebook: active };
   return { codebook: archived };
  });
  const list = await jevTransport<Page<any>>('/codebooks?limit=30&archived=include', undefined, server.fetch);
  expect(server.calls[0].path).toBe('/jev/codebooks?limit=30&archived=include');
  expect(list?.value.items.map((book: any) => book.archived)).toEqual([false, true]);
  expect(list?.value.items[1]).toMatchObject({ archivedAt: '2026-11-08T00:00:00Z', archivedBy: 'Lead' });
  expect(list?.value.nextCursor).toBe('c2');
  const archive = await jevTransport<{ codebook: any }>('/codebooks/a/archive', post({ expectedRevisionId: 'r1', author: 'Lead' }), server.fetch);
  expect(server.calls.at(-1)).toMatchObject({ path: '/jev/codebooks/a/archive', body: { expectedRevisionId: 'r1', actor: 'Lead' } });
  expect(archive?.value.codebook.archived).toBe(true);
  const restore = await jevTransport<{ codebook: any }>('/codebooks/b/restore', post({ expectedRevisionId: 'r1', author: 'Lead' }), server.fetch);
  expect(server.calls.at(-1)).toMatchObject({ path: '/jev/codebooks/b/restore', body: { expectedRevisionId: 'r1', actor: 'Lead' } });
  expect(restore?.value.codebook.archived).toBe(false);
  await expect(jevTransport('/codebooks/a/archive', post({ author: 'Lead' }), server.fetch)).rejects.toThrow('revision ID is required');
 });
