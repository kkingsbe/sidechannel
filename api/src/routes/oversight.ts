import { ZodError } from 'zod';
import type { Repository } from '@sidechannel/contracts/harness/server';
import type { ResearchStore } from '@sidechannel/contracts/analysis/store';
import type { MonitorDefinition, MonitorEvaluation } from '@sidechannel/contracts/oversight/contracts';
import { cancelMonitor, createMonitorPreview, currentDefinition, getMonitorPreview, launchMonitor, OversightError, saveDefinition } from '@sidechannel/domain/oversight/service';
import { exportRunOutcomeReviews, latestRunOutcomeReview, runOutcomeAgreements, runReviewContext, saveRunOutcomeReview } from '@sidechannel/domain/oversight/reviews';
import type { RunOutcomeReview } from '@sidechannel/contracts/oversight/reviews';
import { compareMonitorEvaluation } from '@sidechannel/domain/oversight/comparison';

interface Request { method: string; path: string; query: URLSearchParams; body: unknown; }

function limit(query: URLSearchParams) {
    const value = Number(query.get('limit') ?? 50);
    if (!Number.isSafeInteger(value) || value < 1 || value > 200) throw new OversightError(400, 'limit must be an integer from 1 to 200');
    return value;
}

export function createOversightHandler(repository: Repository, store: ResearchStore) {
    return async ({ method, path, query, body }: Request): Promise<{ status: number; data: unknown } | null> => {
        const runReviewRoute = path.match(/^\/runs\/([^/]+)\/(reviews(?:\/(?:context|latest|export))?|outcomes)$/);
        if (!path.startsWith('/monitor') && !runReviewRoute) return null;
        try {
            if (runReviewRoute) {
                const runId = decodeURIComponent(runReviewRoute[1]!), operation = runReviewRoute[2]!;
                if (operation === 'reviews/context' && method === 'GET') return { status: 200, data: await runReviewContext(repository, store, runId, query.get('definitionRevisionId') ?? undefined) };
                if (operation === 'reviews/export' && method === 'GET') return { status: 200, data: await exportRunOutcomeReviews(repository, store, runId, query.get('definitionRevisionId') ?? undefined) };
                if (operation === 'reviews/latest' && method === 'GET') {
                    const reviewer = query.get('reviewer'), outcomeId = query.get('outcomeId'), definitionRevisionId = query.get('definitionRevisionId');
                    if (!reviewer || !outcomeId || !definitionRevisionId) throw new OversightError(400, 'reviewer, outcomeId and definitionRevisionId are required');
                    return { status: 200, data: await latestRunOutcomeReview(repository, store, runId, { reviewer, outcomeId, definitionRevisionId }) };
                }
                if (operation === 'outcomes' && method === 'GET') return { status: 200, data: await runOutcomeAgreements(repository, store, runId) };
                if (operation === 'reviews' && method === 'POST') return { status: 201, data: await saveRunOutcomeReview(repository, store, runId, body) };
                if (operation === 'reviews' && method === 'GET') {
                    await runReviewContext(repository, store, runId);
                    const filter: Record<string, unknown> = { runId };
                    for (const key of ['outcomeId', 'definitionRevisionId'] as const) if (query.has(key)) filter[key] = query.get(key);
                    return { status: 200, data: await store.page<RunOutcomeReview>('run_outcome_reviews', filter, query.get('after') ?? '', limit(query)) };
                }
                throw new OversightError(405, 'Method not allowed');
            }
            if (path === '/monitor-definitions' && method === 'GET') return { status: 200, data: await currentDefinition(store) };
            if (path === '/monitor-definitions' && method === 'POST') return { status: 201, data: await saveDefinition(store, body) };
            if (path === '/monitor-definitions/history' && method === 'GET') {
                await currentDefinition(store);
                return { status: 200, data: await store.page<MonitorDefinition>('monitor_definitions', {}, query.get('after') ?? '', limit(query)) };
            }
            if (path === '/monitor/preview' && method === 'POST') return { status: 201, data: await createMonitorPreview(repository, store, body) };
            if (path === '/monitor-evaluations' && method === 'GET') return { status: 200, data: await store.page<MonitorEvaluation>('monitor_evaluations', {}, query.get('after') ?? '', limit(query)) };
            if (path === '/monitor-evaluations' && method === 'POST') return { status: 202, data: await launchMonitor(repository, store, body) };
            const match = path.match(/^\/monitor-evaluations\/([^/]+)(?:\/(export|cancel|comparison))?$/);
            if (match) {
                const id = decodeURIComponent(match[1]!);
                if (match[2] === 'cancel' && method === 'POST') return { status: 202, data: await cancelMonitor(store, id) };
                if (method !== 'GET') throw new OversightError(405, 'Method not allowed');
                const evaluation = await store.get<MonitorEvaluation>('monitor_evaluations', id);
                if (!evaluation) throw new OversightError(404, 'Monitor evaluation not found');
                if (match[2] === 'comparison') {
                    const references = await Promise.all(evaluation.runIds.map(async runId => ({ runId, agreements: await runOutcomeAgreements(repository, store, runId) })));
                    return { status: 200, data: { evaluationId: evaluation.id, definitionRevisionId: evaluation.definition.id,
                        comparisons: compareMonitorEvaluation(evaluation, references) } };
                }
                if (match[2] === 'export') return { status: 200, data: { schemaVersion: 1, scope: 'monitor evaluation, frozen definitions, exact evidence projections and results; source runs and human reviews are separate datasets',
                    exportedAt: new Date().toISOString(), evaluation, preview: await getMonitorPreview(store, evaluation.previewId) } };
                return { status: 200, data: evaluation };
            }
            return { status: 404, data: { error: 'Monitor route not found' } };
        } catch (error) {
            if (error instanceof OversightError) return { status: error.status, data: { error: error.message } };
            if (error instanceof ZodError) return { status: 400, data: { error: 'Invalid monitor configuration', issues: error.issues } };
            throw error;
        }
    };
}