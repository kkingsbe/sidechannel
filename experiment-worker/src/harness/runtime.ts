import { MongoRepository } from '@sidechannel/persistence/harness/repository';
import { createMongoMemory, MastraModelAdapter, MastraPrivateMemory } from './mastra-adapter.js';
import { fixtureScript, ScriptedAdapter } from './scripted-adapter.js';
import { healthcareScript } from './healthcare-script.js';
import { healthcareScenario } from './healthcare-scenario.js';
import { fixtureScenario } from './scenario.js';
import { HEALTHCARE_SCENARIO_VERSION } from '@sidechannel/contracts/healthcare/contracts';
import { HarnessScheduler } from './scheduler.js';
import type { Run } from '@sidechannel/contracts/harness/contracts';
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
            const healthcare = run.config.scenario.version === HEALTHCARE_SCENARIO_VERSION;
            if (!healthcare && run.config.scenario.version !== 'fixture-v1')
                throw new Error(`Scenario runtime unavailable: ${run.config.scenario.version}`);
            if (healthcare && run.config.model.provider === 'scripted' && run.config.model.id !== HEALTHCARE_SCENARIO_VERSION)
                throw new Error('Scripted model does not match the selected scenario');
            return new HarnessScheduler({ repository,
                scenario: healthcare ? healthcareScenario : fixtureScenario,
                memory: new MastraPrivateMemory(memory.storage, run.config.memory.template),
                adapter: run.config.model.provider === 'scripted' ? new ScriptedAdapter(healthcare ? healthcareScript : fixtureScript) : new MastraModelAdapter(),
            });
        },
        flush: flushExperimentTraces,
        async close() { await closeExperimentRuntime(); await repository.close(); await memory.storage.close(); },
    };
}
