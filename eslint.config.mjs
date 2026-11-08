import nx from '@nx/eslint-plugin';
import parser from '@typescript-eslint/parser';
import { resolve, relative } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';

const services = ['api', 'experiment-worker', 'analysis-worker'];
const root = fileURLToPath(new URL('.', import.meta.url));
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
const allowed = {
  'packages/contracts': ['contracts'],
  'packages/domain': ['contracts', 'domain'],
  'packages/persistence': ['contracts', 'domain', 'persistence'],
  dashboard: ['contracts']
};
function owner(path) {
  const normalized = relative(root, resolve(path)).replaceAll('\\', '/');
  return normalized.startsWith('packages/') ? normalized.split('/').slice(0, 2).join('/') : normalized.split('/')[0];
}
const imports = {
  meta: { type: 'problem', schema: [], messages: { boundary: '{{reason}}' } },
  create(context) {
    const source = owner(context.filename);
    const isTest = source === 'tests';
    function inspect(node) {
      const name = node.source?.value ?? node.argument?.literal?.value ??
        (node.type === 'CallExpression' && node.callee?.name === 'require' ? node.arguments[0]?.value : undefined);
      if (typeof name !== 'string') return;
      let reason;
      if (source === 'dashboard' && name.startsWith('@sidechannel/') && !['@sidechannel/contracts/browser', '@sidechannel/contracts/testing'].includes(name)) reason = 'The dashboard may import only browser contracts or test-only fixture support.';
      if (source === 'dashboard' && name === '@sidechannel/contracts/testing' && !context.filename.endsWith('.test.ts') && !context.filename.endsWith('.test.tsx')) reason = 'Fixture support is restricted to frontend tests.';
      if (name.startsWith('@sidechannel/')) {
        const [scope, pkg, ...parts] = name.split('/');
        if (!isTest && allowed[source] && !allowed[source].includes(pkg)) reason = 'This dependency violates the shared-package layer direction.';
        if (!isTest && services.includes(pkg)) reason = 'Services cannot import another service; extract a shared interface.';
        if (!isTest && ['src', 'dist'].some(part => parts.includes(part))) reason = 'Use a declared workspace package export.';
        if (!services.includes(pkg)) {
          try {
            const manifest = JSON.parse(readFileSync(resolve(root, 'packages', pkg, 'package.json'), 'utf8'));
            if (!manifest.exports?.['./' + parts.join('/')]) reason = 'This workspace subpath is not a declared package export.';
          } catch { reason = 'Unknown workspace package.'; }
        }
        if (!isTest) {
          const manifest = JSON.parse(readFileSync(resolve(root, source, 'package.json'), 'utf8'));
          if (!manifest.dependencies?.[`${scope}/${pkg}`] && `${scope}/${pkg}` !== manifest.name) reason = 'Declare workspace imports as package dependencies.';
        }
      }
      if (!name.startsWith('.') && !name.startsWith('@sidechannel/')) {
        if (builtins.has(name)) {
          if (source === 'dashboard' || source === 'packages/contracts') reason = 'Browser code and portable contracts cannot import Node built-ins.';
        } else {
          const packageName = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
          const directory = isTest ? 'tests/integration' : source;
          const manifest = JSON.parse(readFileSync(resolve(root, directory, 'package.json'), 'utf8'));
          if (!manifest.dependencies?.[packageName] && !manifest.devDependencies?.[packageName]) reason = `Declare ${packageName} in this package's dependencies.`;
        }
      }
      if (name.startsWith('.')) {
        const target = owner(resolve(context.filename, '..', name));
        if (!isTest && target !== source) reason = 'Cross-project relative imports bypass package exports.';
      }
      if (reason) context.report({ node, messageId: 'boundary', data: { reason } });
    }
    return { ImportDeclaration: inspect, ExportNamedDeclaration: inspect, ExportAllDeclaration: inspect, ImportExpression: inspect, TSImportType: inspect, CallExpression: inspect };
  }
};

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.mastra/**', '.nx/**'] },
  {
    files: ['api/**/*.ts', 'experiment-worker/**/*.ts', 'analysis-worker/**/*.ts', 'packages/**/*.ts', 'dashboard/**/*.{ts,tsx}', 'tests/integration/**/*.ts'],
    languageOptions: { parser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } } },
    plugins: { '@nx': nx, workspace: { rules: { imports } } },
    rules: {
      'workspace/imports': 'error',
      // Structural budgets (SOLID remediation WS0 T0.3). Warnings, not errors:
      // the decomposition workstreams (WS3x/WS6) drive these to zero; until then
      // a reviewer sees every module that still needs splitting.
      'max-lines': ['warn', { max: 700, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 250, skipBlankLines: true, skipComments: true }],
      '@nx/enforce-module-boundaries': ['error', {
        enforceBuildableLibDependency: true,
        allow: [],
        depConstraints: [
          { sourceTag: 'layer:frontend', onlyDependOnLibsWithTags: ['layer:contracts'] },
          { sourceTag: 'layer:service', onlyDependOnLibsWithTags: ['layer:contracts', 'layer:domain', 'layer:persistence'] },
          { sourceTag: 'layer:contracts', onlyDependOnLibsWithTags: ['layer:contracts'] },
          { sourceTag: 'layer:domain', onlyDependOnLibsWithTags: ['layer:contracts', 'layer:domain'] },
          { sourceTag: 'layer:persistence', onlyDependOnLibsWithTags: ['layer:contracts', 'layer:domain', 'layer:persistence'] },
          { sourceTag: 'layer:test', onlyDependOnLibsWithTags: ['*'] }
        ]
      }]
    }
  },
  // One transport seam (SOLID remediation WS5): only dashboard/src/lib may call
  // fetch directly; every page/component goes through the typed clients. The
  // `as unknown as` escape hatch is banned in the transport layer so adapter
  // parity bugs surface as type errors instead of silent casts.
  {
    files: ['dashboard/**/*.{ts,tsx}'],
    ignores: ['dashboard/src/lib/**', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-globals': ['error', { name: 'fetch', message: 'Use the typed clients in dashboard/src/lib/clients instead of calling fetch directly.' }]
    }
  },
  {
    files: ['dashboard/src/lib/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: 'TSAsExpression > TSAsExpression[typeAnnotation.type="TSUnknownKeyword"]',
        message: 'Do not chain `as unknown as`; model the real type or add a validated adapter.'
      }]
    }
  },
  // Integration tests deliberately compose service internals. Production code
  // remains checked by both Nx tags and the package-export restrictions above.
  {
    files: ['tests/integration/**/*.ts'],
    rules: {
      '@nx/enforce-module-boundaries': ['error', {
        enforceBuildableLibDependency: true,
        allow: ['../../api/src/**', '../../experiment-worker/src/**', '../../analysis-worker/src/**'],
        depConstraints: [{ sourceTag: 'layer:test', onlyDependOnLibsWithTags: ['*'] }]
      }]
    }
  }
];
