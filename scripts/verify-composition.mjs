import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = file => readFileSync(resolve(root, file), 'utf8');
const forbidden = (file, pattern, reason) => assert(!pattern.test(source(file)), `${file}: ${reason} (matched ${pattern})`);

// 1. The experiment worker loop and entrypoint may name no concrete adapter.
for (const file of ['experiment-worker/src/main.ts', 'experiment-worker/src/worker.ts']) {
    forbidden(file, /@sidechannel\/persistence/, 'the worker may depend only on contract ports');
    forbidden(file, /\bMongo\w*/, 'the worker may not name a Mongo adapter');
    forbidden(file, /new Mastra(Memory|ModelAdapter|PrivateMemory)/, 'the worker may not construct Mastra collaborators');
}

// 2. Route modules never construct or initialize storage.
const routes = readdirSync(resolve(root, 'api/src/routes')).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'));
for (const name of routes) {
    forbidden(join('api/src/routes', name), /new Mongo\w+/, 'composition belongs to api/src/main.ts');
    forbidden(join('api/src/routes', name), /\.initialize\(\)/, 'startup migrations belong to api/src/main.ts');
}

// 3. The monitor provider requires an injected adapter and never imports one lazily.
forbidden('analysis-worker/src/oversight/provider.ts', /await import\(/, 'the monitor adapter must be injected, not imported lazily');
forbidden('analysis-worker/src/oversight/provider.ts', /adapter\?/, 'the monitor adapter parameter is required');

// 4. The Mastra registry is a value, never mutable module state.
forbidden('experiment-worker/src/mastra/index.ts', /export let /, 'the trace runtime is injected, not a mutable module global');
forbidden('experiment-worker/src/mastra/index.ts', /^let /m, 'the trace runtime holds its state in an instance field');

// 5. Only the known declarative schema modules may use zod at runtime. The boundary exists to stop
//    the dependency from spreading through the portable contracts graph; the healthcare schemas
//    (accepted T2.4 deviation, extraction belongs to WS4) and the playbook contracts (ported from
//    main) are the accepted modules.
const contractsFiles = [];
const walk = directory => { for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith('.ts')) contractsFiles.push(path);
} };
walk(resolve(root, 'packages/contracts/src'));
const zodUsers = contractsFiles.filter(file => /from 'zod'/.test(readFileSync(file, 'utf8')));
assert.deepEqual(zodUsers.map(file => file.replaceAll('\\', '/').split('/packages/contracts/')[1]), ['src/healthcare/contracts.ts', 'src/playbook/contracts.ts'],
    'only the healthcare and playbook schema modules may depend on zod; move new runtime schemas to packages/domain');

console.log('Composition roots verified: no concrete adapters in workers or routes, no lazy provider import, no mutable Mastra global, only the accepted zod modules in contracts.');
