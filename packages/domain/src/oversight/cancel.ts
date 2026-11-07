import type { ResearchStore } from '@sidechannel/contracts/analysis/store';
import type { MonitorEvaluation } from '@sidechannel/contracts/oversight/contracts';
import { OversightError } from './errors.js';

export async function cancelMonitor(store: ResearchStore, id: string): Promise<MonitorEvaluation> {
    for (let attempt = 0; attempt < 8; attempt++) {
        const job = await store.get<MonitorEvaluation>('monitor_evaluations', id);
        if (!job) throw new OversightError(404, 'Monitor evaluation not found');
        if (!['queued', 'running'].includes(job.status)) return job;
        const next = { ...job, revision: job.revision + 1, cancelRequested: true, updatedAt: new Date().toISOString() };
        if (await store.replace('monitor_evaluations', id, job.revision, next)) return next;
    }
    throw new OversightError(409, 'Evaluation changed while cancelling; retry the request.');
}
