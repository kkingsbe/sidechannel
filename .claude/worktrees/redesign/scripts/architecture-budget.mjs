#!/usr/bin/env node
/**
 * Architecture budget census for the SOLID remediation program (WS0 T0.1).
 *
 * Measures the structural metrics the 2026-11-07 audit used, so later
 * workstreams cannot silently re-accrete the shapes the program removes.
 * Definitions are intentionally literal and documented here, because the
 * audit report does not publish its scanner.
 *
 * Usage:
 *   node scripts/architecture-budget.mjs           human summary
 *   node scripts/architecture-budget.mjs --json    machine-readable census
 *   node scripts/architecture-budget.mjs --check   exit 1 when a budget is exceeded
 *
 * Budgets and audit baselines live in scripts/architecture-budget.json.
 * Only source files are measured: node_modules, dist, .nx, docs and research
 * artifacts are excluded. Test files (`*.test.ts`, `*.test.tsx`, `tests/`) are
 * excluded from duplication censuses; `largestSourceFile` also ignores them.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SOURCE_ROOTS = ['api/src', 'dashboard/src', 'experiment-worker/src', 'analysis-worker/src', 'tests/integration'];
const PACKAGE_SOURCE_ROOTS = ['packages/contracts/src', 'packages/domain/src', 'packages/persistence/src'];
const BUDGET_FILE = 'scripts/architecture-budget.json';
const SOURCE_EXTENSIONS = /\.(ts|tsx)$/;
const TEST_FILE = /\.test\.(ts|tsx)$/;
const IGNORED_SEGMENTS = ['/node_modules/', '/dist/', '/.nx/', '/.mastra/'];

/** @param {string} dir @returns {string[]} absolute file paths */
function walk(dir) {
    if (!existsSync(dir)) return [];
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        const posix = '/' + relative(ROOT, full).replaceAll('\\', '/');
        if (IGNORED_SEGMENTS.some(segment => posix.includes(segment))) continue;
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name)) out.push(full);
    }
    return out;
}

function sourceFiles() {
    const roots = [...SOURCE_ROOTS, ...PACKAGE_SOURCE_ROOTS];
    const files = roots.flatMap(root => walk(join(ROOT, root)));
    return files.map(file => relative(ROOT, file).replaceAll('\\', '/')).sort();
}

const isTest = file => TEST_FILE.test(file) || file.startsWith('tests/');
const isProduction = file => !isTest(file);
const isPageEntry = file => /^dashboard\/src\/pages\/[^/]+\.tsx$/.test(file) && !TEST_FILE.test(file);
const lines = text => (text.match(/\n/g) ?? []).length;
const count = (text, pattern) => (text.match(pattern) ?? []).length;

const FILES = sourceFiles();
const CONTENTS = new Map(FILES.map(file => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    return [file, { text, lineCount: lines(text) }];
}));
const PRODUCTION = FILES.filter(isProduction);

/** Largest file by newline count (wc -l semantics, matching the audit report). */
function largestFile(filter, label) {
    const candidates = PRODUCTION.filter(filter).map(file => ({ file, lines: CONTENTS.get(file).lineCount }));
    candidates.sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));
    const top = candidates[0] ?? { file: '<none>', lines: 0 };
    return { metric: label, file: top.file, value: top.lines };
}

