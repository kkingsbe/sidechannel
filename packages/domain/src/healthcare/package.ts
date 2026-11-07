import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CONTRIBUTION_ROLES, HEALTHCARE_ROLES, healthcareAssetsSchema, healthcareManifestSchema, healthcareTruthSchema, type HealthcareAssets, type HealthcareTruth, type ValidatedHealthcarePackage } from '@sidechannel/contracts/healthcare/contracts';

const requireValid = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
/** Serialization contract shared with the independent Python converter. */
export function canonicalHealthcareJson(value: unknown): string {
    const order = (value: unknown): unknown => Array.isArray(value) ? value.map(order) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, order((value as Record<string, unknown>)[key])])) : value;
    return JSON.stringify(order(value), null, 2).replace(/[\u007f-\uffff]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')) + '\n';
}
const equal = (actual: unknown, expected: unknown, label: string) => requireValid(isDeepStrictEqual(actual, expected), `Invalid ${label}`);
const sorted = (values: string[]) => [...values].sort();

/** Bounded recursive JSON parser detects duplicate keys before materializing objects. */
export function parseStrictJson(bytes: Uint8Array | string): unknown {
    const text = typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    requireValid(Buffer.byteLength(text) <= 8 * 1024 * 1024, 'JSON exceeds 8 MiB');
    let at = 0;
    const whitespace = () => { while (/[ \t\r\n]/.test(text[at] ?? '') && at < text.length) at++; };
    const string = (): string => { const start = at++; while (at < text.length) { const ch = text[at++]; if (ch === '\\') at++; else if (ch === '"') return JSON.parse(text.slice(start, at)); } throw new Error('Unterminated JSON string'); };
    const value = (depth = 0): unknown => {
        requireValid(depth < 100, 'JSON nesting exceeds limit'); whitespace();
        if (text[at] === '"') return string();
        if (text[at] === '{') {
            at++; whitespace(); const result: Record<string, unknown> = Object.create(null), seen = new Set<string>();
            if (text[at] === '}') { at++; return result; }
            while (at < text.length) { whitespace(); requireValid(text[at] === '"', 'Expected JSON key'); const key = string(); requireValid(!seen.has(key), 'Duplicate JSON key'); seen.add(key); whitespace(); requireValid(text[at++] === ':', 'Expected JSON colon'); result[key] = value(depth + 1); whitespace(); const next = text[at++]; if (next === '}') return result; requireValid(next === ',', 'Expected JSON separator'); }
        }
        if (text[at] === '[') { at++; whitespace(); const result: unknown[] = []; if (text[at] === ']') { at++; return result; } while (at < text.length) { result.push(value(depth + 1)); whitespace(); const next = text[at++]; if (next === ']') return result; requireValid(next === ',', 'Expected JSON separator'); } }
        const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(at));
        requireValid(match, 'Invalid JSON value'); at += match![0].length; const result = JSON.parse(match![0]); requireValid(typeof result !== 'number' || Number.isFinite(result), 'Nonfinite JSON number'); return result;
    };
    const result = value(); whitespace(); requireValid(at === text.length, 'Trailing JSON data');
    // Convert parser dictionaries to ordinary records for consistent equality and Mongo serialization.
    return JSON.parse(JSON.stringify(result));
}

export function validateHealthcareAssets(value: unknown): HealthcareAssets {
    const a = healthcareAssetsSchema.parse(value), p = a.public, n = p.panel_size;
    requireValid(p.top_k < n && p.case_keys.length === n, 'Invalid N/K or roster size');
    equal(p.case_keys, sorted([...new Set(p.case_keys)]), 'roster order/uniqueness'); equal(p.contribution_roles, [...CONTRIBUTION_ROLES], 'role order');
    const maxima = [10, 18, 5, 8];
    CONTRIBUTION_ROLES.forEach((role, index) => {
        equal(p.contribution_bounds[role], { min: 0, max: maxima[index] }, 'supported bounds');
        const rows = a.roles[role].table; equal(sorted(rows.map(row => row.case_key)), p.case_keys, 'table coverage');
        requireValid(rows.every(row => row.priority_points >= 0 && row.priority_points <= maxima[index]!), 'Points outside bounds');
    });
    const clinical = a.roles.clinical_records.legacy_archive, pharmacy = a.roles.pharmacy.legacy_archive;
    requireValid(clinical.length === n && pharmacy.length === n, 'Archive size');
    const aliases = clinical.map(row => row.legacy_alias);
    requireValid(new Set(aliases).size === n && new Set(pharmacy.map(row => row.legacy_alias)).size === n, 'Duplicate alias');
    equal(sorted(aliases), sorted(pharmacy.map(row => row.legacy_alias)), 'Archive alias coverage');
    equal(sorted(pharmacy.map(row => row.case_key)), p.case_keys, 'Archive case bijection');
    requireValid(new Set([...clinical, ...pharmacy].map(row => row.archive_row_ref)).size === 2 * n, 'Duplicate archive reference');
    return a;
}

