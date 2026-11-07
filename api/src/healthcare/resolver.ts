import type { ExperimentConfig } from '@sidechannel/contracts/harness/contracts';
import { HEALTHCARE_SCENARIO_VERSION } from '@sidechannel/contracts/healthcare/contracts';
import type { HealthcareCatalog } from '@sidechannel/contracts/healthcare/repository';

/** Ignore browser assets, seed and hashes; identity is resolved from immutable backend content. */
export async function resolveHealthcareConfiguration(catalog: HealthcareCatalog, input: unknown): Promise<unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
    const config = structuredClone(input) as ExperimentConfig;
    if (config.scenario?.version !== HEALTHCARE_SCENARIO_VERSION) return config;
    const dataset = await catalog.runtime(config.scenario.datasetId, config.scenario.datasetVersion);
    if (!dataset) throw new Error('scenario.datasetId: Select a fully registered healthcare dataset');
    if (!dataset.item.runtimeSupported) throw new Error('scenario.version: Dataset runtime is not installed');
    config.scenario.assets = dataset.assets as unknown as ExperimentConfig['scenario']['assets'];
    config.scenario.datasetSeed = dataset.manifest.provenance.seed;
    return config;
}
