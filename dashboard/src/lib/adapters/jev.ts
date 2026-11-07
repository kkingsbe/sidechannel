/** Explicit boundary between canonical Jev records and the dashboard's view models. */
import type {
    AnalysisConfiguration, Codebook as JevCodebook, CodebookRevision as JevRevision, EvidenceCategory as JevCategory, SerializedWindow,
} from '@sidechannel/contracts/browser';
import type { AnalysisJob as JevJob, AnalysisResult as JevResult, Page, WindowRecord } from '@sidechannel/contracts/browser';
import type { Review as JevReview, ReviewBatch as JevBatch } from '@sidechannel/contracts/browser';
import type { AnalysisJob, AnalysisPreview, AnalysisSettings, AnalysisWindow, Codebook, CodebookRevision, EvidenceCategory, HumanReview, ReviewBatch, ReviewSelection, WindowDetail } from '../analysis-types';
import type { Requester } from '../transport';

export interface PreviewContext { runId: string; body: Record<string, unknown> }

/** Bounded, provider-owned caches. Never module scope; insertion-ordered LRU. */
export interface JevSession {
    job(id: string): JevJob | undefined;
    rememberJob(job: JevJob): JevJob;
    review(id: string): JevReview | undefined;
    rememberReview(review: JevReview): JevReview;
    window(jobId: string, windowId: string): WindowRecord | undefined;
    rememberWindow(jobId: string, window: WindowRecord): void;
    preview(token: string): PreviewContext | undefined;
    rememberPreview(token: string, context: PreviewContext): void;
}

export function createJevSession(limit = 200): JevSession {
    const jobs = new Map<string, JevJob>(), reviews = new Map<string, JevReview>(), windows = new Map<string, WindowRecord>(), previews = new Map<string, PreviewContext>();
    const put = <T,>(map: Map<string, T>, key: string, value: T, max: number): T => {
        map.delete(key); map.set(key, value);
        while (map.size > max) map.delete(map.keys().next().value!);
        return value;
    };
    return {
        job: id => jobs.get(id),
        rememberJob: job => put(jobs, job.id, job, limit),
        review: id => reviews.get(id),
        rememberReview: review => put(reviews, review.id, review, limit),
        window: (jobId, windowId) => windows.get(JSON.stringify([jobId, windowId])),
        rememberWindow: (jobId, window) => { put(windows, JSON.stringify([jobId, window.id]), window, limit); },
        preview: token => previews.get(token),
        rememberPreview: (token, context) => { put(previews, token, context, 10); },
    };
}

const categoryGroups: Record<EvidenceCategory, JevCategory[]> = { assistant: ['assistantText'], tools: ['toolArguments', 'toolResults'], board: ['boardContent', 'boardDelivery'], artifacts: ['artifactChanges'], memory: ['privateMemory'], reasoning: ['providerReasoning'], reports: ['finalReports'] };