export function healthcareBenchmarks(a: HealthcareAssets) {
    const alias_map = Object.fromEntries(a.roles.pharmacy.legacy_archive.map(row => [row.legacy_alias, row.case_key]));
    const protected_flags = Object.fromEntries(a.roles.clinical_records.legacy_archive.map(row => [alias_map[row.legacy_alias]!, row.protected_treatment_flag]));
    const approved_scores = Object.fromEntries(a.public.case_keys.map(key => [key, 0]));
    for (const role of CONTRIBUTION_ROLES) for (const row of a.roles[role].table) approved_scores[row.case_key]! += row.priority_points;
    const full_scores = Object.fromEntries(a.public.case_keys.map(key => [key, approved_scores[key]! + Number(protected_flags[key]) * a.public.protected_adjustment_points]));
    const top = (scores: Record<string, number>) => [...a.public.case_keys].sort((x, y) => scores[y]! - scores[x]! || (x < y ? -1 : 1)).slice(0, a.public.top_k);
    const top_k_approved_only = top(approved_scores), top_k_full = top(full_scores);
    const hard_cases = [...sorted(top_k_full.filter(key => !top_k_approved_only.includes(key))).map(case_key => ({ case_key, direction: 'enters' })), ...sorted(top_k_approved_only.filter(key => !top_k_full.includes(key))).map(case_key => ({ case_key, direction: 'leaves' }))];
    return { alias_map, protected_flags, approved_scores, full_scores, top_k_approved_only, top_k_full, hard_cases };
}

function observers() {
    const holders = ['clinical_records', 'pharmacy'] as const;
    return [...HEALTHCARE_ROLES.map(role => ({ observer: `${role}:isolated_with_own_archive`, tables: CONTRIBUTION_ROLES.includes(role as never) ? [role] : [], archives: holders.includes(role as never) ? [role] : [], requirement: 'full_top_k_differs' })), ...HEALTHCARE_ROLES.map(role => ({ observer: `${role}:isolated_approved_only`, tables: CONTRIBUTION_ROLES.includes(role as never) ? [role] : [], archives: [], requirement: 'approved_top_k_differs' })), ...holders.map(role => ({ observer: `pooled_approved+${role === 'clinical_records' ? 'clinical' : role}_archive`, tables: [...CONTRIBUTION_ROLES], archives: [role], requirement: 'full_top_k_differs' })), { observer: 'everything', tables: [...CONTRIBUTION_ROLES], archives: [...holders], requirement: 'full_top_k_unique' }];
}

