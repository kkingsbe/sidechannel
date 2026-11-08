import { randomUUID } from 'node:crypto';
import type { HarnessEvent } from '@sidechannel/contracts/harness/contracts';
import { isTerminalRun } from '@sidechannel/contracts/harness/contracts';
import type { Repository } from '@sidechannel/contracts/harness/server';
import type { BehaviorDefinition, CodebookRevision, SerializedWindow } from '@sidechannel/contracts/analysis/evidence-contracts';
import { createSeedCodebook, resolveAnalysisConfiguration, snapshotHash, staticContextForRun, validateBehaviorDefinitions } from './configuration.js';
import { normalizeTrace } from './normalization.js';
import { buildWindows, selectSteps } from './windows.js';
import { serializeWindow, preflightQuestions, SERIALIZATION_VERSION } from './serialization.js';
import { buildBehaviorQuestions, JEV_ADAPTER_VERSION, JEV_SDK_VERSION, QUESTION_TEMPLATE_VERSION } from './jev-questions.js';
import { AnalysisConflict, AnalysisNotFound, AnalysisPayloadTooLarge, AnalysisValidation, type AnalysisJob, type AnalysisRepository, type WindowRecord } from '@sidechannel/contracts/analysis/jev-repository';
import { emptyCounters } from './jev-repository.js';
import { iteratePages, type PageFetcher } from '../pagination.js';
import type { PreviewInput, LaunchInput } from '@sidechannel/contracts/analysis/jev-service';

const text = (v: unknown, label: string, max = 200): string => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new AnalysisValidation(`${label} must be a nonempty string of at most ${max} characters`); return v.trim(); };

const validate = <T>(fn: () => T): T => { try { return fn(); } catch (e) { throw new AnalysisValidation(e instanceof Error ? e.message : 'Invalid analysis input'); } };

/** Compatibility wrapper for the analysis worker; one cursor loop implementation for the whole codebase. */
export function pages<T>(fetch: PageFetcher<T>): AsyncGenerator<T> { return iteratePages(fetch, 100); }

