import { randomUUID } from 'node:crypto';
import { DomainFailure } from '@sidechannel/contracts/errors';
import { MONITOR_VIEWS, type MonitorPreview, type MonitorSettings } from '@sidechannel/contracts/oversight/contracts';
import type { MonitorStore } from '@sidechannel/contracts/oversight/blob-store';
import { buildProjection, digest } from './projections.js';
import { currentDefinition } from './definition.js';
import { readEvents, type OversightSource } from './events.js';
import { previewInput } from './schemas.js';

export async function createMonitorPreview(repository: OversightSource, store: MonitorStore, input: unknown): Promise<MonitorPreview> {
    const parsed = previewInput.parse(input);
    const definition = await currentDefinition(store);
    if (definition.revision !== parsed.definitionRevision) throw new DomainFailure('conflict', 'Monitor definition changed. Reload before previewing.');
    const settings: MonitorSettings = { model: parsed.model, maxInputChars: parsed.maxInputChars, contextWindowTokens: parsed.contextWindowTokens,
        outputAllowanceTokens: parsed.outputAllowanceTokens, timeoutMs: parsed.timeoutMs };
    settings.model.settings.maxOutputTokens ??= settings.outputAllowanceTokens;
    if (Number(settings.model.settings.maxOutputTokens) > settings.outputAllowanceTokens || settings.outputAllowanceTokens >= settings.contextWindowTokens)
        throw new DomainFailure('invalid', 'Output token setting must fit the output allowance, which must be smaller than the context window.');
    if (parsed.runIds.length !== new Set(parsed.runIds).size) throw new DomainFailure('invalid', 'Select each source run once');
    const runs: MonitorPreview['runs'] = [];
    for (const runId of parsed.runIds) {
        const run = await repository.getRun(runId);
        if (!run) throw new DomainFailure('not-found', `Run ${runId} not found`);
        if (run.status !== 'completed') throw new DomainFailure('invalid', `Run ${runId} must be completed before oversight`);
        const events = await readEvents(repository, runId);
        runs.push({ runId, projections: MONITOR_VIEWS.map(view => buildProjection(run, events, view, definition, settings)) });
    }
    const preview: MonitorPreview = { schemaVersion: 1, revision: 1, id: randomUUID(), createdAt: new Date().toISOString(), definition, settings, runs,
        hash: digest({ definition, settings, runs: runs.map(run => ({ runId: run.runId, hashes: run.projections.map(projection => projection.hash) })) }) };
    // Exact previews exceed Mongo's document limit. The blob port keeps lossless bounded parts and
    // publishes the manifest last, so a crash never leaves a readable partial preview.
    await store.putBlob({ id: preview.id, createdAt: preview.createdAt, text: JSON.stringify(preview) });
    return preview;
}

export async function getMonitorPreview(store: MonitorStore, id: string): Promise<MonitorPreview | null> {
    const blob = await store.getBlob(id);
    if (!blob) return null;
    if (!blob.complete) throw new DomainFailure('unavailable', 'Frozen monitor preview part is missing');
    if (digest(blob.text) !== blob.manifest.contentHash) throw new DomainFailure('unavailable', 'Frozen monitor preview integrity check failed');
    return JSON.parse(blob.text) as MonitorPreview;
}