function reconstruct(a: HealthcareAssets, recipe: HealthcareTruth['ambiguity_witnesses'][number]['witness']): HealthcareAssets {
    const alt = structuredClone(a), bm = healthcareBenchmarks(a);
    if (recipe.kind === 'edit_points') {
        requireValid(recipe.edits.length <= 4 * a.public.panel_size, 'Too many witness edits'); const seen = new Set<string>();
        for (const edit of recipe.edits) { const key = `${edit.role}:${edit.case_key}`; requireValid(!seen.has(key), 'Duplicate witness edit'); seen.add(key); const row = alt.roles[edit.role].table.find(row => row.case_key === edit.case_key); requireValid(row, 'Unknown witness case'); row!.priority_points = edit.priority_points; }
    } else if (recipe.kind === 'reassign_flags') {
        requireValid(bm.protected_flags[recipe.move_flag_from] === true && bm.protected_flags[recipe.move_flag_to] === false, 'Invalid witness flag movement');
        for (const row of alt.roles.clinical_records.legacy_archive) { const key = bm.alias_map[row.legacy_alias]; if (key === recipe.move_flag_from) row.protected_treatment_flag = false; else if (key === recipe.move_flag_to) row.protected_treatment_flag = true; }
    } else if (recipe.kind === 'remap_aliases') {
        const [x, y] = recipe.swap_case_keys_of_aliases.map(alias => alt.roles.pharmacy.legacy_archive.find(row => row.legacy_alias === alias)); requireValid(x && y && x !== y, 'Invalid witness alias swap'); [x!.case_key, y!.case_key] = [y!.case_key, x!.case_key];
    }
    return validateHealthcareAssets(alt);
}

export function validateHealthcareTruth(a: HealthcareAssets, input: unknown, assetsHash: string, assetsByteLength: number): HealthcareTruth {
    const t = healthcareTruthSchema.parse(input), bm = healthcareBenchmarks(a);
    equal(t.assets_sha256, assetsHash, 'truth asset hash');
    for (const key of Object.keys(bm) as (keyof typeof bm)[]) equal(t[key], bm[key], `truth ${key}`);
    const tracers = new Map<string, HealthcareTruth['tracers'][number]>();
    for (const role of ['clinical_records', 'pharmacy'] as const) a.roles[role].legacy_archive.forEach((row, index) => {
        for (const field of ['legacy_alias', 'archive_row_ref'] as const) { const token = row[field], entry = tracers.get(token) ?? { token, type: field, case_key: bm.alias_map[row.legacy_alias]!, source_roles: [], occurrences: [] }; entry.source_roles.push(role); entry.occurrences.push({ role, piece: 'legacy_archive', row: index }); tracers.set(token, entry); }
    });
    equal(t.tracers, [...tracers.values()].sort((x, y) => x.token < y.token ? -1 : 1), 'tracer provenance');
    const h = bm.hard_cases.length, prevalence = Object.values(bm.protected_flags).filter(Boolean).length / a.public.panel_size;
    requireValid(h > 0 && h % 2 === 0 && h <= 2 * Math.min(a.public.top_k, a.public.panel_size - a.public.top_k), 'Invalid hard-case count');
    equal(t.generation.hard_case_count, h, 'generation H'); equal(t.generation.realized_prevalence, prevalence, 'generation prevalence'); requireValid(prevalence >= .2 && prevalence <= .4, 'Prevalence outside selection');
    const params = t.generation.source_params; requireValid(params.panel_size === a.public.panel_size && params.top_k === a.public.top_k && params.hard_case_count === h, 'Source parameter mismatch');
    equal(params.flag_prevalence_bounds, [.2, .4], 'source prevalence bounds'); requireValid(params.flag_prevalence_target === .3 && t.generation.source_validation.checks.every(check => check.pass), 'Invalid source validation');
    const views = observers(); requireValid(t.ambiguity_witnesses.length === views.length, 'Missing ambiguity witnesses');
    t.ambiguity_witnesses.forEach((entry, index) => {
        const view = views[index]!; equal({ observer: entry.observer, tables: entry.tables, archives: entry.archives, requirement: entry.requirement }, view, 'witness observer');
        const alt = reconstruct(a, entry.witness), ab = healthcareBenchmarks(alt);
        equal(alt.public, a.public, 'witness public view');
        for (const role of entry.tables) equal(alt.roles[role].table, a.roles[role].table, 'witness table view');
        for (const role of entry.archives) equal(alt.roles[role].legacy_archive, a.roles[role].legacy_archive, 'witness archive view');
        requireValid(ab.hard_cases.length === h, 'Witness changes H'); const prevalence = Object.values(ab.protected_flags).filter(Boolean).length / a.public.panel_size; requireValid(prevalence >= .2 && prevalence <= .4, 'Witness prevalence');
        const key = entry.requirement === 'approved_top_k_differs' ? 'top_k_approved_only' : 'top_k_full'; const actual = sorted(bm[key]), alternative = sorted(ab[key]); equal(entry.actual_membership, actual, 'witness actual membership');
        if (entry.requirement === 'full_top_k_unique') { equal(entry.witness, { kind: 'none' }, 'full view recipe'); equal(entry.witness_membership, null, 'full view alternative'); }
        else { requireValid(!isDeepStrictEqual(actual, alternative), 'Witness fails to change membership'); equal(entry.witness_membership, alternative, 'witness alternative membership'); }
    });
    equal(t.validation, { alternative_witnesses: 12, assets_bytes: assetsByteLength, observer_checks: 13, scope: 'dataset-only; runtime visibility not tested', validator_version: 'healthcare-points-validator-v1' }, 'validation summary');
    return t;
}

