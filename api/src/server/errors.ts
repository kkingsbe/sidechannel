import type { ServerResponse } from 'node:http';
import { AnalysisConflict, AnalysisNotFound, AnalysisPayloadTooLarge, AnalysisValidation } from '@sidechannel/contracts/analysis/jev-repository';
import { DomainFailure, type FailureKind } from '@sidechannel/contracts/errors';
import { RepositoryConflict } from '@sidechannel/contracts/harness/repository';
import { OversightError } from '@sidechannel/domain/oversight/service';

/** Transport-level failure: only the HTTP layer throws this. */
export class HttpError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
}

/** Conventions §3.6 mapping. Unknown failures keep the historical 400 default. */
const STATUS_BY_KIND: Record<FailureKind, number> = { invalid: 400, 'not-found': 404, conflict: 409, 'too-large': 413, unavailable: 503 };

/** Typed mapping only: no `'status' in error` duck typing and no message inspection. */
export function statusOf(error: unknown): number {
    if (error instanceof HttpError) return error.status;
    if (error instanceof DomainFailure) return STATUS_BY_KIND[error.kind];
    if (error instanceof AnalysisConflict || error instanceof AnalysisNotFound || error instanceof AnalysisValidation || error instanceof AnalysisPayloadTooLarge) return error.status;
    if (error instanceof RepositoryConflict) return error.status;
    if (error instanceof OversightError) return error.status;
    return 400;
}

export function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : 'Request failed';
}

/** The single error boundary: JSON for normal responses, one trailing NDJSON record for streams. */
export async function sendFailure(res: ServerResponse, error: unknown): Promise<void> {
    if (res.headersSent) {
        // Stream failures keep their historical fallback text; the generator owns everything already written.
        if (!res.destroyed) res.end(JSON.stringify({ type: 'export_error', error: error instanceof Error ? error.message : 'Export incomplete', complete: false }) + '\n');
        return;
    }
    res.writeHead(statusOf(error), { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: messageOf(error) }));
}
