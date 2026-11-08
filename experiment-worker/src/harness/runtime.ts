import { MongoRepository } from '@sidechannel/persistence/harness/repository';
import { createMongoMemory, MastraModelAdapter, MastraPrivateMemory } from './mastra-adapter.js';
import { ScriptedAdapter, scriptedDriver } from './scripted-adapter.js';
import { HarnessScheduler } from './scheduler.js';
import type { Run } from '@sidechannel/contracts/harness/contracts';
import type { ModelAdapter, Scenario } from '@sidechannel/contracts/harness/server';
import { providerProfile } from '@sidechannel/domain/providers';
import { interpretPlaybook } from '@sidechannel/domain/playbook/interpreter';
import { validatePlaybook } from '@sidechannel/domain/playbook/package';
import { FIXTURE_SCENARIO_VERSION, scenarioDescriptor } from '@sidechannel/domain/scenarios';
import { openTraceRuntime, type TraceRuntime } from '../mastra/index.js';
import type { WorkerDeps } from '../worker.js';

export const defaultMongoUri = 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0';

/** Composition root: the only experiment-worker module that may name a concrete adapter. */
export interface WorkerRuntime extends WorkerDeps { scheduler(run: Run): HarnessScheduler; readonly memory: MastraPrivateMemory }

/**
 * Re-validates an embedded playbook through the provider profile's `validateModel` hook, which
 * re-checks the id, version, embedded content hash and the playbook's cross-checks against the
 * frozen configuration. The browser only selects an id/version; server-embedded content wins.
 */
function embeddedPlaybookAdapter(config: Run['config'], validateModel?: (config: Run['config']) => string[]): ModelAdapter {
    const errors = validateModel?.(config) ?? [];
    if (errors.length) throw new Error(errors[0]!);
    const validated = validatePlaybook(config.model.settings.playbook);
    return new ScriptedAdapter(interpretPlaybook(validated.playbook));
}

/**
 * Scenario and adapter selection straight from the registries: the scenario descriptor supplies
 * the scenario, the provider profile's `adapterKind` supplies the transport. A new scenario or
 * provider needs registry data only — never an edit here.
 */
export function runtimePlugins(config: Run['config']): { scenario: Scenario; adapter?: ModelAdapter } {
    const descriptor = scenarioDescriptor(config.scenario.version);
    if (!descriptor) throw new Error(`Scenario runtime unavailable: ${config.scenario.version}`);
    const profile = providerProfile(config.model.provider);
    switch (profile.adapterKind) {
        case 'embedded-playbook':
            return { scenario: descriptor.scenario, adapter: embeddedPlaybookAdapter(config, profile.validateModel) };
        case 'scripted':
            if (descriptor.scriptedDriverId && config.model.id !== descriptor.scriptedDriverId)
                throw new Error('Scripted model does not match the selected scenario');
            // Scripted scenarios without their own driver keep the historical fixture behaviour.
            return { scenario: descriptor.scenario, adapter: new ScriptedAdapter(scriptedDriver(descriptor.scriptedDriverId ?? FIXTURE_SCENARIO_VERSION)) };
        default:
            // Mastra-hosted providers: `openRuntime` supplies the trace-backed adapter.
            return { scenario: descriptor.scenario };
    }
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
