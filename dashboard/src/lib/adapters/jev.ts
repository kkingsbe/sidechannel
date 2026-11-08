/** Explicit boundary between canonical Jev records and the dashboard's view models. */
import type {
    AnalysisConfiguration, Codebook as JevCodebook, CodebookRevision as JevRevision, CodebookWarning, EvidenceCategory as JevCategory, SerializedWindow,
} from '@sidechannel/contracts/browser';
import type { AnalysisJob as JevJob, AnalysisResult as JevResult, Page, WindowRecord } from '@sidechannel/contracts/browser';
import type { Review as JevReview, ReviewBatch as JevBatch } from '@sidechannel/contracts/browser';
import type { AnalysisJob, AnalysisSettings, AnalysisWindow, Codebook, CodebookRevision, EvidenceCategory, HumanReview, ReviewBatch, ReviewSelection, WindowDetail } from '../analysis-types';
import type { Requester } from '../transport';
import { NEW_ANALYSIS_INPUT_LIMITS } from './defaults';

export interface PreviewContext { runId: string; body: Record<string, unknown> }

/** Bounded, provider-owned caches. Never module scope; insertion-ordered LRU. */
export interface JevSession {
    job(id: string): JevJob | undefined;
    rememberJob(job: JevJob): JevJob;
    window(jobId: string, windowId: string): WindowRecord | undefined;
    rememberWindow(jobId: string, window: WindowRecord): void;
    preview(token: string): PreviewContext | undefined;
    rememberPreview(token: string, context: PreviewContext): void;
}

export function createJevSession(limit = 200): JevSession {
    const jobs = new Map<string, JevJob>(), windows = new Map<string, WindowRecord>(), previews = new Map<string, PreviewContext>();
    const put = <T,>(map: Map<string, T>, key: string, value: T, max: number): T => {
        map.delete(key); map.set(key, value);
        while (map.size > max) map.delete(map.keys().next().value!);
        return value;
    };
    return {
        job: id => jobs.get(id),
        rememberJob: job => put(jobs, job.id, job, limit),
        window: (jobId, windowId) => windows.get(JSON.stringify([jobId, windowId])),
        rememberWindow: (jobId, window) => { put(windows, JSON.stringify([jobId, window.id]), window, limit); },
        preview: token => previews.get(token),
        rememberPreview: (token, context) => { put(previews, token, context, 10); },
    };
}

const categoryGroups: Record<EvidenceCategory, JevCategory[]> = { assistant: ['assistantText'], tools: ['toolArguments', 'toolResults'], board: ['boardContent', 'boardDelivery'], artifacts: ['artifactChanges'], memory: ['privateMemory'], reasoning: ['providerReasoning'], reports: ['finalReports'] };

export function toRevision(raw: JevRevision): CodebookRevision {
    return { id: raw.id, revision: raw.revision, createdAt: raw.createdAt, codebookId: raw.codebookId, codes: raw.definitions, author: raw.createdBy };
}

/** A saved codebook + revision, carrying the save's non-blocking validation warnings through to the studio. */
function pair(raw: { codebook: JevCodebook; revision: JevRevision; warnings?: CodebookWarning[] }) {
    return { codebook: toCodebook(raw.codebook, raw.revision), revision: toRevision(raw.revision), warnings: raw.warnings ?? [] };
}

/** The server has no codebook-level `archived` flag; the view model must not invent one. */
export function toCodebook(raw: JevCodebook, current?: JevRevision): Codebook {
    const archived = raw as { archivedAt?: string; archivedBy?: string };
    return {
        id: raw.id, createdAt: raw.createdAt, name: raw.name, currentRevisionId: raw.currentRevisionId,
        ...(current ? { revision: current.revision } : {}),
        ...(archived.archivedAt ? { archivedAt: archived.archivedAt, archivedBy: archived.archivedBy } : {}),
    };
}

