import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ExperimentConfig } from './contracts.js';
/** The working tree may not have a commit yet: fingerprint actual source, not a guessed revision. */
export async function buildMetadata(): Promise<ExperimentConfig['build']> {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const hash = createHash('sha256');
    async function visit(directory: string) {
        for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory())
                await visit(file);
            else {
                hash.update(path.relative(root, file).replaceAll('\\', '/'));
                hash.update(await readFile(file));
            }
        }
    }
    await visit(path.join(root, 'src'));
    hash.update(await readFile(path.join(root, 'package-lock.json')));
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const packages: Record<string, string> = { node: process.version };
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).sort()) {
        packages[name] = JSON.parse(await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
    }
    return { revision: `source-sha256:${hash.digest('hex')}`, packages };
}