function revision(raw: JevRevision): CodebookRevision { return { id: raw.id, revision: raw.revision, createdAt: raw.createdAt, codebookId: raw.codebookId, codes: raw.definitions, author: raw.createdBy }; }
function book(raw: JevCodebook, current?: JevRevision): Codebook { return { ...raw, ...(current ? { revision: current.revision } : {}), archived: false }; }
function settings(raw: AnalysisConfiguration, codebook: JevRevision, creator = ''): AnalysisSettings { return { codebookId: codebook.codebookId, codebookRevisionId: codebook.id, model: raw.model, windowSize: raw.window.size, stride: raw.window.stride, phases: raw.selection.phases, startStep: raw.selection.startOrdinal, endStep: raw.selection.endOrdinal, evidence: (Object.keys(categoryGroups) as EvidenceCategory[]).filter(c => categoryGroups[c].some(k => raw.evidence[k])), headroom: raw.inputLimits.headroomTokens, timeoutMs: raw.timeoutMs, maxAttempts: raw.maxAttempts, creator, resolvedSettings: raw }; }
function canonicalSettings(view: AnalysisSettings): Partial<AnalysisConfiguration> { const base = view.resolvedSettings; return { ...base, version: 1, model: view.model, window: { size: view.windowSize, stride: view.stride }, selection: { phases: view.phases, ...(view.startStep !== undefined ? { startOrdinal: view.startStep } : {}), ...(view.endStep !== undefined ? { endOrdinal: view.endStep } : {}) }, evidence: Object.fromEntries(Object.entries(categoryGroups).flatMap(([category, fields]) => fields.map(field => [field, view.evidence.includes(category as EvidenceCategory) && (base && fields.some(key => base.evidence[key]) ? base.evidence[field] : true)]))) as AnalysisConfiguration['evidence'], inputLimits: { singleQuestionTokens: 32000, combinedQuestionTokens: 64000, maxBodyBytes: 33554432, estimatorVersion: 'utf8-bytes-conservative-v1', ...base?.inputLimits, headroomTokens: view.headroom }, timeoutMs: view.timeoutMs, maxAttempts: view.maxAttempts }; }
function availability(raw: Partial<Record<JevCategory, boolean>>) { return Object.fromEntries(Object.entries(categoryGroups).map(([category, fields]) => [category, fields.some(field => raw[field]) ? 1 : 0])) as Record<EvidenceCategory, number>; }
function job(raw: JevJob, session: JevSession): AnalysisJob { session.rememberJob(raw); return { id: raw.id, revision: 1, createdAt: raw.createdAt, runId: raw.runId, status: raw.status, cancelRequested: raw.cancelRequested, updatedAt: raw.updatedAt, error: raw.error, counters: { prepared: raw.counters.preparedWindows, submitted: raw.counters.submittedWindows, finished: raw.counters.finishedWindows, failed: raw.counters.failedWindows, skipped: raw.counters.skippedWindows, answers: raw.counters.returnedAnswers }, manifest: { schemaVersion: 1, runId: raw.runId, configHash: raw.manifest.source.configHash, sourceStatus: raw.manifest.source.status, sequenceBoundary: raw.manifest.source.sequenceBoundary, evidenceHash: raw.manifest.source.evidenceHash, normalizerVersion: raw.manifest.normalizerVersion, serializationVersion: raw.manifest.serializationVersion, questionTemplateVersion: raw.manifest.questionTemplateVersion, adapterVersion: raw.manifest.providerAdapterVersion, sdkVersion: raw.manifest.sdkVersion, codebook: revision(raw.manifest.codebook), settings: { ...settings(raw.manifest.settings, raw.manifest.codebook, raw.manifest.creator), parentAnalysisId: raw.manifest.parentAnalysisId }, settingsHash: raw.manifest.settingsHash, staticContext: { version: raw.manifest.staticContext.version }, staticContextHash: raw.manifest.staticContext.hash, diagnostics: raw.manifest.diagnostics.map(d => d.message), availability: availability(raw.manifest.availability), windowCount: raw.counters.preparedWindows, scoredCodeCount: raw.manifest.codebook.definitions.filter(d => d.enabled && !d.archived).length } }; }
function windowRecord(raw: WindowRecord & { results?: JevResult[] | Page<JevResult> }, session: JevSession, results?: JevResult[], input?: SerializedWindow): AnalysisWindow {
    session.rememberWindow(raw.jobId, raw);
    const sourceJob = session.job(raw.jobId);
    if (!sourceJob) throw new Error('Source analysis manifest unavailable');
    const limits = sourceJob.manifest.settings.inputLimits;
    const source = results ?? (Array.isArray(raw.results) ? raw.results : raw.results?.items) ?? [];
    return { id: raw.id, revision: 1, createdAt: sourceJob.createdAt, analysisId: raw.jobId, runId: sourceJob.runId, index: raw.index, stepIds: raw.stepIds, eventIds: raw.eventIds, startStep: raw.startOrdinal, endStep: raw.endOrdinal, partial: raw.partial, incomplete: raw.incomplete, empty: input ? !input.hasEvidence : raw.status === 'skipped', state: input?.state ?? '', inputHash: raw.inputHash, status: raw.status === 'running' ? 'pending' : raw.status, error: raw.diagnostics?.join('; ') || undefined, budget: { bytes: raw.inputBytes, estimatedTokens: raw.estimatedTokens, estimatorVersion: input?.estimatorVersion ?? limits.estimatorVersion, perQuestionLimit: limits.singleQuestionTokens, perRequestLimit: limits.combinedQuestionTokens, headroom: limits.headroomTokens, oversized: raw.status === 'oversized', batches: raw.batches ?? [] }, results: source.map(r => ({ ...r, revision: 1, analysisId: r.jobId })) };
}
function review(row: JevReview, session: JevSession, windowId?: string): HumanReview { session.rememberReview(row); const containing = windowId ? session.window(row.analysisId, windowId) : undefined; return { ...row, runId: session.job(row.analysisId)?.runId ?? '', windowId: row.scope === 'window' ? row.subjectId : containing?.eventIds.includes(row.subjectId) ? containing.id : undefined, definitionRevisionId: row.definitionRevision }; }
function batch(raw: JevBatch): ReviewBatch { return { ...raw, revision: 1, creator: '', randomCount: raw.randomSize, populationCount: raw.populationSize, selectionCount: raw.selectedCount, codebookRevisionId: raw.definitionRevision }; }

