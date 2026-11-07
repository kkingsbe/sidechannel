import type { MonitorComparison, RunOutcomeAgreement, RunOutcomeReview, RunReviewContext } from '../types';
import type { MonitorDefinition, MonitorEvaluation, MonitorPreview, MonitorSettings } from '@sidechannel/contracts/browser';
import type { Requester } from '../transport';
import { withQuery } from '../transport';

export const monitorPaths = {
    definition: () => '/monitor-definitions',
    history: (query: { limit?: number; after?: string } = {}) => withQuery('/monitor-definitions/history', query),
    evaluations: (query: { limit?: number; after?: string } = {}) => withQuery('/monitor-evaluations', query),
    evaluation: (id: string) => '/monitor-evaluations/' + encodeURIComponent(id),
    comparison: (id: string) => '/monitor-evaluations/' + encodeURIComponent(id) + '/comparison',
    preview: () => '/monitor/preview',
    launch: () => '/monitor-evaluations',
    cancel: (id: string) => '/monitor-evaluations/' + encodeURIComponent(id) + '/cancel',
    exportEnvelope: (id: string) => '/monitor-evaluations/' + encodeURIComponent(id) + '/export',
};

export interface MonitorClient {
    paths: typeof monitorPaths;
    definition(): Promise<MonitorDefinition>;
    history(query?: { limit?: number; after?: string }): Promise<{ items: MonitorDefinition[]; nextCursor: string | null }>;
    saveDefinition(input: MonitorDefinition & { expectedRevision?: number }): Promise<MonitorDefinition>;
    preview(input: MonitorSettings & { runIds: string[]; definitionRevision: number }): Promise<MonitorPreview>;
    evaluations(query?: { limit?: number; after?: string }): Promise<{ items: MonitorEvaluation[]; nextCursor: string | null }>;
    launch(input: { previewId: string; previewHash: string; idempotencyKey: string }): Promise<MonitorEvaluation>;
    evaluation(id: string): Promise<MonitorEvaluation>;
    comparison(id: string): Promise<MonitorComparison>;
    exportEnvelope(id: string): Promise<{ evaluation: MonitorEvaluation; preview: MonitorPreview }>;
    exportUrl(id: string): string;
    cancel(id: string): Promise<MonitorEvaluation>;
}

export function createMonitorClient(request: Requester): MonitorClient {
    const post = <T,>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });
    return {
        paths: monitorPaths,
        definition: () => request(monitorPaths.definition()),
        history: query => request(monitorPaths.history(query)),
        saveDefinition: input => post(monitorPaths.definition(), input),
        preview: input => post(monitorPaths.preview(), input),
        evaluations: query => request(monitorPaths.evaluations(query)),
        launch: input => post(monitorPaths.launch(), input),
        evaluation: id => request(monitorPaths.evaluation(id)),
        comparison: id => request(monitorPaths.comparison(id)),
        exportEnvelope: id => request(monitorPaths.exportEnvelope(id)),
        exportUrl: id => '/api/monitor-evaluations/' + encodeURIComponent(id) + '/export',
        cancel: id => post(monitorPaths.cancel(id), {}),
    };
}

/** Run-level outcome reviews are not Jev: they keep their own resource client. */
export interface ReviewsClient {
    paths: typeof reviewPaths;
    list(runId: string, query?: { limit?: number; after?: string }): Promise<{ items: RunOutcomeReview[]; nextCursor: string | null }>;
    context(runId: string, definitionRevisionId?: string): Promise<RunReviewContext>;
    latest(runId: string, query: { reviewer: string; outcomeId: string; definitionRevisionId: string }): Promise<RunOutcomeReview | null>;
    outcomes(runId: string): Promise<RunOutcomeAgreement[]>;
    save(runId: string, input: Record<string, unknown>): Promise<RunOutcomeReview>;
    exportUrl(runId: string, definitionRevisionId: string): string;
}

export const reviewPaths = {
    list: (runId: string, query: { limit?: number; after?: string } = {}) => withQuery('/runs/' + encodeURIComponent(runId) + '/reviews', query),
    context: (runId: string, definitionRevisionId?: string) => withQuery('/runs/' + encodeURIComponent(runId) + '/reviews/context', { definitionRevisionId }),
    latest: (runId: string, query: { reviewer: string; outcomeId: string; definitionRevisionId: string }) => withQuery('/runs/' + encodeURIComponent(runId) + '/reviews/latest', query),
    outcomes: (runId: string) => '/runs/' + encodeURIComponent(runId) + '/outcomes',
    save: (runId: string) => '/runs/' + encodeURIComponent(runId) + '/reviews',
    exportUrl: (runId: string, definitionRevisionId: string) => `/api/runs/${encodeURIComponent(runId)}/reviews/export?definitionRevisionId=${encodeURIComponent(definitionRevisionId)}`,
};

export function createReviewsClient(request: Requester): ReviewsClient {
    return {
        paths: reviewPaths,
        list: (runId, query) => request(reviewPaths.list(runId, query)),
        context: (runId, definitionRevisionId) => request(reviewPaths.context(runId, definitionRevisionId)),
        latest: (runId, query) => request(reviewPaths.latest(runId, query)),
        outcomes: runId => request(reviewPaths.outcomes(runId)),
        save: (runId, input) => request(reviewPaths.save(runId), { method: 'POST', body: JSON.stringify(input) }),
        exportUrl: (runId, definitionRevisionId) => reviewPaths.exportUrl(runId, definitionRevisionId),
    };
}
