import type { Db } from 'mongodb';
import type { RunPurgeReport, RunRecordPurger } from '@sidechannel/contracts/harness/run-lifecycle';

/**
 * One Mastra collection and how a run reaches its rows. The experiment worker names Mastra memory
 * threads and agents from `JSON.stringify([runId, agentId])` (experiment-worker/src/harness/mastra-adapter.ts),
 * so every row of a run shares the prefix `<label>["<runId>",`. Mastra owns these collections' schema;
 * only the key fields below are relied on.
 */
export interface MastraRunRecords { collection: string; field: string; label: string }

export const MASTRA_RUN_RECORDS: readonly MastraRunRecords[] = [
    { collection: 'mastra_threads', field: 'id', label: 'experiment-thread:' },
    { collection: 'mastra_messages', field: 'thread_id', label: 'experiment-thread:' },
    { collection: 'mastra_resources', field: 'id', label: 'experiment-resource:' },
    { collection: 'mastra_ai_spans', field: 'rootEntityId', label: 'experiment-' },
];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `["<runId>",` exactly as `JSON.stringify([runId, agentId])` begins, so a run ID never prefixes another run's rows. */
const runPrefix = (label: string, runId: string) => label + JSON.stringify([runId]).slice(0, -1) + ',';

/**
 * Removes a deleted run's private memory (threads, messages, working memory stored on the thread,
 * resources) and its model-call traces from the Mastra database (`MASTRA_DB_NAME`, normally
 * `sidechannel_mastra`). Deleting nothing is not an error: the purge is idempotent.
 */
export class MongoMastraRunPurger implements RunRecordPurger {
    constructor(private readonly db: Db, private readonly records: readonly MastraRunRecords[] = MASTRA_RUN_RECORDS) { }
    async purgeRunRecords(runId: string): Promise<RunPurgeReport> {
        const report: RunPurgeReport = {};
        for (const { collection, field, label } of this.records) {
            const result = await this.db.collection(collection).deleteMany({ [field]: { $regex: '^' + escapeRegExp(runPrefix(label, runId)) } });
            report[collection] = result.deletedCount;
        }
        return report;
    }
}
