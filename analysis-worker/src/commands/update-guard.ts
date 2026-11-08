import { MongoRepository } from '@sidechannel/persistence/harness/repository';

/**
 * Pre-update hook for the image updater (WUD `wud.hook.*` labels in compose.portainer.yaml).
 * Replacing this worker abandons in-flight Jev analysis and oversight jobs. Exit codes:
 * 0 = idle, safe to replace; 1 = jobs queued or active, defer; 2 = state unknown, defer.
 */
const ACTIVE = {
    analysis_jobs: ['preparing', 'queued', 'running'],
    research_monitor_evaluations: ['queued', 'running'],
};

const deadline = setTimeout(() => { console.error('update-guard: timed out checking jobs; deferring update'); process.exit(2); }, 20_000);

try {
    const repository = await MongoRepository.connect(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0', process.env.MONGODB_DB_NAME ?? 'sidechannel');
    try {
        const busy: string[] = [];
        for (const [collection, statuses] of Object.entries(ACTIVE))
            for (const job of await repository.db.collection(collection).find({ status: { $in: statuses } }, { projection: { _id: 0, id: 1, status: 1 } }).toArray())
                busy.push(`${collection}/${job.id} (${job.status})`);
        if (busy.length) {
            console.error(`update-guard: deferring update; ${busy.length} job(s) in progress: ${busy.join(', ')}`);
            process.exitCode = 1;
        }
        else console.log('update-guard: no analysis or oversight jobs queued or active; update may proceed');
    }
    finally { await repository.close(); }
}
catch (error) {
    console.error('update-guard: could not check jobs; deferring update:', error instanceof Error ? error.message : error);
    process.exitCode = 2;
}
finally { clearTimeout(deadline); }
