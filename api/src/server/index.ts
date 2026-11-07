import { createServer, type Server, type IncomingMessage } from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ExperimentConfig, Run } from '@sidechannel/contracts/harness/contracts';
import type { Draft, DraftMetadata, EventQuery, EvidenceKind } from '@sidechannel/contracts/harness/repository';
import { defaultFixtureConfiguration, resolveConfiguration, resolvePair, validateConfiguration, seededOrder } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { configurationSchema, fieldErrors } from '@sidechannel/contracts/server/config-schema';
import type { ResearcherRepository, ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import type { HealthcareCatalog } from '@sidechannel/contracts/healthcare/repository';
import { HealthcareService } from '../healthcare/service.js';
import { adaptionModelRoute, validateAdaptionModelSelection } from './adaption-models.js';

export type { Draft } from '@sidechannel/contracts/harness/repository';

export interface ResearcherServerOptions {
    /** Explicitly identifies the simulated, reset-on-restart acceptance workspace. */
    demoMode?: boolean;
    token?: string;
    host?: string;
    buildMetadata?: ExperimentConfig['build'];
    extensionHandlers?: ResearchRouteHandler[];
    dashboardDirectory?: string;
    healthcareCatalog?: HealthcareCatalog;
}

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of req) { const value = Buffer.from(chunk); bytes += value.length; if (bytes > 2000000) throw new HttpError(413, 'Request exceeds 2 MB'); chunks.push(value); }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text) return {};
    try { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
    catch { throw new HttpError(400, 'Expected a JSON object'); }
}

function idempotency(value: unknown): string { if (typeof value !== 'string' || !value.trim() || value.length > 160) throw new HttpError(400, 'A nonempty idempotencyKey (maximum 160 characters) is required'); return value; }

function cursor(value: string | null, fallback: number, max = Number.MAX_SAFE_INTEGER) { const n = value === null ? fallback : Number(value); if (!Number.isSafeInteger(n) || n < 0 || n > max) throw new HttpError(400, 'Invalid pagination cursor or limit'); return n; }

function metadata(value: Record<string, unknown>): DraftMetadata {
    const result: DraftMetadata = {};
    for (const key of ['name', 'notes', 'groupId'] as const) if (value[key] !== undefined) { if (typeof value[key] !== 'string' || value[key].length > 20000) throw new HttpError(400, `Invalid ${key}`); result[key] = value[key]; }
    return result;
}

function validate(input: unknown) { const validation = validateConfiguration(input), fieldIssues = fieldErrors(validation.errors); return { ...validation, fieldErrors: Object.fromEntries(fieldIssues.filter(issue => issue.path).map(issue => [issue.path, issue.message])), fieldIssues }; }

function differences(left: unknown, right: unknown, path = ''): string[] {
    if (isDeepStrictEqual(left, right)) return [];
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) || Array.isArray(right)) return [path];
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key => differences((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], path ? `${path}.${key}` : key));
}

