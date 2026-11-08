import type { BoardMessage, HarnessEvent, Run } from '@sidechannel/contracts/browser';
import type { Requester } from '../transport';
import { withQuery } from '../transport';
import type { Draft } from '../types';
import type { RunProgress } from '../contracts';
import type { ArtifactPage, BoardPage, EvidencePages, ReportPage, RunTab } from '../contracts';

/** Dashboard-owned evidence envelopes (typed per tab in T5.4). */
export interface RecordPage<T> {
    items: T[];
    total?: number;
    nextOffset?: number | null;
    posts?: T[];
    deliveries?: HarnessEvent[];
    reporting?: { instructions: string; schemaVersion: string };
    deliveriesMayHaveMore?: boolean;
    nextDeliveryCursor?: number;
}
export interface Page<T> { items: T[]; nextCursor: string | null }

export type EvidenceKind = 'board' | 'artifacts' | 'reports';
export interface RunEventQuery { limit?: number; after?: string; actor?: string; phase?: string; type?: string; from?: string | number; to?: string | number }
export type ArchivedFilter = 'include' | 'only';

/** What one run did in a bulk archive, unarchive or delete request. */
export interface RunLifecycleResult { id: string; ok: boolean; status?: number; error?: string; dependents?: { analyses: string[]; monitorEvaluations: string[]; outcomeReviews: number; runReviews: number } }
export interface RunLifecycleBatch { action: 'archive' | 'unarchive' | 'delete'; results: RunLifecycleResult[]; succeeded: number; failed: number }

export interface RunListQuery { archived?: ArchivedFilter; status?: string; model?: string; condition?: string; scenario?: string; designation?: string; summary?: boolean; limit?: number; offset?: number }
export interface EvidenceQuery { limit: number; offset: number }

export const runPaths = {
    list: (query: RunListQuery = {}) => withQuery('/runs', { archived: query.archived, summary: query.summary === undefined ? undefined : String(query.summary), status: query.status, model: query.model, condition: query.condition, scenario: query.scenario, designation: query.designation, limit: query.limit, offset: query.offset }),
    get: (id: string) => '/runs/' + encodeURIComponent(id),
    progress: (id: string) => '/runs/' + encodeURIComponent(id) + '/progress',
    events: (id: string, query: RunEventQuery = {}) => withQuery('/runs/' + encodeURIComponent(id) + '/events', { limit: query.limit, after: query.after, actor: query.actor, phase: query.phase, type: query.type, from: query.from, to: query.to }),
    event: (id: string, eventId: string) => '/runs/' + encodeURIComponent(id) + '/events/' + encodeURIComponent(eventId),
    evidence: (id: string, kind: EvidenceKind, page: EvidenceQuery) => withQuery('/runs/' + encodeURIComponent(id) + '/' + kind, { limit: page.limit, offset: page.offset }),
    evidenceItem: (id: string, kind: EvidenceKind, key: string) => '/runs/' + encodeURIComponent(id) + '/' + kind + '/' + encodeURIComponent(key),
    board: (id: string, page: EvidenceQuery) => withQuery('/runs/' + encodeURIComponent(id) + '/board', { limit: page.limit, offset: page.offset }),
    pair: (id: string) => '/pairs/' + encodeURIComponent(id),
    evaluation: (id: string) => '/runs/' + encodeURIComponent(id) + '/evaluation',
};

