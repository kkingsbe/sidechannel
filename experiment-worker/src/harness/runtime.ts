import { MongoRepository } from '@sidechannel/persistence/harness/repository';
import { createMongoMemory, MastraModelAdapter, MastraPrivateMemory } from './mastra-adapter.js';
import { fixtureScript, ScriptedAdapter } from './scripted-adapter.js';
import { healthcareScript } from './healthcare-script.js';
import { healthcareScenario } from './healthcare-scenario.js';
import { fixtureScenario } from './scenario.js';
import { HEALTHCARE_SCENARIO_VERSION } from '@sidechannel/contracts/healthcare/contracts';
import { PLAYBOOK_PROVIDER } from '@sidechannel/contracts/playbook/contracts';
import { interpretPlaybook } from '@sidechannel/domain/playbook/interpreter';
import { validatePlaybook, validatePlaybookForConfig } from '@sidechannel/domain/playbook/package';
import { HarnessScheduler } from './scheduler.js';
import type { ModelAdapter } from '@sidechannel/contracts/harness/server';
import type { Run } from '@sidechannel/contracts/harness/contracts';
import { configureExperimentRuntime, closeExperimentRuntime, flushExperimentTraces } from '../mastra/index.js';

export const defaultMongoUri = 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0';

/** Chooses the model adapter for a run; playbooks are re-validated against their embedded hash and the frozen configuration. */
export function selectAdapter(run: Run): ModelAdapter {
    const { provider, settings } = run.config.model;
    const healthcare = run.config.scenario.version === HEALTHCARE_SCENARIO_VERSION;
    if (provider === PLAYBOOK_PROVIDER) {
        const validated = validatePlaybook(settings.playbook);
        if (settings.playbookHash !== validated.playbookHash) throw new Error('Playbook hash does not match its embedded content');
        const errors = validatePlaybookForConfig(validated.playbook, run.config);
        if (errors.length) throw new Error(`Playbook does not fit this run: ${errors.join('; ')}`);
        return new ScriptedAdapter(interpretPlaybook(validated.playbook));
    }
    return provider === 'scripted' ? new ScriptedAdapter(healthcare ? healthcareScript : fixtureScript) : new MastraModelAdapter();
}

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
                adapter: selectAdapter(run),
            });
        },
        flush: flushExperimentTraces,
        async close() { await closeExperimentRuntime(); await repository.close(); await memory.storage.close(); },
    };
}
