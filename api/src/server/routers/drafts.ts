import { randomUUID } from 'node:crypto';
import type { Draft } from '@sidechannel/contracts/harness/repository';
import type { Run } from '@sidechannel/contracts/harness/contracts';
import type { ResearcherRepository, ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { HttpError } from '../errors.js';
import { draftMetadata } from '../http.js';
import type { ConfigurationPipeline } from '../configuration.js';

export interface DraftRoutesContext {
    repository: Pick<ResearcherRepository, 'listDrafts' | 'saveDraft' | 'getDraft' | 'getRun' | 'listRuns'>;
    pipeline: ConfigurationPipeline;
}

const DUPLICATE = /^\/(drafts|runs|pairs)\/([^/]+)\/duplicate$/;

/** Draft CRUD plus the cross-resource duplication endpoint (it always produces a draft). */
export function createDraftsRouter({ repository, pipeline }: DraftRoutesContext): ResearchRouteHandler {
    return async request => {
        const { method, path } = request;
        if (path === '/drafts' && method === 'GET') return { status: 200, data: await repository.listDrafts() };
        if (path === '/drafts' && method === 'POST') {
            const input = await request.body();
            if (input.config === undefined) throw new HttpError(400, 'config is required');
            const id = typeof input.id === 'string' && input.id.trim() ? input.id : randomUUID();
            if (input.revision !== undefined && (!Number.isSafeInteger(input.revision) || Number(input.revision) < 0)) throw new HttpError(400, 'revision must be a nonnegative integer');
            const draft = await repository.saveDraft(id, input.config, input.revision as number | undefined, draftMetadata(input));
            return { status: 200, data: { ...draft, validation: pipeline.validate(draft.config) } };
        }
        const duplicate = path.match(DUPLICATE);
        if (duplicate && method === 'POST') {
            const input = await request.body(), sourceType = duplicate[1]!.slice(0, -1) as 'draft' | 'run' | 'pair', sourceId = decodeURIComponent(duplicate[2]!);
            const source = sourceType === 'draft' ? await repository.getDraft(sourceId) : sourceType === 'run' ? await repository.getRun(sourceId) : (await repository.listRuns()).find(run => run.pairId === sourceId);
            if (!source) throw new HttpError(404, 'Duplication source not found');
            const inherited = 'revision' in source ? draftMetadata(source as unknown as Record<string, unknown>) : source.sourceDraft ? draftMetadata(source.sourceDraft as unknown as Record<string, unknown>) : {};
            const draft = await repository.saveDraft(randomUUID(), (source as Draft | Run).config, undefined, { ...inherited, ...draftMetadata(input), lineage: { sourceType, sourceId, ...('revision' in source ? { sourceRevision: source.revision } : {}) } });
            return { status: 201, data: { ...draft, validation: pipeline.validate(draft.config) } };
        }
        if (path.startsWith('/drafts/') && method === 'GET') {
            const draft = await repository.getDraft(decodeURIComponent(path.slice(8)));
            if (!draft) throw new HttpError(404, 'Draft not found');
            return { status: 200, data: { ...draft, validation: pipeline.validate(draft.config) } };
        }
        return null;
    };
}
