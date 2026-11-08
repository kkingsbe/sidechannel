import type { AnalysisSummary, Comparison, ComparisonRequest, Page, ThresholdPolicy } from '../analysis-types';
import type { Requester } from '../transport';
import { withQuery } from '../transport';

/**
 * Summary and comparison endpoints (v2 spec sections 8 and 10). Paths carry the `/jev` prefix themselves, so the
 * Jev request adapter passes them through untouched. The threshold policy travels as JSON in `?policy=`.
 */
export const aggregationPaths = {
    summary: (id: string, policy: ThresholdPolicy, k?: number) => withQuery('/jev/analyses/' + encodeURIComponent(id) + '/summary', { policy: JSON.stringify(policy), k }),
    comparisons: (query: { runId?: string; limit?: number; after?: string } = {}) => withQuery('/jev/comparisons', query),
    comparison: (id: string) => '/jev/comparisons/' + encodeURIComponent(id),
};

export interface AggregationClient {
    summary(id: string, policy: ThresholdPolicy, k?: number): Promise<AnalysisSummary>;
    createComparison(input: ComparisonRequest): Promise<Comparison>;
    comparison(id: string): Promise<Comparison>;
    comparisons(query?: { runId?: string; limit?: number; after?: string }): Promise<Page<Comparison>>;
}

export function createAggregationClient(request: Requester): AggregationClient {
    return {
        summary: (id, policy, k) => request(aggregationPaths.summary(id, policy, k)),
        createComparison: input => request(aggregationPaths.comparisons(), { method: 'POST', body: JSON.stringify(input) }),
        comparison: id => request(aggregationPaths.comparison(id)),
        comparisons: query => request(aggregationPaths.comparisons(query)),
    };
}