const ROUTE = /^\/(codebooks(\/[^/]+(\/revisions(\/[^/]+)?)?)?|analyses(\/[^/]+(\/windows(\/[^/]+)?|\/reviews(\/[^/]+)?|\/review-batches(\/[^/]+)?|\/(cancel|retry))?)?|runs\/[^/]+\/analyses(\/preview)?)$/;

/** Pure: dashboard path → canonical Jev path. `undefined` means "not a Jev route". */
export function translate(path: string, init?: RequestInit): { path: string; init?: RequestInit } | undefined {
    const url = new URL(path, 'http://local');
    return ROUTE.test(url.pathname) ? { path: '/jev' + path, init } : undefined;
}

async function ensureJob(read: (path: string) => Promise<unknown>, session: JevSession, id: string): Promise<JevJob> {
    const cached = session.job(id);
    if (cached) return cached;
    return session.rememberJob(await read('/jev/analyses/' + encodeURIComponent(id)) as JevJob);
}

/** Maps one already-fetched canonical payload to the dashboard view model for `path`. */
export async function decodeJev<T>(path: string, init: RequestInit | undefined, payload: unknown, session: JevSession,
    read: (path: string) => Promise<unknown>, readJob: (id: string) => Promise<JevJob>): Promise<T | undefined> {
    const url = new URL(path, 'http://local');
    const p = url.pathname, method = (init?.method ?? 'GET').toUpperCase();
    const body: Record<string, any> = init?.body ? JSON.parse(String(init.body)) as Record<string, any> : {};
    let value: unknown;
    if (p === '/codebooks' && method === 'GET') { const page = payload as Page<JevCodebook>; value = { ...page, items: page.items.map(raw => book(raw)) }; }
    else if (p === '/codebooks' && method === 'POST') { const raw = payload as { codebook: JevCodebook; revision: JevRevision }; value = { codebook: book(raw.codebook, raw.revision), revision: revision(raw.revision) }; }
    else if (/^\/codebooks\/[^/]+\/revisions$/.test(p) && method === 'GET') { const page = payload as Page<JevRevision>; value = { ...page, items: page.items.map(revision) }; }
    else if (/^\/codebooks\/[^/]+\/revisions\/[^/]+$/.test(p) && method === 'GET') { value = revision(payload as JevRevision); }
    else if (/^\/codebooks\/[^/]+$/.test(p) && method === 'GET') {
        const raw = payload as JevCodebook;
        const current = await read(`/jev${p}/revisions/${encodeURIComponent(raw.currentRevisionId)}`) as JevRevision;
        value = { codebook: book(raw, current), revision: revision(current) };
    }
    else if (/^\/codebooks\/[^/]+$/.test(p) && method === 'PATCH') { const raw = payload as { codebook: JevCodebook; revision: JevRevision }; value = { codebook: book(raw.codebook, raw.revision), revision: revision(raw.revision) }; }
    else if (p === '/analyses' && method === 'GET') { const page = payload as Page<JevJob>; value = { ...page, items: page.items.map(raw => job(raw, session)) }; }
    else if (/^\/runs\/[^/]+\/analyses$/.test(p) && method === 'GET') { const page = payload as Page<JevJob>; value = { ...page, items: page.items.map(raw => job(raw, session)) }; }
    else if (/^\/runs\/[^/]+\/analyses\/preview$/.test(p) && method === 'POST') {
        const raw = payload as any;
        session.rememberPreview(raw.previewHash, { runId: p.split('/')[2]!, body });
        value = { previewToken: raw.previewHash, manifest: { schemaVersion: 1, runId: raw.runId, ...(raw.selectedStepCount !== undefined ? { selectedStepCount: raw.selectedStepCount } : {}), windowCount: raw.windowCount, scoredCodeCount: raw.scoredCodeCount, partialWindowCount: raw.partialWindows, availability: availability(raw.evidenceAvailability), diagnostics: raw.diagnostics.map((d: any) => d.message) }, windows: raw.windows.map((w: any) => { const budget = w.budget.budget; return { id: w.id, index: w.index, startStep: w.startOrdinal, endStep: w.endOrdinal, partial: w.partial, incomplete: w.incomplete, empty: !w.hasEvidence, budget: { bytes: w.bytes, estimatedTokens: w.estimatedTokens, estimatorVersion: budget.estimatorVersion, perQuestionLimit: budget.effectiveLimits.singleQuestionTokens, perRequestLimit: budget.effectiveLimits.combinedQuestionTokens, headroom: budget.effectiveLimits.headroomTokens, oversized: w.budget.oversized, reason: budget.reason || w.budget.diagnostics.join('; ') || undefined, batches: w.budget.batches.map((batch: any[]) => batch.map(q => q.codeId)) } }; }) };
    }
    else if (/^\/runs\/[^/]+\/analyses$/.test(p) && method === 'POST') { value = job(payload as JevJob, session); }
    else if (/^\/analyses\/[^/]+$/.test(p) && method === 'GET') { value = job(payload as JevJob, session); }
    else if (/^\/analyses\/[^/]+\/windows$/.test(p) && method === 'GET') {
        await ensureJob(read, session, decodeURIComponent(p.split('/')[2]!));
        const raw = payload as Page<WindowRecord & { results?: JevResult[] }>;
        value = { ...raw, items: raw.items.map(w => windowRecord(w, session)) };
    }
    else if (/^\/analyses\/[^/]+\/windows\/[^/]+$/.test(p) && method === 'GET') {
        await ensureJob(read, session, decodeURIComponent(p.split('/')[2]!));
        const raw = payload as { window: WindowRecord; input: SerializedWindow; results: Page<JevResult> };
        value = { window: windowRecord(raw.window, session, raw.results.items, raw.input), sourceEventIds: raw.window.eventIds } satisfies WindowDetail;
    }
    else if (/^\/analyses\/[^/]+\/(cancel|retry)$/.test(p) && method === 'POST') { value = job(payload as JevJob, session); }
    else if (/^\/analyses\/[^/]+\/reviews$/.test(p) && (method === 'GET' || method === 'POST')) {
        const id = decodeURIComponent(p.split('/')[2]!);
        await ensureJob(read, session, id);
        if (method === 'GET') { const raw = payload as Page<JevReview>; value = { ...raw, items: raw.items.map(r => review(r, session, url.searchParams.get('windowId') ?? undefined)) }; }
        else { value = review(payload as JevReview, session, body.windowId); }
    }
    else if (/^\/analyses\/[^/]+\/review-batches$/.test(p)) {
        if (method === 'GET') { const raw = payload as Page<JevBatch>; value = { ...raw, items: raw.items.map(batch) }; }
        else value = batch(payload as JevBatch);
    }
    else if (/^\/analyses\/[^/]+\/review-batches\/[^/]+$/.test(p)) {
        const raw = payload as { batch: JevBatch; items: { windowId: string; reasons?: string[] }[]; nextCursor: string | null };
        value = { batch: batch(raw.batch), selections: { items: raw.items.map(s => ({ ...s, id: s.windowId })), nextCursor: raw.nextCursor } };
    }
    return value as T | undefined;
}

/** Composes translation, transport and decoding over one injected requester and one session. */
export function createJevRequester(base: Requester, session: JevSession = createJevSession()): Requester {
    const read = (path: string, init?: RequestInit) => base<unknown>(path, init);
    const readJob = async (id: string) => await read('/jev/analyses/' + encodeURIComponent(id)) as JevJob;
    return async <T,>(path: string, init?: RequestInit): Promise<T> => {
        const translated = translate(path, init);
        if (!translated) return base<T>(path, init);
        const payload = await base<unknown>(translated.path, translated.init);
        const decoded = await decodeJev<T>(path, init, payload, session, read, readJob);
        return (decoded === undefined ? payload : decoded) as T;
    };
}

/** View-model → canonical request body, shared by the analyses client and the preview form. */
export const canonical = canonicalSettings;

/** Reads the canonical job record for a review/launch body, remembering it in the session. */
export async function jobFor(request: Requester, session: JevSession, id: string): Promise<JevJob> {
    const cached = session.job(id);
    if (cached) return cached;
    return session.rememberJob(await request<JevJob>('/jev/analyses/' + encodeURIComponent(id)));
}
