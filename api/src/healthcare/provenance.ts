import type { Run } from '@sidechannel/contracts/harness/contracts';
import type { Repository } from '@sidechannel/contracts/harness/server';
import { HEALTHCARE_SCENARIO_VERSION } from '@sidechannel/contracts/healthcare/contracts';
import type { HealthcareCatalog } from '@sidechannel/contracts/healthcare/repository';
import { HEALTHCARE_EVALUATOR_VERSION } from '@sidechannel/domain/healthcare/evaluation';
import { healthcareRouteHandler } from './routes.js';

/** Freeze the dataset identity a run was launched against, before the run is queued. */
export async function freezeHealthcareReference(catalog: HealthcareCatalog, run: Run): Promise<void> {
    if (run.config.scenario.version !== HEALTHCARE_SCENARIO_VERSION) return;
    const dataset = await catalog.runtime(run.config.scenario.datasetId, run.config.scenario.datasetVersion);
    if (!dataset) throw new Error('Healthcare dataset unavailable');
    await catalog.freezeReference({ runId: run.id, datasetId: dataset.item.datasetId, datasetVersion: dataset.item.datasetVersion,
        packageHash: dataset.item.packageHash, assetsHash: dataset.item.assetsHash, truthHash: dataset.truthHash,
        scoringVersion: dataset.assets.public.scoring_version, evaluatorVersion: HEALTHCARE_EVALUATOR_VERSION });
}

/** Researcher-only export envelope; the evaluation itself is served by the same route handler. */
export async function healthcareResearcherExport(catalog: HealthcareCatalog, repository: Pick<Repository, 'getRun'>, run: Run) {
    if (run.config.scenario.version !== HEALTHCARE_SCENARIO_VERSION) return undefined;
    const response = await healthcareRouteHandler(catalog, repository)({ method: 'GET', path: `/runs/${encodeURIComponent(run.id)}/evaluation`,
        query: new URLSearchParams(), body: async () => ({}) });
    return { scope: 'researcher-only', evaluatorReference: await catalog.getReference(run.id),
        evaluation: response?.data ?? { status: 'unavailable', reason: 'No evaluation available' } };
}