export function toSettings(raw: AnalysisConfiguration, revision: JevRevision, creator: string, parentAnalysisId?: string): AnalysisSettings {
    return {
        codebookId: revision.codebookId, codebookRevisionId: revision.id,
        model: raw.model, windowSize: raw.window.size, stride: raw.window.stride,
        phases: raw.selection.phases,
        ...(raw.selection.startOrdinal !== undefined ? { startStep: raw.selection.startOrdinal } : {}),
        ...(raw.selection.endOrdinal !== undefined ? { endStep: raw.selection.endOrdinal } : {}),
        evidence: (Object.keys(categoryGroups) as EvidenceCategory[]).filter(category => categoryGroups[category].some(key => raw.evidence[key])),
        headroom: raw.inputLimits.headroomTokens, timeoutMs: raw.timeoutMs, maxAttempts: raw.maxAttempts, creator,
        ...(parentAnalysisId ? { parentAnalysisId } : {}),
        /** Frozen server settings, captured so a duplicate re-submits exactly what was frozen. */
        frozen: { evidence: raw.evidence, inputLimits: raw.inputLimits, concurrency: raw.concurrency, retryBaseMs: raw.retryBaseMs, longContext: raw.longContext },
    };
}

/**
 * Only the fields the form can edit are overridden; everything else is the frozen server value.
 * A brand-new analysis (no frozen settings) uses the documented client defaults.
 */
export function toCanonicalSettings(view: AnalysisSettings): Partial<AnalysisConfiguration> {
    const base = view.frozen;
    return {
        version: 1, model: view.model,
        window: { size: view.windowSize, stride: view.stride },
        selection: {
            phases: view.phases,
            ...(view.startStep !== undefined ? { startOrdinal: view.startStep } : {}),
            ...(view.endStep !== undefined ? { endOrdinal: view.endStep } : {}),
        },
        evidence: Object.fromEntries(Object.entries(categoryGroups).flatMap(([category, fields]) => fields.map(field => {
            const enabled = view.evidence.includes(category as EvidenceCategory);
            return [field, enabled && (base && fields.some(key => base.evidence[key]) ? base.evidence[field] : true)];
        }))) as AnalysisConfiguration['evidence'],
        inputLimits: { ...(base?.inputLimits ?? NEW_ANALYSIS_INPUT_LIMITS), headroomTokens: view.headroom },
        timeoutMs: view.timeoutMs, maxAttempts: view.maxAttempts,
        ...(base ? { concurrency: base.concurrency, retryBaseMs: base.retryBaseMs, longContext: base.longContext } : {}),
        ...v2Settings(view),
    } as Partial<AnalysisConfiguration>;
}

export function toJob(raw: JevJob): AnalysisJob {
    return {
        id: raw.id, createdAt: raw.createdAt, runId: raw.runId, status: raw.status,
        cancelRequested: raw.cancelRequested, updatedAt: raw.updatedAt,
        ...(raw.reliability ? { reliability: raw.reliability } : {}),
        ...(raw.error !== undefined ? { error: raw.error } : {}),
        counters: { prepared: raw.counters.preparedWindows, submitted: raw.counters.submittedWindows, finished: raw.counters.finishedWindows, failed: raw.counters.failedWindows, skipped: raw.counters.skippedWindows, answers: raw.counters.returnedAnswers },
        manifest: {
            schemaVersion: 1, runId: raw.runId, configHash: raw.manifest.source.configHash, sourceStatus: raw.manifest.source.status,
            sequenceBoundary: raw.manifest.source.sequenceBoundary, evidenceHash: raw.manifest.source.evidenceHash,
            normalizerVersion: raw.manifest.normalizerVersion, serializationVersion: raw.manifest.serializationVersion,
            questionTemplateVersion: raw.manifest.questionTemplateVersion, adapterVersion: raw.manifest.providerAdapterVersion,
            sdkVersion: raw.manifest.sdkVersion, codebook: toRevision(raw.manifest.codebook),
            settings: toSettings(raw.manifest.settings, raw.manifest.codebook, raw.manifest.creator, raw.manifest.parentAnalysisId),
            settingsHash: raw.manifest.settingsHash, staticContext: { version: raw.manifest.staticContext.version },
            staticContextHash: raw.manifest.staticContext.hash,
            diagnostics: raw.manifest.diagnostics.map(d => d.message),
            availability: availability(raw.manifest.availability),
            windowCount: raw.counters.preparedWindows,
            scoredCodeCount: raw.manifest.codebook.definitions.filter(d => d.enabled && !d.archived).length,
        },
    };
}

