import { readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';

const mongo = process.argv.includes('--mongo');
const files = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.mastra'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.name.endsWith('.test.ts') && entry.name.endsWith('.mongo.test.ts') === mongo) files.push(path);
  }
}
await collect(resolve(process.argv[2] ?? 'src'));
if (files.length) {
  const concurrency = process.env.TEST_CONCURRENCY ?? '2';
  if (!/^[1-9]\d*$/.test(concurrency)) throw new Error('TEST_CONCURRENCY must be a positive integer.');
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', `--test-concurrency=${concurrency}`, ...files.sort()], { stdio: 'inherit' });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} else console.log('No tests in this package.');