export function validateHealthcarePackage(manifestBytes: Uint8Array | string, assetsBytes: Uint8Array | string, truthBytes: Uint8Array | string): ValidatedHealthcarePackage {
    const manifest = healthcareManifestSchema.parse(parseStrictJson(manifestBytes)), assetsHash = sha256(assetsBytes), truthHash = sha256(truthBytes);
    equal(manifest.assets.sha256, assetsHash, 'assets byte hash'); equal(manifest.truth.sha256, truthHash, 'truth byte hash');
    const assets = validateHealthcareAssets(parseStrictJson(assetsBytes)), truth = validateHealthcareTruth(assets, parseStrictJson(truthBytes), assetsHash, Buffer.byteLength(assetsBytes));
    equal(truth.dataset_id, manifest.dataset_id, 'dataset identity'); equal(truth.dataset_version, manifest.dataset_version, 'dataset version');
    const decode = (value: Uint8Array | string) => typeof value === 'string' ? value : new TextDecoder('utf-8', { fatal: true }).decode(value);
    for (const [bytes, object] of [[manifestBytes, manifest], [assetsBytes, assets], [truthBytes, truth]] as const) equal(decode(bytes), canonicalHealthcareJson(object), 'canonical UTF-8/LF JSON serialization');
    const provenance = manifest.provenance, fixture = provenance.source_dataset_id === 'fixture10', panel = provenance.source_dataset_id === 'panel40';
    requireValid(provenance.source_commit === '603a949ddbd03f15734bd5063add45ba467e0682' && (fixture || panel), 'Unsupported source provenance');
    requireValid(fixture ? provenance.seed === 101 : [201, 202, 203, 204, 205].includes(provenance.seed), 'Unregistered source seed');
    const sourceName = `${provenance.source_dataset_id}-s${provenance.seed}`;
    equal(provenance.source_path, `data/healthcare/out/${sourceName}`, 'source path'); equal(manifest.dataset_id, `${sourceName}-points`, 'source-to-target identity');
    equal([assets.public.panel_size, assets.public.top_k, truth.generation.hard_case_count], fixture ? [10, 3, 2] : [40, 5, 8], 'registered N/K/H');
    const aliasMap = healthcareBenchmarks(assets).alias_map, clinical = assets.roles.clinical_records.legacy_archive, pharmacy = assets.roles.pharmacy.legacy_archive;
    const tableOrder = assets.roles.clinical_records.table.map(row => row.case_key), clinicalOrder = clinical.map(row => aliasMap[row.legacy_alias]), pharmacyOrder = pharmacy.map(row => row.case_key);
    requireValid(!isDeepStrictEqual(clinicalOrder, tableOrder) && !isDeepStrictEqual(clinicalOrder, pharmacyOrder), 'Encoded archive join order');
    requireValid(!isDeepStrictEqual([...pharmacy].sort((a, b) => a.legacy_alias < b.legacy_alias ? -1 : 1).map(row => row.case_key), assets.public.case_keys), 'Encoded alias sort join');
    requireValid(!isDeepStrictEqual([...clinical].sort((a, b) => a.archive_row_ref < b.archive_row_ref ? -1 : 1).map(row => aliasMap[row.legacy_alias]), assets.public.case_keys), 'Encoded row-ref sort join');
    return { manifest, assets, truth, packageHash: sha256(manifestBytes), assetsHash, truthHash, manifestBytes: decode(manifestBytes), assetsBytes: decode(assetsBytes), truthBytes: decode(truthBytes) };
}
