import { MongoRepository } from '@sidechannel/persistence/harness/repository';
import { interruptAbandonedRuns } from '../harness/worker-lease.js';

// Workers now take over an expired lease on their own; this clears it immediately instead of waiting.
if (!process.argv.includes('--workers-stopped'))
    throw new Error('Stop all workers, then run npm run recover -- --workers-stopped. Recovery never resumes a run.');

const repository = await MongoRepository.connect(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0', process.env.MONGODB_DB_NAME ?? 'sidechannel');

try {
    await interruptAbandonedRuns(repository, 'Operator recovered an abandoned worker; no automatic resume');
    await repository.db.collection('worker_guard').deleteOne({ key: 'single-worker' });
    console.log('Abandoned runs marked interrupted; worker guard cleared.');
}
finally {
    await repository.close();
}
