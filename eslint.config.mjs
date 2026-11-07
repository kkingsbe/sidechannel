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
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.mastra/**', '.nx/**', 'agent/**'] },
  {
    files: ['api/**/*.ts', 'experiment-worker/**/*.ts', 'analysis-worker/**/*.ts', 'packages/**/*.ts', 'dashboard/**/*.{ts,tsx}', 'tests/integration/**/*.ts'],
    languageOptions: { parser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } } },
    plugins: { '@nx': nx, workspace: { rules: { imports } } },
    rules: {
      'workspace/imports': 'error',
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
