import type { ResearcherRepository, ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';

const RUN_STATUSES = ['queued', 'running', 'reporting', 'stopping', 'completed', 'cancelled', 'failed', 'interrupted'];

export function createOverviewRouter(repository: Pick<ResearcherRepository, 'queryRuns' | 'workerStatus'>): ResearchRouteHandler {
    return async ({ method, path }) => {
        if (method !== 'GET' || path !== '/overview') return null;
        const [activity, recent, attention, counts, worker, queue] = await Promise.all([
            repository.queryRuns({ status: 'queued,running,reporting,stopping', offset: 0, limit: 20 }),
            repository.queryRuns({ status: 'completed,cancelled', offset: 0, limit: 10 }),
            repository.queryRuns({ status: 'failed,interrupted', offset: 0, limit: 10 }),
            Promise.all(RUN_STATUSES.map(async status => [status, (await repository.queryRuns({ status, offset: 0, limit: 1 })).total] as const)),
            repository.workerStatus(),
            repository.queryRuns({ status: 'queued', order: 'queue', offset: 0, limit: 20 }),
        ]);
        return { status: 200, data: { observedAt: new Date().toISOString(), activity: activity.items, recent: recent.items, attention: attention.items, counts: Object.fromEntries(counts), worker, queue: queue.items, queueTotal: queue.total } };
    };
}
