import type { ExperimentConfig, Json } from '@sidechannel/contracts/harness/contracts';
import { HEALTHCARE_SCENARIO_VERSION } from '@sidechannel/contracts/healthcare/contracts';

/** The installed fixture-v1 scenario starts with an empty state; tool execution stays in the worker. */
export const initializeFixtureScenario = (_config: ExperimentConfig): Json => ({});

export const isInstalledScenarioVersion = (version: string): boolean => version === 'fixture-v1' || version === HEALTHCARE_SCENARIO_VERSION;

export function initializeInstalledScenario(config: ExperimentConfig): Json {
    if (!isInstalledScenarioVersion(config.scenario.version))
        throw new Error(`Scenario runtime unavailable: ${config.scenario.version}`);
    return {};
}

export function initialScenarioArtifact(config: ExperimentConfig): Json {
    if (!isInstalledScenarioVersion(config.scenario.version))
        throw new Error(`Scenario runtime unavailable: ${config.scenario.version}`);
    return config.scenario.version === HEALTHCARE_SCENARIO_VERSION ? { entries: [] } : [];
}
