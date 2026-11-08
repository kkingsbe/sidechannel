import { MongoRepository } from '@sidechannel/persistence/harness/repository';

/**
 * Pre-update hook for the image updater (WUD `wud.hook.*` labels in compose.portainer.yaml).
 * Replacing the worker cancels the run it is executing, and a queued run would execute on a
 * different build than its already-finished pair partner. Exit codes: 0 = idle, safe to
 * replace; 1 = runs queued or active, defer; 2 = state unknown, defer (fails closed).
 */
export const UPDATE_BLOCKING_RUN_STATUSES = ['queued', 'running', 'reporting', 'stopping'];

const deadline = setTimeout(() => { console.error('update-guard: timed out checking runs; deferring update'); process.exit(2); }, 20_000);

try {
    const repository = await MongoRepository.connect(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0', process.env.MONGODB_DB_NAME ?? 'sidechannel');
    try {
        const busy = await repository.db.collection('runs').find({ status: { $in: UPDATE_BLOCKING_RUN_STATUSES } }, { projection: { _id: 0, id: 1, status: 1 } }).toArray();
        if (busy.length) {
            console.error(`update-guard: deferring update; ${busy.length} run(s) in progress: ${busy.map(run => `${run.id} (${run.status})`).join(', ')}`);
            process.exitCode = 1;
        }
        else console.log('update-guard: no runs queued or active; update may proceed');
    }
    finally { await repository.close(); }
}
catch (error) {
    console.error('update-guard: could not check runs; deferring update:', error instanceof Error ? error.message : error);
    process.exitCode = 2;
}
finally { clearTimeout(deadline); }