/** The job is an explicit parameter: no cache read may decide correctness of a window. */
export function toWindow(raw: WindowRecord & { results?: JevResult[] | Page<JevResult> }, job: JevJob, input?: SerializedWindow, results?: JevResult[]): AnalysisWindow {
    const limits = job.manifest.settings.inputLimits;
    const source = results ?? (Array.isArray(raw.results) ? raw.results : raw.results?.items) ?? [];
    return {
        id: raw.id, createdAt: job.createdAt, analysisId: raw.jobId, runId: job.runId,
        index: raw.index, stepIds: raw.stepIds, eventIds: raw.eventIds,
        startStep: raw.startOrdinal, endStep: raw.endOrdinal, partial: raw.partial, incomplete: raw.incomplete,
        empty: input ? !input.hasEvidence : raw.status === 'skipped', state: input?.state ?? '',
        inputHash: raw.inputHash, status: raw.status === 'running' ? 'pending' : raw.status,
        ...(raw.diagnostics?.length ? { error: raw.diagnostics.join('; ') } : {}),
        budget: {
            bytes: raw.inputBytes, estimatedTokens: raw.estimatedTokens,
            estimatorVersion: input?.estimatorVersion ?? limits.estimatorVersion,
            perQuestionLimit: limits.singleQuestionTokens, perRequestLimit: limits.combinedQuestionTokens,
            headroom: limits.headroomTokens, oversized: raw.status === 'oversized', batches: raw.batches ?? [],
        },
        results: source.map(result => ({ ...result, analysisId: result.jobId })),
    };
}

/** Window membership is a property of the review subject, not of cached navigation history. */
export function toReview(raw: JevReview, runId: string): HumanReview {
    return { ...raw, scope: raw.scope as HumanReview['scope'], runId, windowId: raw.scope === 'window' ? raw.subjectId : undefined, definitionRevisionId: raw.definitionRevision };
}

export function toBatch(raw: JevBatch): ReviewBatch {
    return {
        id: raw.id, createdAt: raw.createdAt, analysisId: raw.analysisId, mode: raw.mode,
        ...(raw.threshold !== undefined ? { threshold: raw.threshold } : {}),
        populationCount: raw.populationSize, selectionCount: raw.selectedCount, codebookRevisionId: raw.definitionRevision,
        ...(raw.strategy ? { strategy: raw.strategy } : {}), ...(raw.shortfalls ? { shortfalls: raw.shortfalls } : {}),
    };
}

function availability(raw: Partial<Record<JevCategory, boolean>>) { return Object.fromEntries(Object.entries(categoryGroups).map(([category, fields]) => [category, fields.some(field => raw[field]) ? 1 : 0])) as Record<EvidenceCategory, number>; }

const ROUTE = /^\/(codebooks(\/[^/]+(\/revisions(\/[^/]+)?|\/seed-v2)?)?|analyses(\/[^/]+(\/windows(\/[^/]+)?|\/reviews(\/[^/]+)?|\/review-batches(\/[^/]+)?|\/(cancel|retry))?)?|runs\/[^/]+\/analyses(\/preview)?)$/;

/** Pure: dashboard path → canonical Jev path. `undefined` means "not a Jev route". */
export function translate(path: string, init?: RequestInit): { path: string; init?: RequestInit } | undefined {
    const url = new URL(path, 'http://local');
    return ROUTE.test(url.pathname) ? { path: '/jev' + path, init } : undefined;
}

/** Reads the canonical job record for a review/launch body, remembering it in the session. */
export async function jobFor(request: Requester, session: JevSession, id: string): Promise<JevJob> {
    const cached = session.job(id);
    if (cached) return cached;
    return session.rememberJob(await request<JevJob>('/jev/analyses/' + encodeURIComponent(id)));
}

async function ensureJob(read: (path: string) => Promise<unknown>, session: JevSession, id: string): Promise<JevJob> {
    const cached = session.job(id);
    if (cached) return cached;
    return session.rememberJob(await read('/jev/analyses/' + encodeURIComponent(id)) as JevJob);
}

