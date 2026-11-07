import { MongoRepository } from './repository.js';
import { createMongoMemory, MastraModelAdapter, MastraPrivateMemory } from './mastra-adapter.js';
import { fixtureScript, ScriptedAdapter } from './scripted-adapter.js';
import { HarnessScheduler } from './scheduler.js';
import type { Run } from './contracts.js';
import { configureExperimentRuntime, closeExperimentRuntime, flushExperimentTraces } from '../mastra/index.js';
export const defaultMongoUri = 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0';
export async function openRuntime() {
    const uri = process.env.MONGODB_URI ?? defaultMongoUri;
    const repository = await MongoRepository.connect(uri, process.env.MONGODB_DB_NAME ?? 'sidechannel');
    const memory = createMongoMemory(uri, process.env.MASTRA_DB_NAME ?? 'sidechannel_mastra');
    configureExperimentRuntime(uri, process.env.MASTRA_DB_NAME ?? 'sidechannel_mastra');
    return {
        repository, memory,
        scheduler(run: Run) {
            if (run.config.scenario.version !== 'fixture-v1')
                throw new Error('Only fixture-v1 is installed; register a scenario before selecting another version');
            return new HarnessScheduler({ repository,
                memory: new MastraPrivateMemory(memory.storage, run.config.memory.template),
                adapter: run.config.model.provider === 'scripted' ? new ScriptedAdapter(fixtureScript) : new MastraModelAdapter(),
            });
        },
        flush: flushExperimentTraces,
        async close() { await closeExperimentRuntime(); await repository.close(); await memory.storage.close(); },
    };
}
