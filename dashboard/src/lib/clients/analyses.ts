import type { AnalysisJob, AnalysisPreview, AnalysisSettings, AnalysisWindow, HumanReview, Page, ReviewBatch, ReviewSelection, WindowDetail, WindowReviewInput } from '../analysis-types';
import { canonical, jobFor, type JevSession } from '../adapters/jev';
import type { Requester } from '../transport';
import { withQuery } from '../transport';
import { createAggregationClient, type AggregationClient } from './aggregation';

export const analysisPaths = {
    list: (query: { limit?: number; after?: string } = {}) => withQuery('/analyses', query),
    job: (id: string) => '/analyses/' + encodeURIComponent(id),
    windows: (id: string, query: { limit?: number; after?: string } = {}) => withQuery('/analyses/' + encodeURIComponent(id) + '/windows', { withResults: 'true', limit: query.limit, after: query.after }),
    window: (id: string, windowId: string) => '/analyses/' + encodeURIComponent(id) + '/windows/' + encodeURIComponent(windowId),
    runJobs: (runId: string, query: { limit?: number; after?: string } = {}) => withQuery('/runs/' + encodeURIComponent(runId) + '/analyses', query),
    preview: (runId: string) => '/runs/' + encodeURIComponent(runId) + '/analyses/preview',
    launch: (runId: string) => '/runs/' + encodeURIComponent(runId) + '/analyses',
    cancel: (id: string) => '/analyses/' + encodeURIComponent(id) + '/cancel',
    retry: (id: string) => '/analyses/' + encodeURIComponent(id) + '/retry',
    reviews: (id: string, query: Record<string, string | number | undefined>) => withQuery('/analyses/' + encodeURIComponent(id) + '/reviews', query),
    review: (id: string) => '/analyses/' + encodeURIComponent(id) + '/reviews',
    batches: (id: string) => '/analyses/' + encodeURIComponent(id) + '/review-batches',
    batch: (id: string, batchId: string, query: Record<string, string | number | undefined>) => withQuery('/analyses/' + encodeURIComponent(id) + '/review-batches/' + encodeURIComponent(batchId), query),
};

export interface AnalysesClient extends AggregationClient {
    paths: typeof analysisPaths;
    list(query?: { limit?: number; after?: string }): Promise<Page<AnalysisJob>>;
    job(id: string): Promise<AnalysisJob>;
    windows(id: string, query?: { limit?: number; after?: string }): Promise<Page<AnalysisWindow>>;
    window(id: string, windowId: string): Promise<WindowDetail>;
    runJobs(runId: string, query?: { limit?: number; after?: string }): Promise<Page<AnalysisJob>>;
    preview(runId: string, settings: AnalysisSettings): Promise<AnalysisPreview>;
    previewWindow(token: string, windowId: string): Promise<{ state: string }>;
    launch(runId: string, settings: AnalysisSettings & { idempotencyKey?: string }, previewToken: string): Promise<AnalysisJob>;
    cancel(id: string): Promise<AnalysisJob>;
    retry(id: string): Promise<AnalysisJob>;
    reviews(id: string, query: Record<string, string | number | undefined>): Promise<Page<HumanReview>>;
    saveReview(id: string, input: WindowReviewInput): Promise<HumanReview>;
    batches(id: string): Promise<Page<ReviewBatch>>;
    batch(id: string, batchId: string, query: Record<string, string | number | undefined>): Promise<{ batch: ReviewBatch; selections: Page<ReviewSelection> }>;
    createBatch(id: string, input: unknown): Promise<ReviewBatch>;
    exportUrl(id: string): string;
    datasetExportUrl(id: string, dataset: string, limit?: number): string;
}

export function createAnalysesClient(request: Requester, session: JevSession): AnalysesClient {
    const post = <T,>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });
    const payloadFor = (settings: AnalysisSettings) => ({ codebookId: settings.codebookId, codebookRevisionId: settings.codebookRevisionId, settings: canonical(settings) });
    return {
        paths: analysisPaths,
        ...createAggregationClient(request),
        list: query => request(analysisPaths.list(query)),
        job: id => request(analysisPaths.job(id)),
        windows: (id, query) => request(analysisPaths.windows(id, query)),
        window: (id, windowId) => request(analysisPaths.window(id, windowId)),
        runJobs: (runId, query) => request(analysisPaths.runJobs(runId, query)),
        preview: (runId, settings) => post(analysisPaths.preview(runId), payloadFor(settings)),
        previewWindow: async (token, windowId) => {
            const preview = session.preview(token);
            if (!preview) throw new Error('Preview settings expired in this browser. Prepare a fresh preview.');
            const raw = await post<{ input: { state: string } }>(`/jev/runs/${preview.runId}/analyses/preview/windows/${windowId}`, { ...preview.body, previewHash: token });
            return { state: raw.input.state };
        },
        launch: (runId, settings, previewToken) => post(analysisPaths.launch(runId), {
            ...payloadFor(settings), previewHash: previewToken,
            idempotencyKey: settings.idempotencyKey ?? previewToken,
            creator: settings.creator, parentAnalysisId: settings.parentAnalysisId,
        }),
        cancel: id => post(analysisPaths.cancel(id), {}),
        retry: id => post(analysisPaths.retry(id), {}),
        reviews: (id, query) => request(analysisPaths.reviews(id, query)),
        saveReview: async (id, input) => {
            const source = await jobFor(request, session, id);
            const subjectId = input.scope === 'event' ? input.eventIds[0] : input.windowId;
            return post(analysisPaths.review(id), {
                scope: input.scope, subjectId, codeId: input.codeId,
                definitionRevision: source.manifest.codebook.id, evidenceRevision: source.manifest.source.evidenceHash,
                reviewer: input.reviewer, decision: input.decision, rationale: input.rationale,
                eventIds: input.eventIds, stepIds: input.stepIds, predictionsVisible: input.predictionsVisible,
                expectedRevision: input.supersedes?.revision ?? 0,
            });
        },
        batches: id => request(analysisPaths.batches(id)),
        batch: (id, batchId, query) => request(analysisPaths.batch(id, batchId, query)),
        createBatch: (id, input) => post(analysisPaths.batches(id), input),
        exportUrl: id => '/api/jev/analyses/' + encodeURIComponent(id) + '/export',
        datasetExportUrl: (id, dataset, limit = 100) => `/api/analyses/${encodeURIComponent(id)}/export?dataset=${encodeURIComponent(dataset)}&limit=${limit}`,
    };
}
