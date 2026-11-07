import { MongoRepository } from '@sidechannel/persistence/harness/repository';
import { createMongoMemory, MastraModelAdapter, MastraPrivateMemory } from './mastra-adapter.js';
import { ScriptedAdapter, scriptedDriver } from './scripted-adapter.js';
import { HarnessScheduler } from './scheduler.js';
import type { Run } from '@sidechannel/contracts/harness/contracts';
import type { ModelAdapter, Scenario } from '@sidechannel/contracts/harness/server';
import { providerProfile } from '@sidechannel/domain/providers';
import { FIXTURE_SCENARIO_VERSION, scenarioDescriptor } from '@sidechannel/domain/scenarios';
import { openTraceRuntime, type TraceRuntime } from '../mastra/index.js';
import type { WorkerDeps } from '../worker.js';

export const defaultMongoUri = 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0';

/** Composition root: the only experiment-worker module that may name a concrete adapter. */
export interface WorkerRuntime extends WorkerDeps { scheduler(run: Run): HarnessScheduler; readonly memory: MastraPrivateMemory }

/**
 * Scenario and driver selection straight from the registries. A new scenario needs a
 * descriptor plus (optionally) a scripted driver id — never an edit here.
 */
export function runtimePlugins(config: Run['config']): { scenario: Scenario; adapter?: ModelAdapter } {
    const descriptor = scenarioDescriptor(config.scenario.version);
    if (!descriptor) throw new Error(`Scenario runtime unavailable: ${config.scenario.version}`);
    const profile = providerProfile(config.model.provider);
    if (descriptor.scriptedDriverId && profile.fixture && config.model.id !== descriptor.scriptedDriverId)
        throw new Error('Scripted model does not match the selected scenario');
    // Fixture providers always need a scripted driver; scenarios without their own driver keep
    // the historical fixture behaviour (any scripted model id is accepted for the fixture scenario).
    const driverId = descriptor.scriptedDriverId ?? FIXTURE_SCENARIO_VERSION;
    return { scenario: descriptor.scenario, ...(profile.fixture ? { adapter: new ScriptedAdapter(scriptedDriver(driverId)) } : {}) };
}

export async function openRuntime(): Promise<WorkerRuntime> {
    const uri = process.env.MONGODB_URI ?? defaultMongoUri;
    const repository = await MongoRepository.connect(uri, process.env.MONGODB_DB_NAME ?? 'sidechannel');
    const memory = createMongoMemory(uri, process.env.MASTRA_DB_NAME ?? 'sidechannel_mastra');
    const trace: TraceRuntime = openTraceRuntime(uri, process.env.MASTRA_DB_NAME ?? 'sidechannel_mastra');
    return {
        queue: repository, guard: repository, runState: repository, events: repository, memory,
        scheduler(run: Run) {
            const plugins = runtimePlugins(run.config);
            return new HarnessScheduler({ runState: repository, events: repository,
                scenario: plugins.scenario,
                memory: new MastraPrivateMemory(memory.storage, run.config.memory.template),
                adapter: plugins.adapter ?? new MastraModelAdapter(trace),
            });
        },
        flush: () => trace.flush(),
        async close() { await trace.close(); await repository.close(); await memory.storage.close(); },
    };
}
