import type { CodeValidation } from '@sidechannel/contracts/browser';
import type { Requester } from '../transport';
import { withQuery } from '../transport';

/** `CodeValidation` plus the F1-optimal operating point and the windows whose reviewers split (spec section 9.3). */
export interface CodeValidationMetrics extends CodeValidation {
    fixed: { threshold: number; precision: number | null; recall: number | null; f1: number | null };
    optimal: { threshold: number; precision: number | null; recall: number | null; f1: number | null } | null;
    contested: number;
}

export interface ValidationReport { codebookId: string; definitionRevision: string; model: string; items: CodeValidationMetrics[] }

export interface DisagreementRow { analysisId: string; windowId: string; codeId: string; score: number; label: 0 | 1; gap: number; decisions: { reviewer: string; decision: string }[] }

export interface DisagreementReport { codebookId: string; definitionRevision: string; model: string; codeId: string; modelHighHumanAbsent: DisagreementRow[]; modelLowHumanPresent: DisagreementRow[] }

/** These routes are not translated by the Jev adapter, so the canonical `/jev` prefix is explicit. */
export const validationPaths = {
    validation: (codebookId: string, model: string) => withQuery('/jev/codebooks/' + encodeURIComponent(codebookId) + '/validation', { model }),
    disagreements: (codebookId: string, model: string, codeId: string, limit?: number) => withQuery('/jev/codebooks/' + encodeURIComponent(codebookId) + '/disagreements', { model, codeId, limit }),
};

export interface ValidationClient {
    paths: typeof validationPaths;
    validation(codebookId: string, model: string): Promise<ValidationReport>;
    disagreements(codebookId: string, model: string, codeId: string, limit?: number): Promise<DisagreementReport>;
}

export function createValidationClient(request: Requester): ValidationClient {
    return {
        paths: validationPaths,
        validation: (codebookId, model) => request(validationPaths.validation(codebookId, model)),
        disagreements: (codebookId, model, codeId, limit) => request(validationPaths.disagreements(codebookId, model, codeId, limit)),
    };
}
