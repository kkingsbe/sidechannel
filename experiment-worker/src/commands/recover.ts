import { MongoRepository } from '@sidechannel/persistence/harness/repository';
import { ACTIVE_RUN_STATUSES, type RunStatus } from '@sidechannel/contracts/harness/contracts';

if (!process.argv.includes('--workers-stopped'))
    throw new Error('Stop all workers, then run npm run recover -- --workers-stopped. Recovery never resumes a run.');

const repository = await MongoRepository.connect(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0', process.env.MONGODB_DB_NAME ?? 'sidechannel');

// Abandoned-owner statuses: active, minus a run that never started.
const RECOVERABLE: readonly RunStatus[] = ACTIVE_RUN_STATUSES.filter(status => status !== 'queued');

try {
    for (const run of await repository.listRuns())
        if (RECOVERABLE.includes(run.status)) {
            run.status = 'interrupted';
            run.failureReason = 'Operator recovered an abandoned worker; no automatic resume';
            run.updatedAt = new Date().toISOString();
            await repository.saveRun(run);
            await repository.appendEvent({ runId: run.id, type: 'run_interrupted', data: { reason: run.failureReason } });
        }
    await repository.db.collection('worker_guard').deleteOne({ key: 'single-worker' });
    console.log('Abandoned runs marked interrupted; worker guard cleared.');
}
finally {
    await repository.close();
}