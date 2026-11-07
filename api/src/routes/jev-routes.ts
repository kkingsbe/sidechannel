import type { BehaviorDefinition } from '@sidechannel/contracts/analysis/evidence-contracts';
import { AnalysisNotFound, AnalysisValidation, type PageOptions } from '@sidechannel/contracts/analysis/jev-repository';
import { AnalysisService } from '@sidechannel/domain/analysis/jev-service';
import type { LaunchInput, PreviewInput } from '@sidechannel/contracts/analysis/jev-service';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';

function page(query: URLSearchParams): PageOptions {
    const v = query.get('limit'), limit = v === null ? 100 : Number(v);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new AnalysisValidation('Limit must be an integer from 1 to 500');
    return { limit, ...(query.get('after') ? { after: query.get('after')! } : {}) };
}

function decode(value: string): string {
    try { const id = decodeURIComponent(value); if (!id || id.length > 200) throw new Error(); return id; }
    catch { throw new AnalysisValidation('Invalid encoded resource ID'); }
}

/** Composes with the researcher API's authentication, origin checks and single error boundary. */
export function createAnalysisRouteHandler(service: AnalysisService): ResearchRouteHandler {
    return async request => {
        const { method, path, query } = request, repo = service.repository, json = () => request.body();
        if (path === '/analyses' && method === 'GET') return { status: 200, data: await repo.listAllJobs(page(query)) };
        if (path === '/codebooks') {
            if (method === 'GET') return { status: 200, data: await repo.listCodebooks(page(query)) };
            if (method === 'POST') return { status: 201, data: await service.createCodebook(await json() as unknown as { name: string; creator: string; definitions: BehaviorDefinition[] }) };
        }
        const revisions = path.match(/^\/codebooks\/([^/]+)\/revisions$/);
        if (revisions && method === 'GET') { const id = decode(revisions[1]!); if (!await repo.getCodebook(id)) throw new AnalysisNotFound('Codebook not found'); return { status: 200, data: await repo.listRevisions(id, page(query)) }; }
        const codebook = path.match(/^\/codebooks\/([^/]+)(?:\/revisions\/([^/]+))?$/);
        if (codebook) {
            const id = decode(codebook[1]!);
            if (method === 'GET') { const found = codebook[2] ? await repo.getRevision(id, decode(codebook[2])) : await repo.getCodebook(id); if (!found) throw new AnalysisNotFound('Codebook or revision not found'); return { status: 200, data: found }; }
            if (method === 'PATCH' && !codebook[2]) return { status: 200, data: await service.reviseCodebook(id, await json() as unknown as Parameters<AnalysisService['reviseCodebook']>[1]) };
        }
        const preview = path.match(/^\/runs\/([^/]+)\/analyses\/preview\/windows\/([^/]+)$/);
        if (preview && method === 'POST') return { status: 200, data: await service.previewWindow(decode(preview[1]!), decode(preview[2]!), await json() as unknown as PreviewInput & { previewHash: string }) };
        const run = path.match(/^\/runs\/([^/]+)\/analyses(?:\/(preview))?$/);
        if (run) {
            const id = decode(run[1]!);
            if (method === 'GET' && !run[2]) return { status: 200, data: await repo.listJobs(id, page(query)) };
            if (method === 'POST') { const input = await json(); return run[2] ? { status: 200, data: await service.preview(id, input as unknown as PreviewInput) } : { status: 202, data: await service.launch(id, input as unknown as LaunchInput) }; }
        }
        const job = path.match(/^\/analyses\/([^/]+)(?:\/(windows|results|attempts|cancel|retry|export)(?:\/([^/]+))?)?$/);
        if (!job) return null; const id = decode(job[1]!), op = job[2]; if (job[3] && op !== 'windows') return null;
        await service.getJob(id);
        if (method === 'GET' && !op) return { status: 200, data: await service.getJob(id) };
        if (method === 'GET' && op === 'windows') {
            if (job[3]) return { status: 200, data: await service.getWindow(id, decode(job[3])) };
            const withResults = query.get('withResults'); if (withResults !== null && withResults !== 'true' && withResults !== 'false') throw new AnalysisValidation('withResults must be true or false');
            const windows = await repo.listWindows(id, page(query)); if (withResults !== 'true') return { status: 200, data: windows };
            const results = await repo.resultsForWindows(id, windows.items.map(w => w.id));
            return { status: 200, data: { ...windows, items: windows.items.map(w => ({ ...w, results: results.filter(r => r.windowId === w.id) })) } };
        }
        if (method === 'GET' && op === 'results') return { status: 200, data: await repo.listResults(id, { ...page(query), ...(query.get('windowId') ? { windowId: query.get('windowId')! } : {}) }) };
        if (method === 'GET' && op === 'attempts') return { status: 200, data: await repo.listAttempts(id, page(query)) };
        if (method === 'POST' && op === 'cancel') return { status: 202, data: await service.cancel(id) };
        if (method === 'POST' && op === 'retry') return { status: 202, data: await service.retry(id) };
        if (method === 'GET' && op === 'export') return { status: 200, headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Content-Disposition': `attachment; filename="${id.replace(/[^a-zA-Z0-9_-]/g, '')}.ndjson"` }, data: service.exportAnalysis(id) };
        return null;
    };
}
