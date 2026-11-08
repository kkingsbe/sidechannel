import { AnalysisNotFound, AnalysisValidation, type AnalysisRepository } from '@sidechannel/contracts/analysis/jev-repository';
import type { ReviewStore } from '@sidechannel/contracts/analysis/review-repository';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { computeDisagreements, computeValidation, loadValidationInput, DEFAULT_VALIDATION_CONFIG, type ValidationConfig } from '@sidechannel/domain/analysis/validation';

function decode(value: string): string {
    try { const id = decodeURIComponent(value); if (!id || id.length > 200) throw new Error(); return id; }
    catch { throw new AnalysisValidation('Invalid encoded resource ID'); }
}

/**
 * Validation loop endpoints (v2 spec section 10), relative to `/jev`:
 * `GET /codebooks/:id/validation?model=` and `GET /codebooks/:id/disagreements?model=&codeId=&limit=`.
 * Both evaluate the codebook's current revision against the analyses that froze it under `model`.
 */
export function createValidationRouteHandler(repository: Pick<AnalysisRepository, 'getCodebook' | 'getRevision' | 'listAllJobs' | 'listResults'>, reviews: ReviewStore, config: ValidationConfig = DEFAULT_VALIDATION_CONFIG): ResearchRouteHandler {
    return async request => {
        const match = request.path.match(/^\/codebooks\/([^/]+)\/(validation|disagreements)$/);
        if (!match || request.method !== 'GET') return null;
        const id = decode(match[1]!), model = request.query.get('model');
        if (!model?.trim() || model.length > 200) throw new AnalysisValidation('model is required');
        const book = await repository.getCodebook(id); if (!book) throw new AnalysisNotFound('Codebook not found');
        const revision = await repository.getRevision(id, book.currentRevisionId); if (!revision) throw new AnalysisNotFound('Codebook revision not found');
        const codeIds = revision.definitions.filter(d => d.enabled && !d.archived).map(d => d.id);
        if (match[2] === 'validation') {
            const input = await loadValidationInput(repository, reviews, revision.id, model, codeIds);
            return { status: 200, data: { codebookId: id, definitionRevision: revision.id, model, thresholds: config, items: computeValidation(input, config) } };
        }
        const codeId = request.query.get('codeId');
        if (!codeId || !codeIds.includes(codeId)) throw new AnalysisValidation('codeId must name an enabled code in the current revision');
        const limit = Number(request.query.get('limit') ?? 50);
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new AnalysisValidation('limit must be an integer from 1 to 500');
        const input = await loadValidationInput(repository, reviews, revision.id, model, [codeId]);
        return { status: 200, data: { codebookId: id, definitionRevision: revision.id, model, ...computeDisagreements(input, codeId, limit) } };
    };
}