/** Maps one already-fetched canonical payload to the dashboard view model for `path`. */
export async function decodeJev<T>(path: string, init: RequestInit | undefined, payload: unknown, session: JevSession,
    read: (path: string) => Promise<unknown>): Promise<T | undefined> {
    const url = new URL(path, 'http://local');
    const p = url.pathname, method = (init?.method ?? 'GET').toUpperCase();
    const body: Record<string, any> = init?.body ? JSON.parse(String(init.body)) as Record<string, any> : {};
    let value: unknown;
    if (p === '/codebooks' && method === 'GET') { const page = payload as Page<JevCodebook>; value = { ...page, items: page.items.map(raw => toCodebook(raw)) }; }
    else if (p === '/codebooks' && method === 'POST') { value = pair(payload as { codebook: JevCodebook; revision: JevRevision; warnings?: CodebookWarning[] }); }
    else if (/^\/codebooks\/[^/]+\/revisions$/.test(p) && method === 'GET') { const page = payload as Page<JevRevision>; value = { ...page, items: page.items.map(toRevision) }; }
    else if (/^\/codebooks\/[^/]+\/revisions\/[^/]+$/.test(p) && method === 'GET') { value = toRevision(payload as JevRevision); }
    else if (p === '/codebooks/seed-v2' && method === 'GET') { value = payload; }
    else if (/^\/codebooks\/[^/]+\/seed-v2$/.test(p) && method === 'POST') { value = pair(payload as { codebook: JevCodebook; revision: JevRevision; warnings?: CodebookWarning[] }); }
    else if (/^\/codebooks\/[^/]+$/.test(p) && method === 'GET') {
        const raw = payload as JevCodebook;
        const current = await read(`/jev${p}/revisions/${encodeURIComponent(raw.currentRevisionId)}`) as JevRevision;
        value = { codebook: toCodebook(raw, current), revision: toRevision(current) };
    }
    else if (/^\/codebooks\/[^/]+$/.test(p) && method === 'PATCH') { value = pair(payload as { codebook: JevCodebook; revision: JevRevision; warnings?: CodebookWarning[] }); }
    else if (p === '/analyses' && method === 'GET') { const page = payload as Page<JevJob>; value = { ...page, items: page.items.map(raw => { session.rememberJob(raw); return toJob(raw); }) }; }
    else if (/^\/runs\/[^/]+\/analyses$/.test(p) && method === 'GET') { const page = payload as Page<JevJob>; value = { ...page, items: page.items.map(raw => { session.rememberJob(raw); return toJob(raw); }) }; }
    else if (/^\/runs\/[^/]+\/analyses\/preview$/.test(p) && method === 'POST') {
        const raw = payload as any;
        session.rememberPreview(raw.previewHash, { runId: p.split('/')[2]!, body });
        value = { previewToken: raw.previewHash, manifest: { schemaVersion: 1, runId: raw.runId, ...(raw.selectedStepCount !== undefined ? { selectedStepCount: raw.selectedStepCount } : {}), windowCount: raw.windowCount, scoredCodeCount: raw.scoredCodeCount, partialWindowCount: raw.partialWindows, availability: availability(raw.evidenceAvailability), diagnostics: raw.diagnostics.map((d: any) => d.message) }, windows: raw.windows.map((w: any) => { const budget = w.budget.budget; return { id: w.id, index: w.index, startStep: w.startOrdinal, endStep: w.endOrdinal, partial: w.partial, incomplete: w.incomplete, empty: !w.hasEvidence, budget: { bytes: w.bytes, estimatedTokens: w.estimatedTokens, estimatorVersion: budget.estimatorVersion, perQuestionLimit: budget.effectiveLimits.singleQuestionTokens, perRequestLimit: budget.effectiveLimits.combinedQuestionTokens, headroom: budget.effectiveLimits.headroomTokens, oversized: w.budget.oversized, reason: budget.reason || w.budget.diagnostics.join('; ') || undefined, batches: w.budget.batches.map((batch: any[]) => batch.map(q => q.codeId)) } }; }),
            ...(raw.background ? { v2: { preset: raw.preset, longContext: raw.longContext, suggestedWindowSize: raw.suggestedWindowSize, groups: raw.background.groups, conditionExcluded: raw.background.conditionExcluded, conditionQuotedWindows: raw.background.conditionQuotedWindows, probe: raw.probe } } : {}) };
    }
    else if (/^\/runs\/[^/]+\/analyses$/.test(p) && method === 'POST') { session.rememberJob(payload as JevJob); value = toJob(payload as JevJob); }
    else if (/^\/analyses\/[^/]+$/.test(p) && method === 'GET') { session.rememberJob(payload as JevJob); value = toJob(payload as JevJob); }
    else if (/^\/analyses\/[^/]+\/windows$/.test(p) && method === 'GET') {
        const sourceJob = await ensureJob(read, session, decodeURIComponent(p.split('/')[2]!));
        const raw = payload as Page<WindowRecord & { results?: JevResult[] }>;
        value = { ...raw, items: raw.items.map(w => toWindow(w, sourceJob)) };
    }
    else if (/^\/analyses\/[^/]+\/windows\/[^/]+$/.test(p) && method === 'GET') {
        const sourceJob = await ensureJob(read, session, decodeURIComponent(p.split('/')[2]!));
        const raw = payload as { window: WindowRecord; input: SerializedWindow; results: Page<JevResult> };
        session.rememberWindow(raw.window.jobId, raw.window);
        value = { window: toWindow(raw.window, sourceJob, raw.input, raw.results.items), sourceEventIds: raw.window.eventIds } satisfies WindowDetail;
    }
    else if (/^\/analyses\/[^/]+\/(cancel|retry)$/.test(p) && method === 'POST') { session.rememberJob(payload as JevJob); value = toJob(payload as JevJob); }
    else if (/^\/analyses\/[^/]+\/reviews$/.test(p) && (method === 'GET' || method === 'POST')) {
        const id = decodeURIComponent(p.split('/')[2]!);
        const sourceJob = await ensureJob(read, session, id);
        if (method === 'GET') { const raw = payload as Page<JevReview>; value = { ...raw, items: raw.items.map(r => toReview(r, sourceJob.runId)) }; }
        else { value = toReview(payload as JevReview, sourceJob.runId); }
    }
    else if (/^\/analyses\/[^/]+\/review-batches$/.test(p)) {
        if (method === 'GET') { const raw = payload as Page<JevBatch>; value = { ...raw, items: raw.items.map(toBatch) }; }
        else value = toBatch(payload as JevBatch);
    }
    else if (/^\/analyses\/[^/]+\/review-batches\/[^/]+$/.test(p)) {
        const raw = payload as { batch: JevBatch; items: { windowId: string; reasons?: string[] }[]; nextCursor: string | null };
        value = { batch: toBatch(raw.batch), selections: { items: raw.items.map(s => ({ id: s.windowId, windowId: s.windowId, reasons: s.reasons })), nextCursor: raw.nextCursor } satisfies Page<ReviewSelection> };
    }
    return value as T | undefined;
}

