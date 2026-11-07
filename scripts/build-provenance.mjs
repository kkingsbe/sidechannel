import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Fingerprint actual source and the dependency lock, never a guessed Git revision.
// Generate outside TypeScript so runtime images need neither source nor build tools.
const root = fileURLToPath(new URL('../', import.meta.url));
const projects = ['api', 'experiment-worker', 'analysis-worker', 'dashboard', 'packages/contracts', 'packages/domain', 'packages/persistence'];
const hash = createHash('sha256');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
async function add(file) {
    hash.update(path.relative(root, file).replaceAll('\\', '/'));
    hash.update(await readFile(file));
}
async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => compare(a.name, b.name))) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(file);
        else await add(file);
    }
}
const dependencies = new Set();
for (const project of projects) {
    const manifestPath = path.join(root, project, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    for (const name of Object.keys(manifest.dependencies ?? {})) dependencies.add(name);
    await add(manifestPath);
    await visit(path.join(root, project, 'src'));
}
await add(path.join(root, 'package-lock.json'));
await add(fileURLToPath(import.meta.url));
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const packages = {};
for (const name of [...dependencies].sort(compare)) {
    if (name.startsWith('@sidechannel/')) continue;
    const entries = Object.entries(lock.packages).filter(([location]) => location.endsWith(`node_modules/${name}`));
    const versions = [...new Set(entries.map(([, entry]) => entry.version))].sort(compare);
    if (!versions.length || versions.some(version => typeof version !== 'string')) throw new Error(`Missing locked dependency: ${name}`);
    packages[name] = versions.join(',');
}
const output = path.join(root, 'packages/domain/dist/build-provenance.json');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ revision: `source-sha256:${hash.digest('hex')}`, packages }, null, 2) + '\n');
