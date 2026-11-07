import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ExperimentConfig, Run } from '@sidechannel/contracts/harness/contracts';
import type { EventQuery, EvidenceKind } from '@sidechannel/contracts/harness/repository';
import { defaultFixtureConfiguration, resolveConfiguration, resolvePair, seededOrder } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { configurationSchema } from '@sidechannel/contracts/server/config-schema';
import type { ResearcherRepository, ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import type { HealthcareCatalog } from '@sidechannel/contracts/healthcare/repository';
import { HealthcareService } from '../healthcare/service.js';
import { adaptionModelRoute } from './adaption-models.js';
import { requireSameOrigin, requireToken } from './auth.js';
import { createConfigurationPipeline } from './configuration.js';
import { HttpError, sendFailure } from './errors.js';
import { applySecurityHeaders, cursor, draftMetadata, idempotencyKey, positiveLimit, requestBody, send } from './http.js';
import { serveDashboard } from './static.js';

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

export function createResearcherServer(repository: ResearcherRepository, options: ResearcherServerOptions = {}): Server {
    const healthcare = options.healthcareCatalog ? new HealthcareService(options.healthcareCatalog) : undefined;
    const configuration = createConfigurationPipeline({ buildMetadata: options.buildMetadata, healthcare });
    const extensionHandlers = [adaptionModelRoute, ...(healthcare ? [healthcare.routes(repository)] : []), ...(options.extensionHandlers ?? [])];
    const freezeReference = async (run: Run) => { const existing = await repository.getRunByLaunchKey(run.launchKey); if (existing) { if (existing.configHash !== run.configHash) throw new HttpError(409, 'Idempotency key conflicts with a different configuration'); run.id = existing.id; } await healthcare?.freezeRunReference(run); return run; };
    const dashboardDirectory = options.dashboardDirectory ?? process.env.DASHBOARD_DIST_DIR ?? fileURLToPath(new URL('../../../dashboard/dist/', import.meta.url));
    return createServer(async (req, res) => {
        applySecurityHeaders(res);
        const reply = (status: number, data: unknown, headers?: Record<string, string>) => send(res, status, data, headers);
        try {
            const url = new URL(req.url || '/', 'http://localhost');
            if (url.pathname.startsWith('/api/')) {
                requireToken(req, options.token);
                const method = req.method ?? 'GET';
                requireSameOrigin(req);
                const path = url.pathname.slice(4), query = url.searchParams;
                if (path === '/workspace' && method === 'GET') return reply(200, { mode: options.demoMode ? 'demo' : 'research' });
                const input = requestBody(req);
                if (method === 'GET' && path === '/config/default') return reply(200, defaultFixtureConfiguration());
                if (method === 'GET' && path === '/config/schema') return reply(200, configurationSchema);
                if (method === 'POST' && path === '/config/validate') {
                    const b = await input(), { config, validation } = await configuration.prepare(b.config);
                    return reply(200, { ...validation, ...(validation.valid ? { config: resolveConfiguration(config) } : {}) });
                }
                if (path === '/drafts' && method === 'GET') return reply(200, await repository.listDrafts());
                if (path === '/drafts' && method === 'POST') {
                    const b = await input(); if (b.config === undefined) throw new HttpError(400, 'config is required');
                    const id = typeof b.id === 'string' && b.id.trim() ? b.id : randomUUID();
                    if (b.revision !== undefined && (!Number.isSafeInteger(b.revision) || Number(b.revision) < 0)) throw new HttpError(400, 'revision must be a nonnegative integer');
                    const draft = await repository.saveDraft(id, b.config, b.revision as number | undefined, draftMetadata(b));
                    return reply(200, { ...draft, validation: configuration.validate(draft.config) });
                }
                const duplicate = path.match(/^\/(drafts|runs|pairs)\/([^/]+)\/duplicate$/);
                if (duplicate && method === 'POST') {
                    const b = await input(), sourceType = duplicate[1]!.slice(0, -1) as 'draft' | 'run' | 'pair', sourceId = decodeURIComponent(duplicate[2]!);
                    const source = sourceType === 'draft' ? await repository.getDraft(sourceId) : sourceType === 'run' ? await repository.getRun(sourceId) : (await repository.listRuns()).find(run => run.pairId === sourceId);
                    if (!source) throw new HttpError(404, 'Duplication source not found');
                    const inherited = 'revision' in source ? draftMetadata(source as unknown as Record<string, unknown>) : source.sourceDraft ? draftMetadata(source.sourceDraft as unknown as Record<string, unknown>) : {};
                    const draft = await repository.saveDraft(randomUUID(), source.config, undefined, { ...inherited, ...draftMetadata(b), lineage: { sourceType, sourceId, ...('revision' in source ? { sourceRevision: source.revision } : {}) } });
                    return reply(201, { ...draft, validation: configuration.validate(draft.config) });
                }
                if (path.startsWith('/drafts/') && method === 'GET') {
                    const draft = await repository.getDraft(decodeURIComponent(path.slice(8))); if (!draft) throw new HttpError(404, 'Draft not found');
                    return reply(200, { ...draft, validation: configuration.validate(draft.config) });
                }
                if (path === '/overview' && method === 'GET') {
                    const statuses = ['queued', 'running', 'reporting', 'stopping', 'completed', 'cancelled', 'failed', 'interrupted'];
                    const [activity, recent, attention, counts, worker, queue] = await Promise.all([repository.queryRuns({ status: 'queued,running,reporting,stopping', offset: 0, limit: 20 }), repository.queryRuns({ status: 'completed,cancelled', offset: 0, limit: 10 }), repository.queryRuns({ status: 'failed,interrupted', offset: 0, limit: 10 }), Promise.all(statuses.map(async status => [status, (await repository.queryRuns({ status, offset: 0, limit: 1 })).total])), repository.workerStatus(), repository.queryRuns({ status: 'queued', order: 'queue', offset: 0, limit: 20 })]);
                    return reply(200, { observedAt: new Date().toISOString(), activity: activity.items, recent: recent.items, attention: attention.items, counts: Object.fromEntries(counts), worker, queue: queue.items, queueTotal: queue.total });
                }
                if (path === '/runs' && method === 'GET') {
                    if (!query.size) return reply(200, await repository.listRuns());
                    const limit = positiveLimit(cursor(query.get('limit'), 50, 1000)), offset = cursor(query.get('offset'), 0);
                    const filter = Object.fromEntries(['status', 'model', 'condition', 'scenario', 'designation'].filter(key => query.has(key)).map(key => [key, query.get(key)!]));
                    const result = await repository.queryRuns({ ...filter, limit, offset });
                    return reply(200, { ...result, nextOffset: offset + limit < result.total ? offset + limit : null });
                }
                if ((path === '/runs' || path === '/pairs') && method === 'POST') {
                    const b = await input(), key = idempotencyKey(b.idempotencyKey), { config, validation } = await configuration.prepare(b.config);
                    if (!validation.valid) return reply(400, { error: validation.errors.join('; '), ...validation });
                    let sourceDraft: Run['sourceDraft'];
                    if (b.sourceDraftId !== undefined || b.sourceDraftRevision !== undefined) {
                        if (typeof b.sourceDraftId !== 'string' || !Number.isSafeInteger(b.sourceDraftRevision) || Number(b.sourceDraftRevision) < 1) throw new HttpError(400, 'Saved draft launches require sourceDraftId and sourceDraftRevision');
                        const existing = await repository.getRunByLaunchKey(path === '/runs' ? key : key + ':0');
                        if (existing?.sourceDraft?.id === b.sourceDraftId && existing.sourceDraft.revision === b.sourceDraftRevision) sourceDraft = existing.sourceDraft;
                        else {
                            const draft = await repository.getDraft(b.sourceDraftId);
                            if (!draft || draft.revision !== b.sourceDraftRevision) throw new HttpError(409, 'Source draft changed; reload and review its current revision');
                            const preparedDraft = await configuration.prepare(draft.config);
                            if (!preparedDraft.validation.valid || !isDeepStrictEqual(resolveConfiguration(preparedDraft.config), resolveConfiguration(config))) throw new HttpError(409, 'Launch configuration differs from the selected saved draft');
                            const { config: ignored, updatedAt, ...snapshot } = draft;
                            sourceDraft = snapshot;
                        }
                    }
                    const source = sourceDraft ? { sourceDraft } : {};
                    if (path === '/runs') return reply(202, await repository.createRun(await freezeReference({ ...createQueuedRun(resolveConfiguration(config), key), ...source })));
                    const configs = resolvePair(config), pairingSeed = cursor(String(b.pairingSeed ?? 42), 42), pairId = 'pair-' + key;
                    const runs = seededOrder(['0', '1'], pairingSeed).map((index, pairPosition) => ({ ...createQueuedRun(configs[Number(index)]!, key + ':' + index, pairId), pairingSeed, pairPosition, ...source }));
                    return reply(202, await repository.createPair(await Promise.all(runs.map(freezeReference))));
                }
                const pair = path.match(/^\/pairs\/([^/]+)$/);
                if (pair && method === 'GET') {
                    const pairId = decodeURIComponent(pair[1]!), runs = (await repository.listRuns()).filter(run => run.pairId === pairId);
                    if (!runs.length) throw new HttpError(404, 'Pair not found');
                    const configurationDifferences = runs.length === 2 ? differences(runs[0]!.config, runs[1]!.config) : [];
                    return reply(200, { pairId, runs: await Promise.all(runs.map(run => repository.getRunSummary(run.id))), configurationDifferences, matched: runs.length === 2 && configurationDifferences.every(path => path.startsWith('condition.')) });
                }
                const eventLink = path.match(/^\/runs\/([^/]+)\/events\/([^/]+)$/);
                if (eventLink && method === 'GET') {
                    const event = await repository.getEvent(decodeURIComponent(eventLink[1]!), decodeURIComponent(eventLink[2]!));
                    if (!event) throw new HttpError(404, 'Event not found in this run');
                    return reply(200, event);
                }
                const evidenceLink = path.match(/^\/runs\/([^/]+)\/(board|artifacts|reports)\/([^/]+)$/);
                if (evidenceLink && method === 'GET') {
                    const item = await repository.getEvidenceItem(decodeURIComponent(evidenceLink[1]!), evidenceLink[2]! as EvidenceKind, decodeURIComponent(evidenceLink[3]!));
                    if (!item) throw new HttpError(404, 'Evidence not found in this run');
                    return reply(200, item);
                }
                const match = path.match(/^\/runs\/([^/]+)(?:\/(progress|events|export|cancel|board|memory|artifacts|reports))?$/);
                if (match) {
                    const id = decodeURIComponent(match[1]!), op = match[2];
                    const summary = await repository.getRunSummary(id); if (!summary) throw new HttpError(404, 'Run not found');
                    if (method === 'POST' && op === 'cancel') return reply(202, await repository.requestCancel(id));
                    if (method !== 'GET') throw new HttpError(405, 'Method not allowed');
                    if (op === 'progress') return reply(200, { ...summary, observedAt: new Date().toISOString(), executionPhase: summary.status === 'reporting' ? 'report' : 'action', rounds: summary.config.scheduler.rounds });
                    if (op === 'events' || op === 'memory') {
                        const after = cursor(query.get('after'), 0), limit = positiveLimit(cursor(query.get('limit'), 200, 1000));
                        if (query.has('phase') && !['action', 'report'].includes(query.get('phase')!)) throw new HttpError(400, 'phase must be action or report');
                        const filter: EventQuery = { after, limit: limit + 1, ...(query.get('actor') ? { actor: query.get('actor')! } : {}), ...(query.get('phase') ? { phase: query.get('phase')! } : {}), ...(query.get('type') ? { type: query.get('type')! } : {}), ...(query.has('from') ? { from: cursor(query.get('from'), 0) } : {}), ...(query.has('to') ? { to: cursor(query.get('to'), 0) } : {}) };
                        if (op === 'memory') { filter.type = query.get('type') ?? 'memory_updated'; filter.offset = cursor(query.get('offset'), 0); }
                        const rows = await repository.queryEvents(id, filter), events = rows.slice(0, limit);
                        return reply(200, { events, items: events, nextCursor: events.at(-1)?.sequence ?? after, hasMore: rows.length > limit, ...(op === 'memory' ? { nextOffset: rows.length > limit ? (filter.offset ?? 0) + limit : null } : {}) });
                    }
                    if (op === 'artifacts' || op === 'reports' || op === 'board') {
                        const offset = cursor(query.get('offset'), 0), limit = positiveLimit(cursor(query.get('limit'), 100, 1000));
                        const result = await repository.getEvidencePage(id, op, offset, limit), paginated = { ...result, nextOffset: offset + limit < result.total ? offset + limit : null };
                        if (op !== 'board') return reply(200, paginated);
                        const deliveries = await repository.queryEvents(id, { type: 'board_delivery', after: cursor(query.get('afterDelivery'), 0), limit: 1000 });
                        return reply(200, { ...paginated, posts: result.items, deliveries, nextDeliveryCursor: deliveries.at(-1)?.sequence ?? cursor(query.get('afterDelivery'), 0), deliveriesMayHaveMore: deliveries.length === 1000 });
                    }
                    const run = (await repository.getRun(id))!;
                    if (!op) return reply(200, run);
                    const events = []; let after = 0;
                    while (true) { const rows = await repository.listEvents(id, after, 1000); events.push(...rows); if (rows.length < 1000) break; after = rows.at(-1)!.sequence; }
                    const researcherEvaluation = await healthcare?.researcherExport(run, repository);
                    return reply(200, { schemaVersion: 1, scope: 'complete-source-evidence', exportedAt: new Date().toISOString(), run, events, ...(researcherEvaluation ? { researcherEvaluation } : {}) });
                }
                for (const handler of extensionHandlers) {
                    const result = await handler({ method, path, query, body: input });
                    if (result) {
                        if (result.data && typeof result.data === 'object' && Symbol.asyncIterator in result.data) {
                            res.writeHead(result.status, { 'Content-Type': 'application/x-ndjson; charset=utf-8', ...result.headers });
                            async function* lines(records: AsyncIterable<unknown>) { for await (const record of records) yield JSON.stringify(record) + '\n'; }
                            await pipeline(Readable.from(lines(result.data as AsyncIterable<unknown>)), res);
                            return;
                        }
                        for (const [key, value] of Object.entries(result.headers ?? {})) res.setHeader(key, value);
                        return reply(result.status, result.data);
                    }
                }
                throw new HttpError(404, 'API route not found');
            }
            await serveDashboard(req, res, url.pathname, dashboardDirectory);
        }
        catch (error) { await sendFailure(res, error); }
    });
}

function differences(left: unknown, right: unknown, path = ''): string[] {
    if (isDeepStrictEqual(left, right)) return [];
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) || Array.isArray(right)) return [path];
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key => differences((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], path ? `${path}.${key}` : key));
}