export interface RunsClient {
    paths: typeof runPaths;
    list(query?: RunListQuery): Promise<RecordPage<Run>>;
    get(id: string): Promise<Run>;
    progress(id: string): Promise<RunProgress>;
    events(id: string, query?: RunEventQuery): Promise<Page<HarnessEvent>>;
    event(id: string, eventId: string): Promise<HarnessEvent>;
    evidence(id: string, kind: EvidenceKind, query: EvidenceQuery): Promise<RecordPage<unknown>>;
    /** Typed evidence envelope for one registry tab (`board`/`artifacts`/`memory`/`reports`). */
    evidenceTab(id: string, tab: Exclude<RunTab, 'timeline' | 'traces'>, query: EvidenceQuery): Promise<EvidencePages[RunTab]>;
    evidenceItem(id: string, kind: EvidenceKind, key: string): Promise<unknown>;
    board(id: string, query: EvidenceQuery): Promise<RecordPage<BoardMessage>>;
    exportUrl(id: string): string;
    cancel(id: string): Promise<Run>;
    /** Hides a terminal run from default lists; the launchKey stays bound to it. */
    archive(id: string): Promise<unknown>;
    unarchive(id: string): Promise<unknown>;
    /** Permanent. Resolves only for a confirmed request; the API refuses active runs and runs cited by analyses, reviews or evaluations. */
    remove(id: string): Promise<unknown>;
    bulk(action: RunLifecycleBatch['action'], ids: string[]): Promise<RunLifecycleBatch>;
    duplicate(id: string): Promise<Draft>;
    pair(id: string): Promise<unknown>;
    evaluation(id: string): Promise<unknown>;
    createPair(input: unknown): Promise<Run[]>;
}

export function createRunsClient(request: Requester): RunsClient {
    const post = <T,>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });
    return {
        paths: runPaths,
        list: query => request(runPaths.list(query)),
        get: id => request(runPaths.get(id)),
        progress: id => request(runPaths.progress(id)),
        events: async (id, query) => {
            const payload = await request<{ events?: HarnessEvent[]; items?: HarnessEvent[]; nextCursor: number; hasMore?: boolean }>(runPaths.events(id, query));
            const rows = payload.events ?? payload.items ?? [];
            const hasMore = payload.hasMore ?? rows.length === (query?.limit ?? 200);
            return { items: rows, nextCursor: hasMore ? String(payload.nextCursor) : null };
        },
        event: (id, eventId) => request(runPaths.event(id, eventId)),
        evidence: async (id, kind, query) => await request<RecordPage<unknown>>(runPaths.evidence(id, kind, query)),
        evidenceTab: async (id, tab, query) => {
            const path = tab === 'memory'
                ? withQuery('/runs/' + encodeURIComponent(id) + '/memory', { limit: query.limit, offset: query.offset })
                : runPaths.evidence(id, tab, query);
            const payload = await request<RecordPage<unknown>>(path);
            if (tab === 'memory') return { items: (payload.items ?? []) as never, nextOffset: payload.nextOffset ?? null };
            if (tab === 'board') return { ...payload, items: payload.items ?? [], total: payload.total ?? 0, nextOffset: payload.nextOffset ?? null } as BoardPage;
            const page = { ...payload, items: payload.items ?? [], total: payload.total ?? 0, nextOffset: payload.nextOffset ?? null };
            return (tab === 'artifacts' ? page as ArtifactPage : page as ReportPage);
        },
        evidenceItem: (id, kind, key) => request(runPaths.evidenceItem(id, kind, key)),
        board: async (id, query) => await request<RecordPage<BoardMessage>>(runPaths.board(id, query)),
        exportUrl: id => '/api/runs/' + encodeURIComponent(id) + '/export',
        cancel: id => post(runPaths.get(id) + '/cancel', {}),
        archive: id => post(runPaths.get(id) + '/archive', {}),
        unarchive: id => post(runPaths.get(id) + '/unarchive', {}),
        remove: id => request(runPaths.get(id), { method: 'DELETE', body: JSON.stringify({ confirm: true }) }),
        bulk: (action, ids) => post('/runs/bulk', { action, ids, ...(action === 'delete' ? { confirm: true } : {}) }),
        duplicate: id => post(runPaths.get(id) + '/duplicate', {}),
        pair: id => request(runPaths.pair(id)),
        evaluation: id => request(runPaths.evaluation(id)),
        createPair: input => post('/pairs', input),
    };
}
