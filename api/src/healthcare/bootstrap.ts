import { readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateHealthcarePackage } from '@sidechannel/domain/healthcare/package';
import { MongoHealthcareCatalog } from '@sidechannel/persistence/healthcare/catalog';
import { MongoRepository } from '@sidechannel/persistence/harness/repository';

export async function loadHealthcarePackage(directory: string) {
    const files = ['manifest.json', 'assets.json', 'truth.json'].map(name => resolve(directory, name));
    if ((await lstat(directory)).isSymbolicLink()) throw new Error('Package directory may not be a symlink');
    for (const file of files) { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) throw new Error('Package files must be bounded regular files, not symlinks'); }
    const [manifest, assets, truth] = await Promise.all(files.map(file => readFile(file)));
    return validateHealthcarePackage(manifest!, assets!, truth!);
}

async function main() {
    const args = process.argv.slice(2), dryRun = args.includes('--dry-run'), paths = args.filter(arg => arg !== '--dry-run');
    const root = fileURLToPath(new URL('../../../data/healthcare/points-out/', import.meta.url));
    const directories = paths.length ? paths.map(path => resolve(path)) : ['fixture10-s101-points', ...[201, 202, 203, 204, 205].map(seed => `panel40-s${seed}-points`)].map(id => resolve(root, id));
    const packages = await Promise.all(directories.map(loadHealthcarePackage));
    if (dryRun) { console.log(JSON.stringify({ status: 'validated', datasets: packages.map(p => ({ datasetId: p.manifest.dataset_id, packageHash: p.packageHash })) }, null, 2)); return; }
    const repository = await MongoRepository.connect(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0', process.env.MONGODB_DB_NAME ?? 'sidechannel');
    try { const catalog = new MongoHealthcareCatalog(repository.client, repository.db); await catalog.initialize(); for (const p of packages) console.log(JSON.stringify(await catalog.register(p))); } finally { await repository.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