export class AnalysisService {
    /** Composed analysis port: this service is the codebook + job lifecycle entry point. */
    constructor(readonly repository: AnalysisRepository, private readonly source: Pick<Repository, 'getRun' | 'listEvents'>) {}
    async seedCodebook() { const existing = await this.repository.getCodebook('tentative-default'); if (existing) return existing; const { codebook, revision } = createSeedCodebook(); codebook.id = 'tentative-default'; codebook.currentRevisionId = revision.id = 'tentative-default-v1'; revision.codebookId = codebook.id; try { await this.repository.saveCodebook(codebook, revision); } catch (e) { if (!(e instanceof AnalysisConflict)) throw e; } return (await this.repository.getCodebook(codebook.id))!; }
    async createCodebook(input: { name: string; creator: string; definitions: BehaviorDefinition[] }) {
        const name = text(input.name, 'Name'), createdBy = text(input.creator, 'Creator'), definitions = validate(() => validateBehaviorDefinitions(input.definitions)), now = new Date().toISOString(), id = randomUUID(), revisionId = randomUUID();
        const codebook = { id, name, currentRevisionId: revisionId, createdAt: now, updatedAt: now }, revision: CodebookRevision = { id: revisionId, codebookId: id, revision: 1, definitions, createdAt: now, createdBy };
        await this.repository.saveCodebook(codebook, revision); return { codebook, revision };
    }
    async archiveCodebook(id: string, input: { expectedRevisionId: string; actor: string }) {
        const expected = text(input.expectedRevisionId, 'Expected revision'), actor = text(input.actor, 'Actor'), book = await this.repository.getCodebook(id); if (!book) throw new AnalysisNotFound('Codebook not found');
        if (book.archivedAt) throw new AnalysisConflict('Codebook is already archived');
        return { codebook: await this.repository.setCodebookArchived(id, expected, { archivedAt: new Date().toISOString(), archivedBy: actor }) };
    }
    async restoreCodebook(id: string, input: { expectedRevisionId: string; actor: string }) {
        const expected = text(input.expectedRevisionId, 'Expected revision'); text(input.actor, 'Actor'); const book = await this.repository.getCodebook(id); if (!book) throw new AnalysisNotFound('Codebook not found');
        if (!book.archivedAt) throw new AnalysisConflict('Codebook is not archived');
        return { codebook: await this.repository.setCodebookArchived(id, expected, null) };
    }
    async reviseCodebook(id: string, input: { expectedRevisionId: string; name?: string; creator: string; definitions: BehaviorDefinition[]; note?: string }) {
        const book = await this.repository.getCodebook(id); if (!book) throw new AnalysisNotFound('Codebook not found');
        if (book.archivedAt) throw new AnalysisConflict('Codebook is archived; restore it before editing');
        const expected = text(input.expectedRevisionId, 'Expected revision'); if (book.currentRevisionId !== expected) throw new AnalysisConflict('Codebook revision changed');
        const prior = (await this.repository.getRevision(id, expected))!, now = new Date().toISOString(), revisionId = randomUUID(), definitions = validate(() => validateBehaviorDefinitions(input.definitions));
        if (prior.definitions.some(d => !definitions.some(next => next.id === d.id))) throw new AnalysisValidation('Archive existing codes instead of removing their identities');
        const revision: CodebookRevision = { id: revisionId, codebookId: id, revision: prior.revision + 1, definitions, createdAt: now, createdBy: text(input.creator, 'Creator'), ...(input.note ? { note: text(input.note, 'Note', 2000) } : {}) };
        const next = { ...book, name: input.name === undefined ? book.name : text(input.name, 'Name'), currentRevisionId: revisionId, updatedAt: now };
        await this.repository.saveCodebook(next, revision, expected); return { codebook: next, revision };
    }
    private async prepare(runId: string, input: PreviewInput) {
        const run = await this.source.getRun(runId); if (!run) throw new AnalysisNotFound('Source run not found');
        if (!isTerminalRun(run.status)) throw new AnalysisConflict('Analysis requires a terminal source run');
        const book = await this.repository.getCodebook(text(input.codebookId, 'Codebook ID')); if (!book) throw new AnalysisNotFound('Codebook not found');
        if (book.archivedAt) throw new AnalysisConflict('Codebook is archived; restore it before starting a new analysis');
        if (input.codebookRevisionId && input.codebookRevisionId !== book.currentRevisionId) throw new AnalysisConflict('Codebook changed since preview');
        const revision = (await this.repository.getRevision(book.id, book.currentRevisionId))!, settings = validate(() => resolveAnalysisConfiguration(input.settings)), events: HarnessEvent[] = []; let after = 0, bytes = 0;
        while (true) { const chunk = await this.source.listEvents(runId, after, 500); if (!chunk.length) break;
            if (chunk.some((e, i) => e.sequence <= (i ? chunk[i - 1]!.sequence : after))) throw new AnalysisConflict('Source evidence page is not strictly ordered');
            bytes += Buffer.byteLength(JSON.stringify(chunk)); if (bytes > 128 * 1024 * 1024) throw new AnalysisValidation('Source exceeds the 128 MiB preparation limit; export and narrow the source before analysis'); events.push(...chunk); after = chunk.at(-1)!.sequence; }
        const trace = normalizeTrace(run, events), selected = selectSteps(trace.steps, settings.selection), context = staticContextForRun(run), definitions = revision.definitions.filter(d => d.enabled && !d.archived);
        if (!definitions.length) throw new AnalysisValidation('Enable at least one code before analysis'); const questions = buildBehaviorQuestions(definitions);
        const windows = buildWindows(selected, settings.window).map(window => { const serialized = serializeWindow(window, selected, settings.evidence, context.text), budget = preflightQuestions(serialized.state, questions, settings.inputLimits); return { window, serialized, budget }; });
        const previewHash = snapshotHash({ source: trace.source, codebook: revision, settings, context, windows: windows.map(w => ({ window: w.window, hash: w.serialized.hash, budget: w.budget })) });
        const summary = { previewHash, runId, codebookId: book.id, codebookRevisionId: revision.id, settings, source: { ...trace.source, eventIds: undefined }, windowCount: windows.length, scoredCodeCount: definitions.length, expectedAnswers: windows.filter(w => w.serialized.hasEvidence).length * definitions.length, partialWindows: windows.filter(w => w.window.partial).length, evidenceAvailability: trace.availability, diagnostics: trace.diagnostics, incompleteRun: run.status !== 'completed', windows: windows.map(w => ({ ...w.window, eventIds: undefined, stepIds: undefined, bytes: w.serialized.bytes, estimatedTokens: w.serialized.estimatedTokens, hasEvidence: w.serialized.hasEvidence, budget: w.budget })) };
        return { run, trace, events, revision, settings, windows, context, previewHash, summary };
    }
    async preview(runId: string, input: PreviewInput) { return (await this.prepare(runId, input)).summary; }
    async previewWindow(runId: string, windowId: string, input: PreviewInput & { previewHash: string }) {
        const expected = text(input.previewHash, 'Preview hash'), p = await this.prepare(runId, input);
        if (expected !== p.previewHash) throw new AnalysisConflict('Source or codebook changed since preview; preview again before inspecting input');
        const w = p.windows.find(w => w.window.id === windowId); if (!w) throw new AnalysisNotFound('Preview window not found');
        const result = { window: w.window, input: w.serialized, budget: w.budget };
        if (Buffer.byteLength(JSON.stringify(result)) > 32 * 1024 * 1024) throw new AnalysisPayloadTooLarge('Exact preview window exceeds the 32 MiB response limit. Choose smaller windows or different evidence; evidence has not been truncated.');
        return result;
    }
    async launch(runId: string, input: LaunchInput): Promise<AnalysisJob> {
        const key = text(input.idempotencyKey, 'Idempotency key', 160), creator = text(input.creator, 'Creator'), previewHash = text(input.previewHash, 'Preview hash');
        const launchHash = snapshotHash({ runId, ...input, creator, idempotencyKey: key, settings: validate(() => resolveAnalysisConfiguration(input.settings)) });
        const id = 'analysis-' + snapshotHash({ runId, key, launchHash }).slice(0, 40), old = await this.repository.getJob(id);
        if (old) { if (old.launchHash !== launchHash) throw new AnalysisConflict('Idempotency key already used with different configuration'); if (old.ready) return old; }
        const p = await this.prepare(runId, input); if (p.previewHash !== previewHash) throw new AnalysisConflict('Source or codebook changed since preview; preview again before launch');
        if (input.parentAnalysisId) { const parent = await this.repository.getJob(input.parentAnalysisId); if (!parent || parent.runId !== runId) throw new AnalysisValidation('Parent analysis must belong to this source run'); }
        const now = new Date().toISOString(), sourceArtifact = id + ':source'; const { eventIds, ...source } = p.trace.source;
        const job: AnalysisJob = { id, runId, idempotencyKey: key, launchHash, createdAt: now, updatedAt: now, ready: true, cancelRequested: false, status: 'queued', fence: 0, counters: { ...emptyCounters(), preparedWindows: p.windows.length, expectedAnswers: p.summary.expectedAnswers },
            manifest: { version: 1, source, sourceArtifact, settings: p.settings, codebook: p.revision, settingsHash: snapshotHash({ settings: p.settings, codebook: p.revision }), staticContext: { version: p.context.version, hash: p.context.hash }, normalizerVersion: p.trace.version, serializationVersion: SERIALIZATION_VERSION, questionTemplateVersion: QUESTION_TEMPLATE_VERSION, providerAdapterVersion: JEV_ADAPTER_VERSION, sdkVersion: JEV_SDK_VERSION, diagnostics: p.trace.diagnostics, availability: p.trace.availability, creator, ...(input.parentAnalysisId ? { parentAnalysisId: input.parentAnalysisId } : {}) } };
        // Publish the queue record only after all immutable inputs exist. A crashed API can leave
        // orphan artifacts, but never a visible, unclaimable preparing job. Candidate IDs isolate
        // competing configurations while the unique launch key atomically selects one manifest.
        await this.repository.putArtifact(sourceArtifact, { source: p.trace.source, steps: p.trace.steps, contextEventIds: p.trace.contextEventIds, events: p.events, staticContext: p.context });
        for (const w of p.windows) { const inputRef = id + ':input:' + w.window.id; await this.repository.putArtifact(inputRef, { ...w.serialized, preflight: w.budget });
            const record: WindowRecord = { ...w.window, jobId: id, ordinal: w.window.index, inputRef, inputHash: w.serialized.hash, inputBytes: w.serialized.bytes, estimatedTokens: w.serialized.estimatedTokens, status: !w.serialized.hasEvidence ? 'skipped' : w.budget.oversized ? 'oversized' : 'pending', diagnostics: w.budget.diagnostics, batches: w.budget.batches.map(b => b.map(q => q.codeId)) }; await this.repository.putWindow(record); }
        return (await this.repository.reserveJob(job)).job;
    }
    async getJob(id: string) { const job = await this.repository.getJob(id); if (!job) throw new AnalysisNotFound('Analysis not found'); return job; }
    async getWindow(id: string, windowId: string) { await this.getJob(id); const window = await this.repository.getWindow(id, windowId); if (!window) throw new AnalysisNotFound('Window not found'); return { window, input: await this.repository.readArtifact<SerializedWindow>(window.inputRef), results: await this.repository.listResults(id, { windowId, limit: 100 }) }; }
    async cancel(id: string) { await this.getJob(id); return this.repository.cancel(id); }
    async retry(id: string) { await this.getJob(id); return this.repository.retry(id); }
    async *exportAnalysis(id: string): AsyncGenerator<{ type: string; data: unknown }> {
        const job = await this.getJob(id); yield { type: 'manifest', data: { exportVersion: 1, scope: 'analysis, immutable source and provider requests; review extensions follow when configured', job } };
        const artifacts = async function* (repository: AnalysisRepository, ref: string) { for await (const chunk of repository.artifactChunks(ref)) yield { type: 'artifact_chunk', data: { id: ref, ...chunk } }; };
        yield* artifacts(this.repository, job.manifest.sourceArtifact);
        for await (const w of pages(p => this.repository.listWindows(id, p))) { yield { type: 'window', data: w }; yield* artifacts(this.repository, w.inputRef); }
        for await (const r of pages(p => this.repository.listResults(id, p))) yield { type: 'result', data: r };
        for await (const a of pages(p => this.repository.listAttempts(id, p))) { yield { type: 'attempt', data: a }; yield* artifacts(this.repository, a.requestRef); if (a.responseRef) yield* artifacts(this.repository, a.responseRef); }
    }
}