// --- Data-access hooks (dashboard F8) -------------------------------------
// Six implementations at baseline: 2 fetch hooks (useApi, page-local useExactApi)
// and 4 pagers (useCursorApi, useOffsetApi, useCursorPage, useRunPage).
const DATA_HOOK_DEFINITION = /(?:^|\n)\s*(?:export\s+)?(?:function|const)\s+(?:useApi|useCursorApi|useOffsetApi|useExactApi|useCursorPage|useRunPage)\b/g;
const DATA_HOOK_USAGE = /(?:useApi|usePage|useOffsetPage|useCursorApi|useOffsetApi|useExactApi|useCursorPage|useRunPage)\s*[<(]/g;

const fetchPageImplementations = () => {
    const sites = [];
    for (const file of PRODUCTION.filter(file => file.startsWith('dashboard/src/')))
        for (const match of CONTENTS.get(file).text.matchAll(DATA_HOOK_DEFINITION)) sites.push(`${file}: ${match[0].replace(/\s+/g, ' ').trim()}`);
    return { metric: 'fetchPageImplementations', value: sites.length, sites };
};

// A page "defines data hooks" when it is a page entry module that (a) owns data
// access itself and (b) has grown past the 1000-line structural budget: the
// audit's four offending page files (Analysis, Oversight, Experiments, Runs)
// are exactly the >1000-line pages that fetch their own data.
const PAGE_DATA_HOOK_LINE_BUDGET = 1000;
const pageFilesDefiningDataHooks = () => {
    const sites = [];
    for (const file of PRODUCTION.filter(isPageEntry)) {
        const { text, lineCount } = CONTENTS.get(file);
        if (lineCount > PAGE_DATA_HOOK_LINE_BUDGET && count(text, DATA_HOOK_USAGE) > 0) sites.push(`${file} (${lineCount} lines)`);
    }
    return { metric: 'pageFilesDefiningDataHooks', value: sites.length, sites };
};

// --- Duplication census ----------------------------------------------------
// Supported model-settings policy: the full sampling-control list appears once
// per allowlist (each contains `presencePenalty`); the Adaption subset is the
// exact allowlist literal ['maxOutputTokens', 'temperature'].
const providerSettingsPolicySites = () => {
    const sites = [];
    let value = 0;
    for (const file of PRODUCTION) {
        const text = CONTENTS.get(file).text;
        const full = count(text, /presencePenalty/g);
        const adaption = count(text, /\[\s*'maxOutputTokens',\s*'temperature'\s*\]/g);
        if (!full && !adaption) continue;
        value += full + adaption;
        sites.push(`${file} (full: ${full}, adaption: ${adaption})`);
    }
    return { metric: 'providerSettingsPolicySites', value, files: sites.length, sites };
};

const providerNameBranchSites = () => {
    const sites = [];
    for (const file of PRODUCTION) {
        const text = CONTENTS.get(file).text;
        const hits = count(text, /\bprovider\b\s*(?:===|!==)\s*['"]|['"](?:scripted|adaption|openai)['"]\s*(?:===|!==)\s*\bprovider\b|\bprovider\s*(?:===|!==)\s*'(?:scripted|adaption|openai)'/g);
        if (hits) sites.push({ file, hits });
    }
    return { metric: 'providerNameBranchSites', value: sites.reduce((sum, site) => sum + site.hits, 0), files: sites.length, sites: sites.map(site => `${site.file} (${site.hits})`) };
};

// Scenario-version policy sites. The audit's "30 sites / 14 files" census
// counted both literal version strings and references to the
// HEALTHCARE_SCENARIO_VERSION constant. WS4 turned the literals into one
// definition + constant references, so the two are reported separately:
//   * literal sites are the drift risk and are budgeted to <= 6;
//   * constant references are the single-source form and are expected to grow
//     with registry adoption (they are never a second copy of the policy).
// Import/export-from lines are wiring, not policy sites, and are excluded.
const SCENARIO_LITERAL = /['"](?:fixture-v1|healthcare-points-v0\.3)['"]/g;
const SCENARIO_CONSTANT = /\bHEALTHCARE_SCENARIO_VERSION\b/g;
const IMPORT_LINE = /^\s*(?:import|export)\b[^;]*\bfrom\b/;
function scenarioLineCensus(pattern, metric) {
    const sites = [];
    let value = 0;
    for (const file of PRODUCTION) {
        const hits = CONTENTS.get(file).text
            .split('\n')
            .filter(line => !IMPORT_LINE.test(line))
            .reduce((sum, line) => sum + count(line, pattern), 0);
        if (!hits) continue;
        value += hits;
        sites.push(`${file} (${hits})`);
    }
    return { metric, value, files: sites.length, sites };
}
const scenarioVersionLiterals = () => scenarioLineCensus(SCENARIO_LITERAL, 'scenarioVersionLiteralSites');
const scenarioVersionConstantReferences = () => scenarioLineCensus(SCENARIO_CONSTANT, 'scenarioVersionConstantReferences');

// Byte-identical duplicated production files (audit X6/S5): equal SHA-256 and
// at least 200 bytes, so trivial `export {}` stubs are not counted.
const byteIdenticalDuplicates = () => {
    const groups = new Map();
    for (const file of PRODUCTION) {
        const buffer = readFileSync(join(ROOT, file));
        if (buffer.length < 200) continue;
        const hash = createHash('sha256').update(buffer).digest('hex');
        groups.set(hash, [...(groups.get(hash) ?? []), file]);
    }
    const duplicates = [...groups.values()].filter(group => group.length > 1);
    return {
        metric: 'byteIdenticalDuplicateFiles',
        value: duplicates.reduce((sum, group) => sum + group.length, 0),
        files: duplicates.reduce((sum, group) => sum + group.length, 0),
        sites: duplicates.map(group => group.join(' == ')),
    };
};

// Status vocabulary arrays: every array literal naming >= 2 run statuses. Split
// into two metrics because they mean different things:
//   * table definitions are the canonical vocabulary (`export const RUN_STATUSES = [...]`);
//     they are the single source of truth and are expected to exist exactly once each;
//   * duplicate sites are inline status arrays anywhere else (in a page, a check, a
//     ternarieess chain) and are the P3 drift risk. WS7 drives duplicates to <= 1.
const STATUS_LITERAL = "['\"](?:queued|running|reporting|stopping|cancelled|completed|failed|interrupted)['\"]";
const statusVocabularyTableLine = /^\s*(?:export\s+)?const\s+[A-Z_][A-Z0-9_]*\s*(?::[^=]+)?=\s*\[/;
const statusVocabularyArrays = () => {
    const tables = [];
    const duplicates = [];
    const pattern = new RegExp(`\\[[^\\[\\]]*${STATUS_LITERAL}[^\\[\\]]*${STATUS_LITERAL}[^\\[\\]]*\\]`, 'g');
    for (const file of PRODUCTION) {
        const text = CONTENTS.get(file).text;
        for (const match of text.matchAll(pattern)) {
            const lineStart = text.lastIndexOf('\n', match.index) + 1;
            const line = text.slice(lineStart, text.indexOf('\n', match.index));
            if (statusVocabularyTableLine.test(line)) tables.push(file);
            else duplicates.push(`${file}: ${line.trim().slice(0, 100)}`);
        }
    }
    return {
        tables: { metric: 'statusVocabularyTableDefinitions', value: tables.length, sites: tables },
        duplicates: { metric: 'statusVocabularyDuplicateSites', value: duplicates.length, sites: duplicates },
    };
};

// --- Port surface sizes ----------------------------------------------------
function portMembers(interfaceName) {
    const candidates = PRODUCTION.filter(file => file.startsWith('packages/contracts/src/'));
    for (const file of candidates) {
        const text = CONTENTS.get(file).text;
        const declaration = new RegExp(`export interface ${interfaceName}\\b[^{]*\\{`).exec(text);
        if (!declaration) continue;
        const body = text.slice(declaration.index + declaration[0].length);
        const end = body.indexOf('\n}');
        const declarations = body.slice(0, end).split('\n').map(line => line.trim()).filter(Boolean);
        return { metric: interfaceName, value: declarations.length, file };
    }
    return { metric: interfaceName, value: 0, file: '<not found>' };
}

// --- Report ----------------------------------------------------------------
const statusVocabulary = statusVocabularyArrays();
const metrics = [
    largestFile(file => file.startsWith('dashboard/src/'), 'largestSourceFileLines'),
    largestFile(file => file.startsWith('dashboard/src/') && isPageEntry(file), 'largestPageFileLines'),
    largestFile(file => !file.startsWith('dashboard/'), 'largestBackendModuleLines'),
    pageFilesDefiningDataHooks(),
    fetchPageImplementations(),
    providerSettingsPolicySites(),
    providerNameBranchSites(),
    scenarioVersionLiterals(),
    scenarioVersionConstantReferences(),
    byteIdenticalDuplicates(),
    statusVocabulary.tables,
    statusVocabulary.duplicates,
    portMembers('AnalysisRepository'),
    portMembers('ResearcherRepository'),
    portMembers('Repository'),
];

const budgetDocument = JSON.parse(readFileSync(join(ROOT, BUDGET_FILE), 'utf8'));
const budgetFor = metric => budgetDocument.budgets[metric];

const results = metrics.map(metric => ({
    metric: metric.metric,
    value: metric.value,
    budget: budgetFor(metric.metric)?.max ?? null,
    target: budgetFor(metric.metric)?.target ?? null,
    detail: metric,
}));

const violations = results.filter(result => result.budget != null && result.value > result.budget);

if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ budgets: budgetDocument.budgets, results }, null, 2));
} else {
    const pad = (text, width) => String(text).padEnd(width);
    console.log('Architecture budget census (source files only; node_modules/dist/.nx excluded)\n');
    console.log(`${pad('Metric', 38)}${pad('Current', 9)}${pad('Budget', 9)}${pad('Target', 9)}Status`);
    console.log('-'.repeat(88));
    for (const result of results) {
        const status = result.budget == null ? '' : result.value > result.budget ? 'OVER BUDGET' : 'ok';
        console.log(`${pad(result.metric, 38)}${pad(result.value, 9)}${pad(result.budget ?? '-', 9)}${pad(result.target ?? '-', 9)}${status}`);
    }
    console.log('');
    for (const result of results) {
        const { metric, detail } = result;
        const lines = [];
        if (detail.file) lines.push(detail.file);
        if (detail.files != null && !detail.file) lines.push(`${detail.files} file(s)`);
        if (detail.sites?.length) for (const site of detail.sites) lines.push(`  ${site}`);
        if (lines.length) console.log(`${metric}:\n${lines.map(line => `  ${line}`).join('\n')}`);
    }
    console.log(`\nBaseline: ${budgetDocument.baseline.commit} — audit ${budgetDocument.baseline.audit}, planned budgets show the metric the program drives to 0 or below the target.`);
}

if (process.argv.includes('--check') && violations.length) {
    console.error(`\nArchitecture budget exceeded:\n${violations.map(violation => `  ${violation.metric}: ${violation.value} > ${violation.budget}`).join('\n')}`);
    process.exit(1);
}
