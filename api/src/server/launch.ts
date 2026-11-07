import { isDeepStrictEqual } from 'node:util';
import type { Run } from '@sidechannel/contracts/harness/contracts';
import type { ResearcherRepository } from '@sidechannel/contracts/server/contracts';
import { resolveConfiguration } from '@sidechannel/domain/harness/config';
import type { HealthcareService } from '../healthcare/service.js';
import type { ConfigurationPipeline } from './configuration.js';
import { HttpError } from './errors.js';

export interface LaunchDependencies {
    repository: Pick<ResearcherRepository, 'getRunByLaunchKey' | 'getDraft' | 'createPair'>;
    pipeline: ConfigurationPipeline;
    healthcare?: HealthcareService;
}

/** Launch-time invariants shared by `/runs` and `/pairs`: draft freezing and idempotency identity. */
export function createLaunchService({ repository, pipeline, healthcare }: LaunchDependencies) {
    async function sourceDraft(input: Record<string, unknown>, runLaunchKey: string, config: unknown): Promise<Run['sourceDraft']> {
        if (input.sourceDraftId === undefined && input.sourceDraftRevision === undefined) return undefined;
        if (typeof input.sourceDraftId !== 'string' || !Number.isSafeInteger(input.sourceDraftRevision) || Number(input.sourceDraftRevision) < 1) throw new HttpError(400, 'Saved draft launches require sourceDraftId and sourceDraftRevision');
        const existing = await repository.getRunByLaunchKey(runLaunchKey);
        if (existing?.sourceDraft?.id === input.sourceDraftId && existing.sourceDraft.revision === input.sourceDraftRevision) return existing.sourceDraft;
        const draft = await repository.getDraft(input.sourceDraftId);
        if (!draft || draft.revision !== input.sourceDraftRevision) throw new HttpError(409, 'Source draft changed; reload and review its current revision');
        const preparedDraft = await pipeline.prepare(draft.config);
        if (!preparedDraft.validation.valid || !isDeepStrictEqual(resolveConfiguration(preparedDraft.config), resolveConfiguration(config))) throw new HttpError(409, 'Launch configuration differs from the selected saved draft');
        const { config: ignored, updatedAt, ...snapshot } = draft;
        return snapshot;
    }
    async function freezeReference(run: Run): Promise<Run> {
        const existing = await repository.getRunByLaunchKey(run.launchKey);
        if (existing) { if (existing.configHash !== run.configHash) throw new HttpError(409, 'Idempotency key conflicts with a different configuration'); run.id = existing.id; }
        await healthcare?.freezeRunReference(run);
        return run;
    }
    return { sourceDraft, freezeReference };
}
