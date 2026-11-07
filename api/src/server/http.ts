import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { DraftMetadata } from '@sidechannel/contracts/harness/repository';
import { HttpError } from './errors.js';

/** Core and Jev request cap. Review routes pass their own, smaller limit. */
export const DEFAULT_BODY_LIMIT = 2_000_000;

export function applySecurityHeaders(res: ServerResponse): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
    return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}

async function sendNdjson(res: ServerResponse, status: number, records: AsyncIterable<unknown>, headers: Record<string, string>): Promise<void> {
    res.writeHead(status, { 'Content-Type': 'application/x-ndjson; charset=utf-8', ...headers });
    async function* lines() { for await (const record of records) yield JSON.stringify(record) + '\n'; }
    await pipeline(Readable.from(lines()), res);
}

/** JSON, or NDJSON when `data` is async iterable. */
export async function send(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}): Promise<void> {
    if (isAsyncIterable(data)) return sendNdjson(res, status, data, headers);
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function limitLabel(limit: number): string {
    return limit % 1_000_000 === 0 ? `${limit / 1_000_000} MB` : `${Math.round(limit / 1000)} KB`;
}

/** One body reader for every route: reads lazily, caches the parsed object, enforces `limit` bytes. */
export function requestBody(req: IncomingMessage): (limit?: number) => Promise<Record<string, unknown>> {
    let parsed: Promise<Record<string, unknown>> | undefined;
    return (limit = DEFAULT_BODY_LIMIT) => parsed ??= readJsonObject(req, limit);
}

async function readJsonObject(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of req) { const value = Buffer.from(chunk); bytes += value.length; if (bytes > limit) throw new HttpError(413, `Request exceeds ${limitLabel(limit)}`); chunks.push(value); }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text) return {};
    try {
        const value: unknown = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        return value as Record<string, unknown>;
    } catch { throw new HttpError(400, 'Expected a JSON object'); }
}

export function cursor(value: string | null, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
    const n = value === null ? fallback : Number(value);
    if (!Number.isSafeInteger(n) || n < 0 || n > max) throw new HttpError(400, 'Invalid pagination cursor or limit');
    return n;
}

export function positiveLimit(limit: number): number {
    if (!limit) throw new HttpError(400, 'limit must be positive');
    return limit;
}

export function idempotencyKey(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 160) throw new HttpError(400, 'A nonempty idempotencyKey (maximum 160 characters) is required');
    return value;
}

export function draftMetadata(value: Record<string, unknown>): DraftMetadata {
    const result: DraftMetadata = {};
    for (const key of ['name', 'notes', 'groupId'] as const) if (value[key] !== undefined) {
        if (typeof value[key] !== 'string' || value[key].length > 20000) throw new HttpError(400, `Invalid ${key}`);
        result[key] = value[key] as string;
    }
    return result;
}
