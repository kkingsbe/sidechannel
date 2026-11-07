import type { Repository } from '../harness/server.js';
import type { Run } from '../harness/contracts.js';
import type { Draft, DraftMetadata, EventQuery, EvidenceKind, EvidencePage, RunQuery, RunSummary, TurnSummary } from '../harness/repository.js';

export interface ResearcherRepository extends Repository {
    saveDraft(id: string, config: unknown, expectedRevision?: number, metadata?: DraftMetadata): Promise<Draft>;
    listDrafts(): Promise<Draft[]>;
    getDraft(id: string): Promise<Draft | null>;
    requestCancel(id: string): Promise<Run | null>;
    createPair(runs: Run[]): Promise<Run[]>;
    queryRuns(query: RunQuery): Promise<{ items: RunSummary[]; total: number }>;
    queryEvents(id: string, query: EventQuery): ReturnType<Repository['listEvents']>;
    getEvent(runId: string, eventId: string): Promise<Awaited<ReturnType<Repository['listEvents']>>[number] | null>;
    listTurns(runId: string): Promise<TurnSummary[]>;
    /** Calls `onAppend` after an event is appended to `runId`; returns an unsubscribe function. A wake-up hint only: callers must still poll. */
    subscribeEvents?(runId: string, onAppend: () => void): () => void;
    getRunSummary(id: string): Promise<RunSummary | null>;
    getRunByLaunchKey(launchKey: string): Promise<Run | null>;
    getEvidencePage(id: string, kind: EvidenceKind, offset: number, limit: number): Promise<EvidencePage>;
    getEvidenceItem(id: string, kind: EvidenceKind, key: string): Promise<unknown | null>;
    workerStatus(): Promise<unknown>;
}

export interface ResearchRouteRequest { method: string; path: string; query: URLSearchParams; body: Record<string, unknown> }

export interface ResearchRouteResult { status: number; data: unknown; headers?: Record<string, string> }

export type ResearchRouteHandler = (request: ResearchRouteRequest) => Promise<ResearchRouteResult | null>;