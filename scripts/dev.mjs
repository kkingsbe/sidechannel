import { readFileSync, watch } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = process.argv[2];
const shared = [];
const seen = new Set();
function dependencies(directory) {
  const manifest = JSON.parse(readFileSync(resolve(root, directory, 'package.json'), 'utf8'));
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    if (!dependency.startsWith('@sidechannel/')) continue;
    const path = `packages/${dependency.split('/')[1]}`;
    if (seen.has(path)) continue;
    seen.add(path);
    dependencies(path);
    shared.push(path);
  }
}
dependencies(project);
const children = new Set();
function run(args, cwd) {
  const child = spawn(process.execPath, args, { cwd, stdio: 'inherit' });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}
for (const directory of shared) {
  const compiler = resolve(root, 'node_modules/typescript/bin/tsc');
  const build = run([compiler, '-p', 'tsconfig.build.json'], resolve(root, directory));
  const code = await new Promise(done => build.on('exit', done));
  if (code !== 0) process.exit(code ?? 1);
}
if (seen.has('packages/domain')) {
  const provenance = run([resolve(root, 'scripts/build-provenance.mjs')], root);
  if (await new Promise(done => provenance.on('exit', done)) !== 0) process.exit(1);
}
for (const directory of shared) run([resolve(root, 'node_modules/typescript/bin/tsc'), '-w', '-p', 'tsconfig.build.json'], resolve(root, directory));
const localRequire = createRequire(resolve(root, project, 'package.json'));
const args = project === 'dashboard'
  ? [resolve(dirname(localRequire.resolve('vite/package.json')), 'bin/vite.js'), '--host', '127.0.0.1']
  : ['--import', 'tsx', '--env-file-if-exists=../.env', '--env-file-if-exists=.env', 'src/main.ts'];
let app;
let timer;
let pending = Promise.resolve();
async function restart() {
  if (app) {
    const previous = app;
    app = undefined;
    if (previous.exitCode === null && previous.signalCode === null) {
      await new Promise(done => { previous.once('exit', done); previous.kill(); });
    }
  }
  if (seen.has('packages/domain')) {
    const provenance = run([resolve(root, 'scripts/build-provenance.mjs')], root);
    if (await new Promise(done => provenance.on('exit', done)) !== 0) return;
  }
  app = run(args, resolve(root, project));
}
function changed() {
  clearTimeout(timer);
  timer = setTimeout(() => { pending = pending.then(restart); }, 300);
}
const watchers = [];
// Watch real workspace directories rather than ignored node_modules symlinks.
// Shared output changes restart the consumer after TypeScript has emitted them.
for (const directory of shared) watchers.push(watch(resolve(root, directory, 'dist'), { recursive: true }, (_event, filename) => {
  if (filename && /\.(?:js|json)$/.test(filename) && filename !== 'build-provenance.json') changed();
}));
watchers.push(watch(resolve(root, project, 'src'), { recursive: true }, changed));
// Provenance includes every source tree, even those outside this app's graph.
for (const directory of ['api', 'experiment-worker', 'analysis-worker', 'dashboard', 'packages/contracts', 'packages/domain', 'packages/persistence']) {
  watchers.push(watch(resolve(root, directory, 'src'), { recursive: true }, changed));
  watchers.push(watch(resolve(root, directory, 'package.json'), changed));
}
watchers.push(watch(resolve(root, 'package-lock.json'), changed));
await restart();
function stop() { clearTimeout(timer); for (const watcher of watchers) watcher.close(); for (const child of children) child.kill(); }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop(); process.exit(); });
