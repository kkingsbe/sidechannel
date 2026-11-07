import type { ExperimentConfig, Run } from '@sidechannel/contracts/harness/contracts';
import { HEALTHCARE_SCENARIO_VERSION } from '@sidechannel/contracts/healthcare/contracts';
import type { HealthcareCatalog } from '@sidechannel/contracts/healthcare/repository';
import type { ResearcherRepository, ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { createHealthcarePreset } from '@sidechannel/domain/healthcare/preset';
import { evaluateHealthcareRun, HEALTHCARE_EVALUATOR_VERSION } from '@sidechannel/domain/healthcare/evaluation';

export class HealthcareService {
    constructor(readonly catalog: HealthcareCatalog) { }
    /** Ignore browser assets, seed and hashes; identity is resolved from immutable backend content. */
    async resolveConfiguration(input: unknown): Promise<unknown> {
        if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
        const config = structuredClone(input) as ExperimentConfig;
        if (config.scenario?.version !== HEALTHCARE_SCENARIO_VERSION) return config;
        const dataset = await this.catalog.runtime(config.scenario.datasetId, config.scenario.datasetVersion);
        if (!dataset) throw new Error('scenario.datasetId: Select a fully registered healthcare dataset');
        if (!dataset.item.runtimeSupported) throw new Error('scenario.version: Dataset runtime is not installed');
        config.scenario.assets = dataset.assets as unknown as ExperimentConfig['scenario']['assets'];
        config.scenario.datasetSeed = dataset.manifest.provenance.seed;
        return config;
    }
    async researcherExport(run: Run, repository: ResearcherRepository) {
        if (run.config.scenario.version !== HEALTHCARE_SCENARIO_VERSION) return undefined;
        const response = await this.routes(repository)({ method: 'GET', path: `/runs/${encodeURIComponent(run.id)}/evaluation`, query: new URLSearchParams(), body: {} });
        return { scope: 'researcher-only', evaluatorReference: await this.catalog.getReference(run.id), evaluation: response?.data ?? { status: 'unavailable', reason: 'No evaluation available' } };
    }
    async freezeRunReference(run: Run): Promise<void> {
        if (run.config.scenario.version !== HEALTHCARE_SCENARIO_VERSION) return;
        const dataset = await this.catalog.runtime(run.config.scenario.datasetId, run.config.scenario.datasetVersion);
        if (!dataset) throw new Error('Healthcare dataset unavailable');
        await this.catalog.freezeReference({ runId: run.id, datasetId: dataset.item.datasetId, datasetVersion: dataset.item.datasetVersion, packageHash: dataset.item.packageHash, assetsHash: dataset.item.assetsHash, truthHash: dataset.truthHash, scoringVersion: dataset.assets.public.scoring_version, evaluatorVersion: HEALTHCARE_EVALUATOR_VERSION });
    }
    routes(repository: ResearcherRepository): ResearchRouteHandler {
        return async ({ method, path, query }) => {
            if (method === 'GET' && path === '/datasets') return { status: 200, data: await this.catalog.list() };
            const datasetMatch = path.match(/^\/datasets\/([^/]+)\/(preset|provenance)$/);
            if (method === 'GET' && datasetMatch) {
                const dataset = await this.catalog.runtime(decodeURIComponent(datasetMatch[1]!), query.get('version') ?? '0.3');
                if (!dataset) return { status: 404, data: { error: 'Dataset not registered or incomplete' } };
                return { status: 200, data: datasetMatch[2] === 'provenance' ? dataset.manifest : createHealthcarePreset(dataset.assets, { datasetId: dataset.item.datasetId, datasetVersion: dataset.item.datasetVersion, datasetSeed: dataset.manifest.provenance.seed }) };
            }
            const match = path.match(/^\/runs\/([^/]+)\/evaluation$/);
            if (method === 'GET' && match) {
                const run = await repository.getRun(decodeURIComponent(match[1]!)); if (!run) return { status: 404, data: { error: 'Run not found' } };
                const reference = await this.catalog.getReference(run.id); if (!reference) return { status: 200, data: { status: 'unavailable', reason: 'No healthcare evaluator reference' } };
                const artifact = run.artifacts.at(-1); if (!artifact?.frozen) return { status: 200, data: { status: 'pending', reason: 'Artifact has not been frozen' } };
                if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status)) return { status: 200, data: { status: 'pending', reason: 'Waiting for execution and reports to finish' } };
                try {
                    const old = await this.catalog.getEvaluation(run.id, artifact.version, reference.evaluatorVersion); if (old) return { status: 200, data: old };
                    const dataset = await this.catalog.runtime(reference.datasetId, reference.datasetVersion); if (!dataset) throw new Error('Frozen dataset unavailable');
                    const truth = await this.catalog.evaluatorTruth(reference);
                    const result = evaluateHealthcareRun(run, dataset.assets, truth, reference);
                    return { status: 200, data: await this.catalog.saveEvaluation(result) };
                } catch (error) { return { status: 200, data: { status: 'failed', reason: error instanceof Error ? error.message : 'Evaluator failed' } }; }
            }
            return null;
        };
    }
}
