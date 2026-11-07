import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, extname, isAbsolute } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from './errors.js';

const MIME_TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

/** Serves the built dashboard: traversal defence, SPA deep-link fallback and MIME map. */
export async function serveDashboard(req: IncomingMessage, res: ServerResponse, pathname: string, directory: string): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    let decoded: string;
    try { decoded = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'Invalid path encoding'); }
    if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(part => part === '..' || part.startsWith('.'))) throw new HttpError(404, 'Not found');
    const root = await realpath(directory), requested = resolve(root, '.' + decoded), rel = relative(root, requested);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new HttpError(404, 'Not found');
    let asset = requested;
    try { if (!(await stat(asset)).isFile()) throw new Error(); }
    catch { if (extname(decoded)) throw new HttpError(404, 'Asset not found'); asset = resolve(root, 'index.html'); }
    const actual = await realpath(asset), assetRelative = relative(root, actual);
    if (assetRelative.startsWith('..') || isAbsolute(assetRelative)) throw new HttpError(404, 'Not found');
    res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(asset)] ?? 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(asset));
}
