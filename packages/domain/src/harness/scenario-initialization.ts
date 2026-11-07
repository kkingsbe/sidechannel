import type { ExperimentConfig, Json } from '@sidechannel/contracts/harness/contracts';

/** The installed fixture-v1 scenario starts with an empty state; tool execution stays in the worker. */
export const initializeFixtureScenario = (_config: ExperimentConfig): Json => ({});
