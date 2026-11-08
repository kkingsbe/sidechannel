import { DomainFailure } from '@sidechannel/contracts/errors';
import type { MonitorStore } from '@sidechannel/contracts/oversight/blob-store';
import type { MonitorEvaluation } from '@sidechannel/contracts/oversight/contracts';
import { buildProjection, digest } from './projections.js';
import { currentDefinition } from './definition.js';
import { readEvents, type OversightSource } from './events.js';
import { getMonitorPreview } from './preview.js';
import { launchInput } from './schemas.js';

export async function launchMonitor(repository: OversightSource, store: MonitorStore, input: unknown): Promise<MonitorEvaluation> {
    const parsed = launchInput.parse(input), id = `monitor-${digest(parsed.idempotencyKey)}`;
    const existing = await store.get<MonitorEvaluation>('monitor_evaluations', id);
    if (existing) {
        if (existing.previewId !== parsed.previewId || existing.previewHash !== parsed.previewHash) throw new DomainFailure('conflict', 'Launch key is already bound to another preview');
        return existing;
    }
    const preview = await getMonitorPreview(store, parsed.previewId);
    if (!preview) throw new DomainFailure('not-found', 'Preview not found');
    if (preview.hash !== parsed.previewHash) throw new DomainFailure('conflict', 'Preview hash mismatch');
    if ((await currentDefinition(store)).revision !== preview.definition.revision) throw new DomainFailure('conflict', 'Monitor definition changed since preview. Preview again.');
    for (const source of preview.runs) {
        const run = await repository.getRun(source.runId);
        if (!run || run.status !== 'completed') throw new DomainFailure('conflict', `Source run ${source.runId} is no longer completed`);
        const events = await readEvents(repository, source.runId);
        for (const projection of source.projections)
            if (buildProjection(run, events, projection.view, preview.definition, preview.settings).hash !== projection.hash)
                throw new DomainFailure('conflict', `Evidence changed for ${source.runId}. Preview again.`);
    }
    const now = new Date().toISOString();
    const evaluation: MonitorEvaluation = { schemaVersion: 1, id, revision: 1, createdAt: now, updatedAt: now,
        idempotencyKey: parsed.idempotencyKey, previewId: preview.id, previewHash: preview.hash,
        definition: preview.definition, settings: preview.settings, runIds: preview.runs.map(run => run.runId), status: 'queued', cancelRequested: false,
        results: preview.runs.flatMap(run => run.projections.map(projection => ({ runId: run.runId, view: projection.view,
            status: projection.status === 'oversized' ? 'oversized' as const : 'pending' as const,
            projectionHash: projection.hash, judgments: [], ...(projection.reason ? { error: projection.reason } : {}) }))) };
    if (!await store.insert('monitor_evaluations', evaluation)) return launchMonitor(repository, store, input);
    return evaluation;
}
