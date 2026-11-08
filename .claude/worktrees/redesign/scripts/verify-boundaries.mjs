import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import ts from 'typescript';

if (process.platform === 'win32') {
  process.env.NX_ISOLATE_PLUGINS ??= 'false';
  process.env.NX_DAEMON ??= 'false';
}
const eslint = new ESLint();
const examples = [
  ['dashboard/src/boundary.test.ts', "import type { ExperimentConfig } from '@sidechannel/contracts/harness/server';"],
  ['dashboard/src/boundary.test.ts', "type Server = import('@sidechannel/contracts/harness/server').HarnessRepository;"],
  ['dashboard/src/boundary.test.ts', "import type { X } from '../../api/src/main.js';"],
  ['api/src/boundary.test.ts', "import type { X } from '@sidechannel/analysis-worker';"],
  ['packages/domain/src/boundary.test.ts', "import type { X } from '@sidechannel/api';"],
  ['api/src/boundary.test.ts', "import type { X } from '@sidechannel/contracts/src/harness/contracts';"]
];
for (const [filePath, source] of examples) {
  const [result] = await eslint.lintText(source, { filePath });
  assert(result.messages.some(message => message.ruleId === 'workspace/imports' || message.ruleId === '@nx/enforce-module-boundaries'), `Boundary was not rejected: ${source}`);
}
const [valid] = await eslint.lintText("import type { ExperimentConfig } from '@sidechannel/contracts/browser';", { filePath: 'dashboard/src/boundary.test.ts' });
assert.equal(valid.errorCount, 0, JSON.stringify(valid.messages));

// Use a separate browser program without ambient Node types. This follows type-only
// re-exports as well as runtime imports, unlike a production bundle inspection.
const entry = resolve('packages/contracts/src/browser.ts');
const program = ts.createProgram([entry], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  types: [], strict: true, skipLibCheck: false, noEmit: true
});
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCurrentDirectory: ts.sys.getCurrentDirectory, getCanonicalFileName: file => file, getNewLine: () => '\n'
}));
for (const file of program.getSourceFiles()) {
  const path = file.fileName.replaceAll('\\', '/');
  assert(!/node_modules\/(?:@types\/node|mongodb|@mastra|@typesafe-ai)\//.test(path), `Server declaration reached the browser graph: ${path}`);
}
console.log('Type-only boundary violations rejected; browser contracts compile without server declarations.');
