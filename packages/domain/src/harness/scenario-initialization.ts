import type { ExperimentConfig, Json } from '@sidechannel/contracts/harness/contracts';
import { initializeFixtureScenario as fixtureInitialize, scenarioDescriptor } from '../scenarios/index.js';

/** The installed fixture-v1 scenario starts with an empty state; tool execution stays in the worker. */
export const initializeFixtureScenario = fixtureInitialize;

export const isInstalledScenarioVersion = (version: string): boolean => scenarioDescriptor(version) !== undefined;

export function initializeInstalledScenario(config: ExperimentConfig): Json {
    const descriptor = scenarioDescriptor(config.scenario.version);
    if (!descriptor) throw new Error(`Scenario runtime unavailable: ${config.scenario.version}`);
    return descriptor.scenario.initialize(config);
}

export function initialScenarioArtifact(config: ExperimentConfig): Json {
    const descriptor = scenarioDescriptor(config.scenario.version);
    if (!descriptor) throw new Error(`Scenario runtime unavailable: ${config.scenario.version}`);
    return descriptor.scenario.initialArtifact?.(config) ?? [];
}
