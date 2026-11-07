import { createServer, type Server, type IncomingMessage } from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { ExperimentConfig, Repository, Run } from '../harness/contracts.js';
import { defaultFixtureConfiguration, resolveConfiguration, resolvePair, validateConfiguration, seededOrder } from '../harness/config.js';
import { createQueuedRun } from '../harness/scheduler.js';
export interface Draft {
    id: string;
    config: ExperimentConfig;
    updatedAt: string;
}
export interface ResearcherRepository extends Repository {
    saveDraft(id: string, config: ExperimentConfig): Promise<unknown>;
    listDrafts(): Promise<Draft[]>;
    getDraft(id: string): Promise<Draft | null>;
    requestCancel(id: string): Promise<Run | null>;
    createPair(runs: Run[]): Promise<Run[]>;
}
export interface ResearcherServerOptions {
    token?: string;
    host?: string;
    buildMetadata?: ExperimentConfig['build'];
}
class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    let text = '';
    for await (const chunk of req) {
        text += chunk;
        if (Buffer.byteLength(text) > 2000000)
            throw new HttpError(413, 'Request exceeds 2 MB');
    }
    try {
        const value = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error();
        return value;
    }
    catch {
        throw new HttpError(400, 'Expected a JSON object');
    }
}
function idempotency(value: unknown): string { if (typeof value !== 'string' || !value.trim() || value.length > 160)
    throw new HttpError(400, 'A nonempty idempotencyKey (maximum 160 characters) is required'); return value; }
function cursor(value: string | null, fallback: number, max = Number.MAX_SAFE_INTEGER) { const n = value === null ? fallback : Number(value); if (!Number.isSafeInteger(n) || n < 0 || n > max)
    throw new HttpError(400, 'Invalid pagination cursor or limit'); return n; }
export function createResearcherServer(repository: ResearcherRepository, options: ResearcherServerOptions = {}): Server {
    if (options.host && !['127.0.0.1', 'localhost', '::1'].includes(options.host) && !options.token)
        throw new Error('Hosted researcher server requires an access token');
    const withBuild = (input: unknown): unknown => input && typeof input === 'object' && !Array.isArray(input) ? { ...input, ...(options.buildMetadata ? { build: options.buildMetadata } : {}) } : input;
    return createServer(async (req, res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
        const send = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
        try {
            const url = new URL(req.url || '/', 'http://localhost');
            if (url.pathname.startsWith('/api/')) {
                if (options.token) {
                    const actual = Buffer.from(req.headers.authorization || '');
                    const expected = Buffer.from('Bearer ' + options.token);
                    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
                        throw new HttpError(401, 'Researcher access token required');
                }
                if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`)
                    throw new HttpError(403, 'Cross-origin writes are forbidden');
                const path = url.pathname.slice(4), method = req.method;
                if (method === 'GET' && path === '/config/default')
                    return send(200, defaultFixtureConfiguration());
                if (method === 'POST' && path === '/config/validate') {
                    const b = await body(req), input = withBuild(b.config), validation = validateConfiguration(input);
                    return send(200, { ...validation, ...(validation.valid ? { config: resolveConfiguration(input) } : {}) });
                }
                if (path === '/drafts' && method === 'GET')
                    return send(200, await repository.listDrafts());
                if (path === '/drafts' && method === 'POST') {
                    const b = await body(req), config = resolveConfiguration(b.config), id = typeof b.id === 'string' ? b.id : randomUUID();
                    await repository.saveDraft(id, config);
                    return send(200, { id, config });
                }
                if (path.startsWith('/drafts/') && method === 'GET') {
                    const draft = await repository.getDraft(decodeURIComponent(path.slice(8)));
                    if (!draft)
                        throw new HttpError(404, 'Draft not found');
                    return send(200, draft);
                }
                if (path === '/runs' && method === 'GET')
                    return send(200, await repository.listRuns());
                if (path === '/runs' && method === 'POST') {
                    const b = await body(req), key = idempotency(b.idempotencyKey), config = resolveConfiguration(withBuild(b.config));
                    return send(202, await repository.createRun(createQueuedRun(config, key)));
                }
                if (path === '/pairs' && method === 'POST') {
                    const b = await body(req), key = idempotency(b.idempotencyKey), configs = resolvePair(withBuild(b.config)), pairId = 'pair-' + key;
                    // A recorded pairing seed determines queue order; scheduler order remains unchanged.
                    const pairingSeed = cursor(String(b.pairingSeed ?? 42), 42);
                    const order = seededOrder(['0', '1'], pairingSeed);
                    const runs = order.map((index, pairPosition) => ({ ...createQueuedRun(configs[Number(index)]!, key + ':' + index, pairId), pairingSeed, pairPosition }));
                    const created = await repository.createPair(runs);
                    return send(202, created);
                }
                const match = path.match(/^\/runs\/([^/]+)(?:\/(events|export|cancel|board|memory|artifacts|reports))?$/);
                if (match) {
                    const id = decodeURIComponent(match[1]!), op = match[2], run = await repository.getRun(id);
                    if (!run)
                        throw new HttpError(404, 'Run not found');
                    if (method === 'POST' && op === 'cancel')
                        return send(202, await repository.requestCancel(id));
                    if (method !== 'GET')
                        throw new HttpError(405, 'Method not allowed');
                    if (!op)
                        return send(200, run);
                    if (op === 'events') {
                        const after = cursor(url.searchParams.get('after'), 0), limit = cursor(url.searchParams.get('limit'), 200, 1000);
                        if (limit < 1)
                            throw new HttpError(400, 'limit must be positive');
                        const events = await repository.listEvents(id, after, limit);
                        return send(200, { events, nextCursor: events.at(-1)?.sequence ?? after });
                    }
                    const all = [];
                    let after = 0;
                    while (true) {
                        const page = await repository.listEvents(id, after, 1000);
                        all.push(...page);
                        if (page.length < 1000)
                            break;
                        after = page.at(-1)!.sequence;
                    }
                    if (op === 'export')
                        return send(200, { schemaVersion: 1, exportedAt: new Date().toISOString(), run, events: all });
                    if (op === 'board')
                        return send(200, { posts: run.board, deliveries: all.filter(e => e.type === 'board_delivery') });
                    if (op === 'memory')
                        return send(200, all.filter(e => e.type.includes('memory')));
                    if (op === 'artifacts')
                        return send(200, run.artifacts);
                    if (op === 'reports')
                        return send(200, run.reports);
                }
                throw new HttpError(404, 'API route not found');
            }
            if (req.method !== 'GET')
                throw new HttpError(405, 'Method not allowed');
            const asset = ({ '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] } as Record<string, string[]>)[url.pathname];
            if (!asset)
                throw new HttpError(404, 'Not found');
            const content = await readFile(new URL('../dashboard/' + asset[0], import.meta.url));
            res.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8' });
            res.end(content);
        }
        catch (error) {
            send(error instanceof HttpError ? error.status : 400, { error: error instanceof Error ? error.message : 'Request failed' });
        }
    });
}
