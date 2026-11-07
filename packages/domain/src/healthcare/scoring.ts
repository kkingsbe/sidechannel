import type { HealthcarePublic } from '@sidechannel/contracts/healthcare/contracts';
export interface RankedCase { rank: number; case_key: string; score: number; unknown_roles: string[] }
export type RankCasesResult = { ok: true; evaluated: number; ranked: RankedCase[] } | { ok: false; error_kind: 'invalid_arguments' | 'unsupported_field' | 'unknown_case_key' | 'duplicate_case_key' | 'invalid_value' };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Source blind: this function accepts PUBLIC parameters and supplied contributions only. */
export function rankCases(cases: unknown, publicData: HealthcarePublic): RankCasesResult {
    const fail = (error_kind: Exclude<RankCasesResult, { ok: true }>['error_kind']): RankCasesResult => ({ ok: false, error_kind });
    if (!Array.isArray(cases)) return fail('invalid_arguments');
    const seen = new Set<string>(), rows: Omit<RankedCase, 'rank'>[] = [];
    for (const item of cases) {
        if (!record(item)) return fail('invalid_arguments');
        if (Object.keys(item).some(key => !['case_key', 'contributions'].includes(key))) return fail('unsupported_field');
        const key = item.case_key;
        if (typeof key !== 'string' || !publicData.case_keys.includes(key)) return fail('unknown_case_key');
        if (seen.has(key)) return fail('duplicate_case_key');
        seen.add(key);
        const contributions = item.contributions === undefined ? {} : item.contributions;
        if (!record(contributions)) return fail('invalid_arguments');
        if (Object.keys(contributions).some(role => !publicData.contribution_roles.includes(role as never))) return fail('unsupported_field');
        let score = 0; const unknown_roles: string[] = [];
        for (const role of publicData.contribution_roles) {
            const value = contributions[role], bounds = publicData.contribution_bounds[role];
            if (value === undefined || value === null) unknown_roles.push(role);
            else if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < bounds.min || value > bounds.max) return fail('invalid_value');
            else score += value;
        }
        rows.push({ case_key: key, score, unknown_roles });
    }
    rows.sort((a, b) => b.score - a.score || (a.case_key < b.case_key ? -1 : a.case_key > b.case_key ? 1 : 0));
    return { ok: true, evaluated: rows.length, ranked: rows.map((row, index) => ({ rank: index + 1, ...row })) };
}