export function createResearcherServer(repository: ResearcherRepository, options: ResearcherServerOptions = {}): Server {
    const healthcare = options.healthcareCatalog ? new HealthcareService(options.healthcareCatalog) : undefined;
    const extensionHandlers = [adaptionModelRoute, ...(healthcare ? [healthcare.routes(repository)] : []), ...(options.extensionHandlers ?? [])];
    const withBuild = (input: unknown): unknown => input && typeof input === 'object' && !Array.isArray(input) ? { ...input, ...(options.buildMetadata ? { build: options.buildMetadata } : {}) } : input;
    const prepare = async (input: unknown) => {
        let config = withBuild(input);
        try {
            if (healthcare) config = await healthcare.resolveConfiguration(config);
            else if ((config as ExperimentConfig)?.scenario?.version === 'healthcare-points-v0.3') throw new Error('scenario.datasetId: Healthcare catalog is unavailable; bootstrap the datasets');
        } catch (error) { const message = error instanceof Error ? error.message : 'Dataset resolution failed'; return { config, validation: { valid: false, errors: [message], fieldErrors: { 'scenario.datasetId': message }, fieldIssues: [{ path: 'scenario.datasetId', message }] } }; }
        const base = validate(config);
        const additional = base.valid ? await validateAdaptionModelSelection(config as ExperimentConfig) : [];
        if (!additional.length) return { config, validation: base };
        const issues = additional.map(message => ({ path: message.includes(':') ? message.split(':')[0]! : message.startsWith('model.') ? message.split(' ')[0]! : 'model.id', message }));
        return { config, validation: { ...base, valid: false, errors: [...base.errors, ...additional], fieldIssues: [...base.fieldIssues, ...issues], fieldErrors: { ...base.fieldErrors, ...Object.fromEntries(issues.map(issue => [issue.path, issue.message])) } } };
    };
    const freezeReference = async (run: Run) => { const existing = await repository.getRunByLaunchKey(run.launchKey); if (existing) { if (existing.configHash !== run.configHash) throw new HttpError(409, 'Idempotency key conflicts with a different configuration'); run.id = existing.id; } await healthcare?.freezeRunReference(run); return run; };
    const dashboardDirectory = options.dashboardDirectory ?? process.env.DASHBOARD_DIST_DIR ?? fileURLToPath(new URL('../../../dashboard/dist/', import.meta.url));
    return createServer(async (req, res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
        const send = async (status: number, data: unknown) => {
            if (data && typeof data === 'object' && Symbol.asyncIterator in data) {
                res.writeHead(status, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
                try { for await (const row of data as AsyncIterable<unknown>) { if (res.destroyed) break; if (!res.write(JSON.stringify(row) + '\n')) await new Promise<void>(resolve => { const done = () => { res.off('drain', done); res.off('close', done); resolve(); }; res.once('drain', done); res.once('close', done); }); } res.end(); }
                catch { res.destroy(); }
                return;
            }
            res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data));
        };
        try {
            const url = new URL(req.url || '/', 'http://localhost');
            if (url.pathname.startsWith('/api/')) {
                if (options.token) {
                    const actual = Buffer.from(req.headers.authorization || ''), expected = Buffer.from('Bearer ' + options.token);
                    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new HttpError(401, 'Researcher access token required');
                }
                const method = req.method ?? 'GET';
                if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) throw new HttpError(403, 'Cross-origin writes are forbidden');
                const path = url.pathname.slice(4), query = url.searchParams;
                if (path === '/workspace' && method === 'GET') return send(200, { mode: options.demoMode ? 'demo' : 'research' });
                let parsed: Record<string, unknown> | undefined;
                const input = async () => parsed ??= await body(req);
                if (method === 'GET' && path === '/config/default') return send(200, defaultFixtureConfiguration());
                if (method === 'GET' && path === '/config/schema') return send(200, configurationSchema);
                if (method === 'POST' && path === '/config/validate') {
                    const b = await input(), { config, validation } = await prepare(b.config);
                    return send(200, { ...validation, ...(validation.valid ? { config: resolveConfiguration(config) } : {}) });
                }
                if (path === '/drafts' && method === 'GET') return send(200, await repository.listDrafts());
                if (path === '/drafts' && method === 'POST') {
                    const b = await input(); if (b.config === undefined) throw new HttpError(400, 'config is required');
                    const id = typeof b.id === 'string' && b.id.trim() ? b.id : randomUUID();
                    if (b.revision !== undefined && (!Number.isSafeInteger(b.revision) || Number(b.revision) < 0)) throw new HttpError(400, 'revision must be a nonnegative integer');
                    const draft = await repository.saveDraft(id, b.config, b.revision as number | undefined, metadata(b));
                    return send(200, { ...draft, validation: validate(draft.config) });
                }
                const duplicate = path.match(/^\/(drafts|runs|pairs)\/([^/]+)\/duplicate$/);
                if (duplicate && method === 'POST') {
                    const b = await input(), sourceType = duplicate[1]!.slice(0, -1) as 'draft' | 'run' | 'pair', sourceId = decodeURIComponent(duplicate[2]!);
                    const source = sourceType === 'draft' ? await repository.getDraft(sourceId) : sourceType === 'run' ? await repository.getRun(sourceId) : (await repository.listRuns()).find(run => run.pairId === sourceId);
                    if (!source) throw new HttpError(404, 'Duplication source not found');
                    const inherited = 'revision' in source ? metadata(source as unknown as Record<string, unknown>) : source.sourceDraft ? metadata(source.sourceDraft as unknown as Record<string, unknown>) : {};
                    const draft = await repository.saveDraft(randomUUID(), source.config, undefined, { ...inherited, ...metadata(b), lineage: { sourceType, sourceId, ...('revision' in source ? { sourceRevision: source.revision } : {}) } });
                    return send(201, { ...draft, validation: validate(draft.config) });
                }
                if (path.startsWith('/drafts/') && method === 'GET') {
                    const draft = await repository.getDraft(decodeURIComponent(path.slice(8))); if (!draft) throw new HttpError(404, 'Draft not found');
                    return send(200, { ...draft, validation: validate(draft.config) });
                }
                if (path === '/overview' && method === 'GET') {
                    const statuses = ['queued', 'running', 'reporting', 'stopping', 'completed', 'cancelled', 'failed', 'interrupted'];
                    const [activity, recent, attention, counts, worker, queue] = await Promise.all([repository.queryRuns({ status: 'queued,running,reporting,stopping', offset: 0, limit: 20 }), repository.queryRuns({ status: 'completed,cancelled', offset: 0, limit: 10 }), repository.queryRuns({ status: 'failed,interrupted', offset: 0, limit: 10 }), Promise.all(statuses.map(async status => [status, (await repository.queryRuns({ status, offset: 0, limit: 1 })).total])), repository.workerStatus(), repository.queryRuns({ status: 'queued', order: 'queue', offset: 0, limit: 20 })]);
                    return send(200, { observedAt: new Date().toISOString(), activity: activity.items, recent: recent.items, attention: attention.items, counts: Object.fromEntries(counts), worker, queue: queue.items, queueTotal: queue.total });
                }
                if (path === '/runs' && method === 'GET') {
                    if (!query.size) return send(200, await repository.listRuns());
                    const limit = cursor(query.get('limit'), 50, 1000), offset = cursor(query.get('offset'), 0); if (!limit) throw new HttpError(400, 'limit must be positive');
                    const filter = Object.fromEntries(['status', 'model', 'condition', 'scenario', 'designation'].filter(key => query.has(key)).map(key => [key, query.get(key)!]));
                    const result = await repository.queryRuns({ ...filter, limit, offset });
                    return send(200, { ...result, nextOffset: offset + limit < result.total ? offset + limit : null });
                }
                if ((path === '/runs' || path === '/pairs') && method === 'POST') {
                    const b = await input(), key = idempotency(b.idempotencyKey), { config, validation } = await prepare(b.config);
                    if (!validation.valid) return send(400, { error: validation.errors.join('; '), ...validation });
                    let sourceDraft: Run['sourceDraft'];
                    if (b.sourceDraftId !== undefined || b.sourceDraftRevision !== undefined) {
                        if (typeof b.sourceDraftId !== 'string' || !Number.isSafeInteger(b.sourceDraftRevision) || Number(b.sourceDraftRevision) < 1) throw new HttpError(400, 'Saved draft launches require sourceDraftId and sourceDraftRevision');
                        const existing = await repository.getRunByLaunchKey(path === '/runs' ? key : key + ':0');
                        if (existing?.sourceDraft?.id === b.sourceDraftId && existing.sourceDraft.revision === b.sourceDraftRevision) sourceDraft = existing.sourceDraft;
                        else {
                            const draft = await repository.getDraft(b.sourceDraftId);
                            if (!draft || draft.revision !== b.sourceDraftRevision) throw new HttpError(409, 'Source draft changed; reload and review its current revision');
                            const preparedDraft = await prepare(draft.config);
                            if (!preparedDraft.validation.valid || !isDeepStrictEqual(resolveConfiguration(preparedDraft.config), resolveConfiguration(config))) throw new HttpError(409, 'Launch configuration differs from the selected saved draft');
                            const { config: ignored, updatedAt, ...snapshot } = draft;
                            sourceDraft = snapshot;
                        }
                    }
                    const source = sourceDraft ? { sourceDraft } : {};
                    if (path === '/runs') return send(202, await repository.createRun(await freezeReference({ ...createQueuedRun(resolveConfiguration(config), key), ...source })));
                    const configs = resolvePair(config), pairingSeed = cursor(String(b.pairingSeed ?? 42), 42), pairId = 'pair-' + key;
                    const runs = seededOrder(['0', '1'], pairingSeed).map((index, pairPosition) => ({ ...createQueuedRun(configs[Number(index)]!, key + ':' + index, pairId), pairingSeed, pairPosition, ...source }));
                    return send(202, await repository.createPair(await Promise.all(runs.map(freezeReference))));
                }
                const pair = path.match(/^\/pairs\/([^/]+)$/);
                if (pair && method === 'GET') {
                    const pairId = decodeURIComponent(pair[1]!), runs = (await repository.listRuns()).filter(run => run.pairId === pairId);
                    if (!runs.length) throw new HttpError(404, 'Pair not found');
                    const configurationDifferences = runs.length === 2 ? differences(runs[0]!.config, runs[1]!.config) : [];
                    return send(200, { pairId, runs: await Promise.all(runs.map(run => repository.getRunSummary(run.id))), configurationDifferences, matched: runs.length === 2 && configurationDifferences.every(path => path.startsWith('condition.')) });
                }
                const eventLink = path.match(/^\/runs\/([^/]+)\/events\/([^/]+)$/);
                if (eventLink && method === 'GET') {
                    const event = await repository.getEvent(decodeURIComponent(eventLink[1]!), decodeURIComponent(eventLink[2]!));
                    if (!event) throw new HttpError(404, 'Event not found in this run');
                    return send(200, event);
                }
                const evidenceLink = path.match(/^\/runs\/([^/]+)\/(board|artifacts|reports)\/([^/]+)$/);
                if (evidenceLink && method === 'GET') {
                    const item = await repository.getEvidenceItem(decodeURIComponent(evidenceLink[1]!), evidenceLink[2]! as EvidenceKind, decodeURIComponent(evidenceLink[3]!));
                    if (!item) throw new HttpError(404, 'Evidence not found in this run');
                    return send(200, item);
                }
                const match = path.match(/^\/runs\/([^/]+)(?:\/(progress|events|export|cancel|board|memory|artifacts|reports))?$/);
                if (match) {
                    const id = decodeURIComponent(match[1]!), op = match[2];
                    const summary = await repository.getRunSummary(id); if (!summary) throw new HttpError(404, 'Run not found');
                    if (method === 'POST' && op === 'cancel') return send(202, await repository.requestCancel(id));
                    if (method !== 'GET') throw new HttpError(405, 'Method not allowed');
                    if (op === 'progress') return send(200, { ...summary, observedAt: new Date().toISOString(), executionPhase: summary.status === 'reporting' ? 'report' : 'action', rounds: summary.config.scheduler.rounds });
                    if (op === 'events' || op === 'memory') {
                        const after = cursor(query.get('after'), 0), limit = cursor(query.get('limit'), 200, 1000); if (!limit) throw new HttpError(400, 'limit must be positive');
                        if (query.has('phase') && !['action', 'report'].includes(query.get('phase')!)) throw new HttpError(400, 'phase must be action or report');
                        const filter: EventQuery = { after, limit: limit + 1, ...(query.get('actor') ? { actor: query.get('actor')! } : {}), ...(query.get('phase') ? { phase: query.get('phase')! } : {}), ...(query.get('type') ? { type: query.get('type')! } : {}), ...(query.has('from') ? { from: cursor(query.get('from'), 0) } : {}), ...(query.has('to') ? { to: cursor(query.get('to'), 0) } : {}) };
                        if (op === 'memory') { filter.type = query.get('type') ?? 'memory_updated'; filter.offset = cursor(query.get('offset'), 0); }
                        const rows = await repository.queryEvents(id, filter), events = rows.slice(0, limit);
                        return send(200, { events, items: events, nextCursor: events.at(-1)?.sequence ?? after, hasMore: rows.length > limit, ...(op === 'memory' ? { nextOffset: rows.length > limit ? (filter.offset ?? 0) + limit : null } : {}) });
                    }
                    if (op === 'artifacts' || op === 'reports' || op === 'board') {
                        const offset = cursor(query.get('offset'), 0), limit = cursor(query.get('limit'), 100, 1000); if (!limit) throw new HttpError(400, 'limit must be positive');
                        const result = await repository.getEvidencePage(id, op, offset, limit), paginated = { ...result, nextOffset: offset + limit < result.total ? offset + limit : null };
                        if (op !== 'board') return send(200, paginated);
                        const deliveries = await repository.queryEvents(id, { type: 'board_delivery', after: cursor(query.get('afterDelivery'), 0), limit: 1000 });
                        return send(200, { ...paginated, posts: result.items, deliveries, nextDeliveryCursor: deliveries.at(-1)?.sequence ?? cursor(query.get('afterDelivery'), 0), deliveriesMayHaveMore: deliveries.length === 1000 });
                    }
                    const run = (await repository.getRun(id))!;
                    if (!op) return send(200, run);
                    const events = []; let after = 0;
                    while (true) { const rows = await repository.listEvents(id, after, 1000); events.push(...rows); if (rows.length < 1000) break; after = rows.at(-1)!.sequence; }
                    const researcherEvaluation = await healthcare?.researcherExport(run, repository);
                    return send(200, { schemaVersion: 1, scope: 'complete-source-evidence', exportedAt: new Date().toISOString(), run, events, ...(researcherEvaluation ? { researcherEvaluation } : {}) });
                }
                for (const handler of extensionHandlers) {
                    const result = await handler({ method, path, query, body: ['GET', 'HEAD'].includes(method) ? {} : await input() });
                    if (result) {
                        if (result.data && typeof result.data === 'object' && Symbol.asyncIterator in result.data) {
                            res.writeHead(result.status, { 'Content-Type': 'application/x-ndjson; charset=utf-8', ...result.headers });
                            async function* lines(records: AsyncIterable<unknown>) { for await (const record of records) yield JSON.stringify(record) + '\n'; }
                            await pipeline(Readable.from(lines(result.data as AsyncIterable<unknown>)), res);
                            return;
                        }
                        for (const [key, value] of Object.entries(result.headers ?? {})) res.setHeader(key, value);
                        return send(result.status, result.data);
                    }
                }
                throw new HttpError(404, 'API route not found');
            }
            if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
            let pathname: string; try { pathname = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'Invalid path encoding'); }
            if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part === '..' || part.startsWith('.'))) throw new HttpError(404, 'Not found');
            const root = await realpath(dashboardDirectory), requested = resolve(root, '.' + pathname), rel = relative(root, requested);
            if (rel.startsWith('..') || isAbsolute(rel)) throw new HttpError(404, 'Not found');
            let asset = requested;
            try { if (!(await stat(asset)).isFile()) throw new Error(); }
            catch { if (extname(pathname)) throw new HttpError(404, 'Asset not found'); asset = resolve(root, 'index.html'); }
            const actual = await realpath(asset), assetRelative = relative(root, actual);
            if (assetRelative.startsWith('..') || isAbsolute(assetRelative)) throw new HttpError(404, 'Not found');
            const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
            res.writeHead(200, { 'Content-Type': types[extname(asset)] ?? 'application/octet-stream' });
            res.end(req.method === 'HEAD' ? undefined : await readFile(asset));
        }
        catch (error) { const status = error instanceof Error && 'status' in error && typeof error.status === 'number' ? error.status : 400; if (res.headersSent) { if (!res.destroyed) res.end(JSON.stringify({ type: 'export_error', error: error instanceof Error ? error.message : 'Export incomplete', complete: false }) + '\n'); return; } send(status, { error: error instanceof Error ? error.message : 'Request failed' }); }
    });
}
