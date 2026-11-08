import { AnalysisValidation, type PageOptions } from '@sidechannel/contracts/analysis/jev-repository';
import type { ComparisonRequest, ThresholdPolicy } from '@sidechannel/contracts/analysis/aggregation';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { parseThresholdPolicy } from '@sidechannel/domain/analysis/aggregation';
import type { AnalysisAggregationService } from '@sidechannel/domain/analysis/aggregation-service';

/**
 * Threshold policy in a query string, in either of two encodings (`?policy=` absent means fixed 0.7 / 0.3):
 *
 * - JSON: `policy={"kind":"control-percentile","percentile":0.95,"controlAnalysisIds":["a","b"]}`
 * - Named parameters:
 *     `policy=fixed&yes=0.7&no=0.3`
 *     `policy=control-percentile&percentile=0.95&control=a,b[&no=0.3]` (`control` may repeat or be comma separated)
 *     `policy=validated[&yes=0.7&no=0.3]` (the pair is the marked fallback for codes without validated thresholds)
 */
export function policyFromQuery(query: URLSearchParams): ThresholdPolicy {
    const raw = query.get('policy');
    if (raw === null) return parseThresholdPolicy(undefined);
    if (raw.trim().startsWith('{')) { try { return parseThresholdPolicy(JSON.parse(raw)); } catch (error) { if (error instanceof AnalysisValidation) throw error; throw new AnalysisValidation('policy is not valid JSON'); } }
    const number = (name: string) => { const v = query.get(name); if (v === null) return undefined; const n = Number(v); if (v.trim() === '' || !Number.isFinite(n)) throw new AnalysisValidation(`${name} must be a number`); return n; };
    if (raw === 'fixed') return parseThresholdPolicy({ kind: 'fixed', yes: number('yes') ?? 0.7, no: number('no') ?? 0.3 });
    if (raw === 'validated') return parseThresholdPolicy({ kind: 'validated', fallback: { yes: number('yes') ?? 0.7, no: number('no') ?? 0.3 } });
    if (raw === 'control-percentile') return parseThresholdPolicy({ kind: 'control-percentile', percentile: number('percentile'), controlAnalysisIds: query.getAll('control').flatMap(v => v.split(',')).map(v => v.trim()).filter(Boolean), no: number('no') });
    throw new AnalysisValidation('policy must be fixed, control-percentile, validated or a JSON object');
}

function page(query: URLSearchParams): PageOptions {
    const v = query.get('limit'), limit = v === null ? 100 : Number(v);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new AnalysisValidation('Limit must be an integer from 1 to 500');
    return { limit, ...(query.get('after') ? { after: query.get('after')! } : {}) };
}

function decode(value: string): string {
    try { const id = decodeURIComponent(value); if (!id || id.length > 200) throw new Error(); return id; }
    catch { throw new AnalysisValidation('Invalid encoded resource ID'); }
}

/**
 * Run summaries and condition comparisons (v2 spec sections 8 and 10), served under `/jev`. Register ahead of the main Jev
 * extension: that extension answers every unmatched `/jev/` path with 404.
 *
 *   GET  /jev/analyses/:id/summary?policy=...&k=3
 *   POST /jev/comparisons            body: ComparisonRequest
 *   GET  /jev/comparisons/:id
 *   GET  /jev/comparisons?runId=&limit=&after=
 */
export function createAggregationRouteHandler(service: AnalysisAggregationService): ResearchRouteHandler {
    return async request => {
        const { method, path, query } = request;
        const summary = path.match(/^\/jev\/analyses\/([^/]+)\/summary$/);
        if (summary && method === 'GET') {
            const k = query.get('k');
            return { status: 200, data: await service.summary(decode(summary[1]!), policyFromQuery(query), k === null ? undefined : Number(k)) };
        }
        if (path === '/jev/comparisons') {
            if (method === 'POST') return { status: 201, data: await service.createComparison(await request.body() as unknown as ComparisonRequest) };
            if (method === 'GET') return { status: 200, data: await service.listComparisons(query.get('runId') ?? undefined, page(query)) };
        }
        const comparison = path.match(/^\/jev\/comparisons\/([^/]+)$/);
        if (comparison && method === 'GET') return { status: 200, data: await service.getComparison(decode(comparison[1]!)) };
        return null;
    };
}
