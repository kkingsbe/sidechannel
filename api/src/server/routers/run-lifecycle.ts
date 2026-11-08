import { DomainFailure } from '@sidechannel/contracts/errors';
import { RunHasDependents } from '@sidechannel/contracts/harness/run-lifecycle';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { RUN_LIFECYCLE_ACTIONS, type RunLifecycleAction, type RunLifecycleOutcome, type RunLifecycleService } from '@sidechannel/domain/harness/run-lifecycle';
import { HttpError, statusOf } from '../errors.js';

/** Most runs one bulk request may touch; the dashboard pages through 25 at a time. */
export const BULK_RUN_LIMIT = 100;

const SINGLE = /^\/runs\/([^/]+)(?:\/(archive|unarchive))?$/;

const confirmed = (body: Record<string, unknown>) => {
    if (body.confirm !== true) throw new HttpError(400, 'Deleting a run is permanent: send {"confirm": true} to confirm');
};

async function perform(service: RunLifecycleService, action: RunLifecycleAction, id: string): Promise<RunLifecycleOutcome> {
    return action === 'archive' ? service.archive(id) : action === 'unarchive' ? service.unarchive(id) : service.delete(id);
}

/**
 * Archive, unarchive and delete for terminal runs. Registered before the general runs router so that
 * `/runs/bulk` and the write verbs on `/runs/:id` never reach its read-only dispatch.
 */
export function createRunLifecycleRouter(service: RunLifecycleService): ResearchRouteHandler {
    return async request => {
        const { method, path } = request;
        if (path === '/runs/bulk' && method === 'POST') {
            const body = await request.body();
            const action = RUN_LIFECYCLE_ACTIONS.find(candidate => candidate === body.action);
            if (!action) throw new HttpError(400, `action must be one of ${RUN_LIFECYCLE_ACTIONS.join(', ')}`);
            const ids = body.ids;
            if (!Array.isArray(ids) || !ids.length || ids.length > BULK_RUN_LIMIT || ids.some(id => typeof id !== 'string' || !id)) throw new HttpError(400, `ids must list 1 to ${BULK_RUN_LIMIT} run IDs`);
            if (action === 'delete') confirmed(body);
            const results = [];
            for (const id of new Set(ids as string[])) {
                try { results.push({ ok: true, ...await perform(service, action, id) }); }
                catch (error) {
                    const known = error instanceof DomainFailure || error instanceof HttpError;
                    results.push({ ok: false, id, status: known ? statusOf(error) : 500, error: error instanceof Error ? error.message : 'Request failed',
                        ...(error instanceof RunHasDependents ? { dependents: error.dependents } : {}) });
                }
            }
            const succeeded = results.filter(result => result.ok).length;
            return { status: 200, data: { action, results, succeeded, failed: results.length - succeeded } };
        }
        const match = path.match(SINGLE);
        if (!match) return null;
        const id = decodeURIComponent(match[1]!), op = match[2] as 'archive' | 'unarchive' | undefined;
        if (!(op && method === 'POST') && !(!op && method === 'DELETE')) return null;
        if (!op) confirmed(await request.body());
        try { return { status: 200, data: await perform(service, op ?? 'delete', id) }; }
        catch (error) {
            if (error instanceof RunHasDependents) return { status: 409, data: { error: error.message, dependents: error.dependents } };
            throw error;
        }
    };
}
