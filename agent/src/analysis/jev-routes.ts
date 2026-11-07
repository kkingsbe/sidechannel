import type { IncomingMessage } from 'node:http';
import type { BehaviorDefinition } from './evidence-contracts.js';
import { AnalysisNotFound, AnalysisPayloadTooLarge, AnalysisValidation, type PageOptions } from './jev-repository.js';
import { AnalysisService, type LaunchInput, type PreviewInput } from './jev-service.js';
export interface AnalysisRouteResponse { status: number; body: unknown; headers?: Record<string, string>; }
async function body(req: IncomingMessage): Promise<Record<string, unknown>> { const chunks: Buffer[] = []; let bytes = 0; for await (const value of req) { const chunk = Buffer.from(value); bytes += chunk.length; if (bytes > 2_000_000) throw new AnalysisPayloadTooLarge('Request body exceeds 2 MB'); chunks.push(chunk); } try { const v: unknown = JSON.parse(Buffer.concat(chunks).toString()); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(); return v as Record<string, unknown>; } catch { throw new AnalysisValidation('Expected a JSON object'); } }
function page(url: URL): PageOptions { const v = url.searchParams.get('limit'), limit = v === null ? 100 : Number(v); if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new AnalysisValidation('Limit must be an integer from 1 to 500'); return { limit, ...(url.searchParams.get('after') ? { after: url.searchParams.get('after')! } : {}) }; }
function decode(value: string): string { try { const id = decodeURIComponent(value); if (!id || id.length > 200) throw new Error(); return id; } catch { throw new AnalysisValidation('Invalid encoded resource ID'); } }
/** Composes with the researcher API's authentication, origin checks and error boundary. */
export function createAnalysisRouteHandler(service: AnalysisService) {
    return async (req: IncomingMessage, url: URL): Promise<AnalysisRouteResponse | null> => {
        const path = url.pathname, method = req.method, repo = service.repository;
        if (path === '/api/analyses' && method === 'GET') return { status: 200, body: await repo.listAllJobs(page(url)) };
        if (path === '/api/codebooks') {
            if (method === 'GET') return { status: 200, body: await repo.listCodebooks(page(url)) };
            if (method === 'POST') { const b = await body(req); return { status: 201, body: await service.createCodebook(b as unknown as { name: string; creator: string; definitions: BehaviorDefinition[] }) }; }
        }
        const revisions = path.match(/^\/api\/codebooks\/([^/]+)\/revisions$/);
        if (revisions && method === 'GET') { const id = decode(revisions[1]!); if (!await repo.getCodebook(id)) throw new AnalysisNotFound('Codebook not found'); return { status: 200, body: await repo.listRevisions(id, page(url)) }; }
        const codebook = path.match(/^\/api\/codebooks\/([^/]+)(?:\/revisions\/([^/]+))?$/);
        if (codebook) { const id = decode(codebook[1]!); if (method === 'GET') { const b = codebook[2] ? await repo.getRevision(id, decode(codebook[2])) : await repo.getCodebook(id); if (!b) throw new AnalysisNotFound('Codebook or revision not found'); return { status: 200, body: b }; } if (method === 'PATCH' && !codebook[2]) return { status: 200, body: await service.reviseCodebook(id, await body(req) as unknown as Parameters<AnalysisService['reviseCodebook']>[1]) }; }
        const preview = path.match(/^\/api\/runs\/([^/]+)\/analyses\/preview\/windows\/([^/]+)$/);
        if (preview && method === 'POST') return { status: 200, body: await service.previewWindow(decode(preview[1]!), decode(preview[2]!), await body(req) as unknown as PreviewInput & { previewHash: string }) };
        const run = path.match(/^\/api\/runs\/([^/]+)\/analyses(?:\/(preview))?$/);
        if (run) { const id = decode(run[1]!); if (method === 'GET' && !run[2]) return { status: 200, body: await repo.listJobs(id, page(url)) }; if (method === 'POST') { const b = await body(req); return run[2] ? { status: 200, body: await service.preview(id, b as unknown as PreviewInput) } : { status: 202, body: await service.launch(id, b as unknown as LaunchInput) }; } }
        const job = path.match(/^\/api\/analyses\/([^/]+)(?:\/(windows|results|attempts|cancel|retry|export)(?:\/([^/]+))?)?$/);
        if (!job) return null; const id = decode(job[1]!), op = job[2]; if (job[3] && op !== 'windows') return null;
        await service.getJob(id);
        if (method === 'GET' && !op) return { status: 200, body: await service.getJob(id) };
        if (method === 'GET' && op === 'windows') {
            if (job[3]) return { status: 200, body: await service.getWindow(id, decode(job[3])) };
            const withResults = url.searchParams.get('withResults'); if (withResults !== null && withResults !== 'true' && withResults !== 'false') throw new AnalysisValidation('withResults must be true or false');
            const windows = await repo.listWindows(id, page(url)); if (withResults !== 'true') return { status: 200, body: windows };
            const results = await repo.resultsForWindows(id, windows.items.map(w => w.id));
            return { status: 200, body: { ...windows, items: windows.items.map(w => ({ ...w, results: results.filter(r => r.windowId === w.id) })) } };
        }
        if (method === 'GET' && op === 'results') return { status: 200, body: await repo.listResults(id, { ...page(url), ...(url.searchParams.get('windowId') ? { windowId: url.searchParams.get('windowId')! } : {}) }) };
        if (method === 'GET' && op === 'attempts') return { status: 200, body: await repo.listAttempts(id, page(url)) };
        if (method === 'POST' && op === 'cancel') return { status: 202, body: await service.cancel(id) };
        if (method === 'POST' && op === 'retry') return { status: 202, body: await service.retry(id) };
        if (method === 'GET' && op === 'export') return { status: 200, headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Content-Disposition': `attachment; filename="${id.replace(/[^a-zA-Z0-9_-]/g, '')}.ndjson"` }, body: service.exportAnalysis(id) };
        return null;
    };
}
