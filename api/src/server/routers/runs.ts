import { resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { snapBackward, snapForward, TURN_SNAP_SLACK } from '@sidechannel/domain/harness/event-pages';
import { RUN_ARCHIVE_FILTERS, type EventQuery, type EvidenceKind, type RunArchiveFilter } from '@sidechannel/contracts/harness/repository';
import type { ResearcherRepository, ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { collectPages } from '@sidechannel/domain/pagination';
import type { HealthcareService } from '../../healthcare/service.js';
import type { ConfigurationPipeline } from '../configuration.js';
import { HttpError } from '../errors.js';
import { cursor, idempotencyKey, positiveLimit } from '../http.js';
import type { createLaunchService } from '../launch.js';

export interface RunRoutesContext {
    repository: ResearcherRepository;
    pipeline: ConfigurationPipeline;
    launch: ReturnType<typeof createLaunchService>;
    healthcare?: HealthcareService;
}

const RUN = /^\/runs\/([^/]+)(?:\/(progress|events|turns|export|cancel|board|memory|artifacts|reports))?$/;
const RUN_EVENT = /^\/runs\/([^/]+)\/events\/([^/]+)$/;
const RUN_EVIDENCE = /^\/runs\/([^/]+)\/(board|artifacts|reports)\/([^/]+)$/;

/** Run collection, launch, inspection operations, evidence links and the complete-source export. */
export function createRunsRouter({ repository, pipeline, launch, healthcare }: RunRoutesContext): ResearchRouteHandler {
    return async request => {
        const { method, path, query } = request;
        if (path === '/runs' && method === 'GET') {
            if (!query.size) return { status: 200, data: (await repository.listRuns()).filter(run => !run.archivedAt) };
            const archived = query.get('archived') ?? 'exclude';
            if (!RUN_ARCHIVE_FILTERS.includes(archived as RunArchiveFilter)) throw new HttpError(400, `archived must be one of ${RUN_ARCHIVE_FILTERS.join(', ')}`);
            const limit = positiveLimit(cursor(query.get('limit'), 50, 1000)), offset = cursor(query.get('offset'), 0);
            const filter = Object.fromEntries(['status', 'model', 'condition', 'scenario', 'designation'].filter(key => query.has(key)).map(key => [key, query.get(key)!]));
            const result = await repository.queryRuns({ ...filter, archived: archived as RunArchiveFilter, limit, offset });
            return { status: 200, data: { ...result, nextOffset: offset + limit < result.total ? offset + limit : null } };
        }
        if (path === '/runs' && method === 'POST') {
            const input = await request.body(), key = idempotencyKey(input.idempotencyKey), { config, validation } = await pipeline.prepare(input.config);
            if (!validation.valid) return { status: 400, data: { error: validation.errors.join('; '), ...validation } };
            const sourceDraft = await launch.sourceDraft(input, key, config), source = sourceDraft ? { sourceDraft } : {};
            return { status: 202, data: await repository.createRun(await launch.freezeReference({ ...createQueuedRun(resolveConfiguration(config), key), ...source })) };
        }
        const eventLink = path.match(RUN_EVENT);
        if (eventLink && method === 'GET') {
            const event = await repository.getEvent(decodeURIComponent(eventLink[1]!), decodeURIComponent(eventLink[2]!));
            if (!event) throw new HttpError(404, 'Event not found in this run');
            return { status: 200, data: event };
        }
        const evidenceLink = path.match(RUN_EVIDENCE);
        if (evidenceLink && method === 'GET') {
            const item = await repository.getEvidenceItem(decodeURIComponent(evidenceLink[1]!), evidenceLink[2]! as EvidenceKind, decodeURIComponent(evidenceLink[3]!));
            if (!item) throw new HttpError(404, 'Evidence not found in this run');
            return { status: 200, data: item };
        }
        const match = path.match(RUN);
        if (!match) return null;
        const id = decodeURIComponent(match[1]!), op = match[2];
        const summary = await repository.getRunSummary(id);
        if (!summary) throw new HttpError(404, 'Run not found');
        if (method === 'POST' && op === 'cancel') return { status: 202, data: await repository.requestCancel(id) };
        if (method !== 'GET') throw new HttpError(405, 'Method not allowed');
        if (op === 'progress') return { status: 200, data: { ...summary, observedAt: new Date().toISOString(), executionPhase: summary.status === 'reporting' ? 'report' : 'action', rounds: summary.config.scheduler.rounds } };
        if (op === 'turns') return { status: 200, data: { turns: await repository.listTurns(id) } };
        if (op === 'events' || op === 'memory') {
            const after = cursor(query.get('after'), 0), limit = positiveLimit(cursor(query.get('limit'), 200, 1000));
            if (query.has('phase') && !['action', 'report'].includes(query.get('phase')!)) throw new HttpError(400, 'phase must be action or report');
            const backward = op === 'events' && query.has('before'), snapped = op === 'events' && query.get('snap') === 'turn';
            if (backward && query.has('after')) throw new HttpError(400, 'Use either after or before, not both');
            const before = backward ? cursor(query.get('before'), 0) : undefined;
            const filter: EventQuery = { after, limit: limit + (snapped ? TURN_SNAP_SLACK : 0) + 1, ...(before === undefined ? {} : { before, order: 'desc' as const }), ...(query.get('actor') ? { actor: query.get('actor')! } : {}), ...(query.get('phase') ? { phase: query.get('phase')! } : {}), ...(query.get('type') ? { type: query.get('type')! } : {}), ...(query.has('from') ? { from: cursor(query.get('from'), 0) } : {}), ...(query.has('to') ? { to: cursor(query.get('to'), 0) } : {}) };
            if (op === 'memory') { filter.type = query.get('type') ?? 'memory_updated'; filter.offset = cursor(query.get('offset'), 0); }
            const rows = await repository.queryEvents(id, filter);
            const page = snapped ? (backward ? snapBackward(rows, limit) : snapForward(rows, limit)) : { events: backward ? rows.slice(0, limit).reverse() : rows.slice(0, limit), hasMore: rows.length > limit };
            const events = page.events;
            return { status: 200, data: { events, items: events, nextCursor: events.at(-1)?.sequence ?? after, ...(before === undefined ? {} : { previousCursor: events[0]?.sequence ?? before }), hasMore: page.hasMore, ...(op === 'memory' ? { nextOffset: rows.length > limit ? (filter.offset ?? 0) + limit : null } : {}) } };
        }
        if (op === 'artifacts' || op === 'reports' || op === 'board') {
            const offset = cursor(query.get('offset'), 0), limit = positiveLimit(cursor(query.get('limit'), 100, 1000));
            const result = await repository.getEvidencePage(id, op, offset, limit), paginated = { ...result, nextOffset: offset + limit < result.total ? offset + limit : null };
            if (op !== 'board') return { status: 200, data: paginated };
            const deliveries = await repository.queryEvents(id, { type: 'board_delivery', after: cursor(query.get('afterDelivery'), 0), limit: 1000 });
            return { status: 200, data: { ...paginated, posts: result.items, deliveries, nextDeliveryCursor: deliveries.at(-1)?.sequence ?? cursor(query.get('afterDelivery'), 0), deliveriesMayHaveMore: deliveries.length === 1000 } };
        }
        const run = (await repository.getRun(id))!;
        if (!op) return { status: 200, data: run };
        const events = await collectPages(async ({ after, limit = 1000 }) => {
            const rows = await repository.listEvents(id, Number(after ?? 0), limit);
            return { items: rows, nextCursor: rows.length === limit ? String(rows.at(-1)!.sequence) : null };
        }, 1000);
        const researcherEvaluation = await healthcare?.researcherExport(run, repository);
        return { status: 200, data: { schemaVersion: 1, scope: 'complete-source-evidence', exportedAt: new Date().toISOString(), run, events, ...(researcherEvaluation ? { researcherEvaluation } : {}) } };
    };
}
