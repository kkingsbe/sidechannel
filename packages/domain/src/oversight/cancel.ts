import type { ResearchStore } from '@sidechannel/contracts/analysis/store';
import { DomainFailure } from '@sidechannel/contracts/errors';
import type { MonitorEvaluation } from '@sidechannel/contracts/oversight/contracts';

export async function cancelMonitor(store: ResearchStore, id: string): Promise<MonitorEvaluation> {
    for (let attempt = 0; attempt < 8; attempt++) {
        const job = await store.get<MonitorEvaluation>('monitor_evaluations', id);
        if (!job) throw new DomainFailure('not-found', 'Monitor evaluation not found');
        if (!['queued', 'running'].includes(job.status)) return job;
        const next = { ...job, revision: job.revision + 1, cancelRequested: true, updatedAt: new Date().toISOString() };
        if (await store.replace('monitor_evaluations', id, job.revision, next)) return next;
    }
    throw new DomainFailure('conflict', 'Evaluation changed while cancelling; retry the request.');
}
