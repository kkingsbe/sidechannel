import type { ServerResponse } from 'node:http';
import { DomainFailure, type FailureKind } from '@sidechannel/contracts/errors';

/** Transport-level failure: only the HTTP layer throws this. */
export class HttpError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
}

/** Conventions §3.6 mapping. Unknown failures keep the historical 400 default. */
const STATUS_BY_KIND: Record<FailureKind, number> = { invalid: 400, 'not-found': 404, conflict: 409, 'too-large': 413, unavailable: 503 };

/** Typed mapping only: transport failures keep their status, domain failures map by kind. */
export function statusOf(error: unknown): number {
    if (error instanceof HttpError) return error.status;
    if (error instanceof DomainFailure) return STATUS_BY_KIND[error.kind];
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
