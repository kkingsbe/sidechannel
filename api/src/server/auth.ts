import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { HttpError } from './errors.js';

/** Optional bearer token; comparison is length-checked then timing-safe. */
export function requireToken(req: IncomingMessage, token?: string): void {
    if (!token) return;
    const actual = Buffer.from(req.headers.authorization || ''), expected = Buffer.from('Bearer ' + token);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new HttpError(401, 'Researcher access token required');
}

/** Writes from another origin are rejected; same-host http and https are accepted. */
export function requireSameOrigin(req: IncomingMessage): void {
    const method = req.method ?? 'GET';
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return;
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) throw new HttpError(403, 'Cross-origin writes are forbidden');
}