/** Composes translation, transport and decoding over one injected requester and one session. */
export function createJevRequester(base: Requester, session: JevSession = createJevSession()): Requester {
    const read = (path: string) => base<unknown>(path);
    return async <T,>(path: string, init?: RequestInit): Promise<T> => {
        const translated = translate(path, init);
        if (!translated) return base<T>(path, init);
        const payload = await base<unknown>(translated.path, translated.init);
        const decoded = await decodeJev<T>(path, init, payload, session, read);
        return (decoded === undefined ? payload : decoded) as T;
    };
}

/** Shared canonical request-body conversion for the analyses client and the preview form. */
export const canonical = toCanonicalSettings;

/** Documented long-context ceiling for both question limits (mirrors the domain's resolver). */
const LONG_CONTEXT_TOKENS = 262_000;

/** The v2 setup choices (preset, probe, long context) as canonical settings; nothing is sent for a v1-style draft. */
function v2Settings(view: AnalysisSettings): Record<string, unknown> {
    return {
        ...(view.preset ? { preset: view.preset } : {}),
        ...(view.probe !== undefined ? { probe: view.probe } : {}),
        ...(view.longContext !== undefined ? {
            longContext: view.longContext,
            ...(view.longContext ? { inputLimits: { ...(view.frozen?.inputLimits ?? NEW_ANALYSIS_INPUT_LIMITS), headroomTokens: view.headroom, singleQuestionTokens: LONG_CONTEXT_TOKENS, combinedQuestionTokens: LONG_CONTEXT_TOKENS } } : {}),
        } : {}),
    };
}
