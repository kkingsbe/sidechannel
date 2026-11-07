import type { Repository } from '@sidechannel/contracts/harness/server';
import type { HealthcareCatalog } from '@sidechannel/contracts/healthcare/repository';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { createHealthcarePreset } from '@sidechannel/domain/healthcare/preset';
import { evaluateHealthcareRun } from '@sidechannel/domain/healthcare/evaluation';

/** Dataset, preset, provenance and researcher-evaluation routes. Readiness policy only; no configuration rules. */
export function healthcareRouteHandler(catalog: HealthcareCatalog, repository: Pick<Repository, 'getRun'>): ResearchRouteHandler {
    return async ({ method, path, query }) => {
        if (method === 'GET' && path === '/datasets') return { status: 200, data: await catalog.list() };
        const datasetMatch = path.match(/^\/datasets\/([^/]+)\/(preset|provenance)$/);
        if (method === 'GET' && datasetMatch) {
            const dataset = await catalog.runtime(decodeURIComponent(datasetMatch[1]!), query.get('version') ?? '0.3');
            if (!dataset) return { status: 404, data: { error: 'Dataset not registered or incomplete' } };
            return { status: 200, data: datasetMatch[2] === 'provenance' ? dataset.manifest
                : createHealthcarePreset(dataset.assets, { datasetId: dataset.item.datasetId, datasetVersion: dataset.item.datasetVersion, datasetSeed: dataset.manifest.provenance.seed }) };
        }
        const match = path.match(/^\/runs\/([^/]+)\/evaluation$/);
        if (method === 'GET' && match) {
            const run = await repository.getRun(decodeURIComponent(match[1]!));
            if (!run) return { status: 404, data: { error: 'Run not found' } };
            const reference = await catalog.getReference(run.id);
            if (!reference) return { status: 200, data: { status: 'unavailable', reason: 'No healthcare evaluator reference' } };
            const artifact = run.artifacts.at(-1);
            if (!artifact?.frozen) return { status: 200, data: { status: 'pending', reason: 'Artifact has not been frozen' } };
            if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status)) return { status: 200, data: { status: 'pending', reason: 'Waiting for execution and reports to finish' } };
            try {
                const previous = await catalog.getEvaluation(run.id, artifact.version, reference.evaluatorVersion);
                if (previous) return { status: 200, data: previous };
                const dataset = await catalog.runtime(reference.datasetId, reference.datasetVersion);
                if (!dataset) throw new Error('Frozen dataset unavailable');
                const truth = await catalog.evaluatorTruth(reference);
                return { status: 200, data: await catalog.saveEvaluation(evaluateHealthcareRun(run, dataset.assets, truth, reference)) };
            } catch (error) { return { status: 200, data: { status: 'failed', reason: error instanceof Error ? error.message : 'Evaluator failed' } }; }
        }
        return null;
    };
}
