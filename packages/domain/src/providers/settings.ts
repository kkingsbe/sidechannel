/**
 * The single definition of the supported sampling controls. Every other site —
 * the config form schema, the config validator, the token budget, the hosted-model
 * catalog and both model adapters — reads these lists instead of restating them.
 */
export const GENERIC_SETTINGS = ['maxOutputTokens', 'temperature', 'topP', 'topK', 'presencePenalty', 'frequencyPenalty', 'seed'] as const;

/** Controls verified against Adaption's Responses API: a subset, not a second list. */
export const ADAPTION_SETTINGS: readonly string[] = GENERIC_SETTINGS.filter(key => key === 'maxOutputTokens' || key === 'temperature');

/** Settings forwarded to the SDK instead of being interpreted by the harness. */
export const PASSTHROUGH_SETTINGS = ['providerOptions', 'stopSequences'] as const;

const supports = (list: readonly string[], key: string) => list.includes(key);

export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

type ValueRule = (key: string, value: number) => string | undefined;

/** Value rules for the numeric controls; controls without a rule are unconstrained finite numbers. */
const RULES: Partial<Record<(typeof GENERIC_SETTINGS)[number], ValueRule>> = {
    maxOutputTokens: (key, value) => Number.isSafeInteger(value) && value >= 1 ? undefined : `${key} must be positive integer`,
    topK: (key, value) => Number.isSafeInteger(value) && value >= 1 ? undefined : `${key} must be positive integer`,
    seed: (_key, value) => Number.isSafeInteger(value) ? undefined : 'provider seed must be integer',
    temperature: (key, value) => value < 0 || value > 2 ? `${key} outside supported range` : undefined,
    topP: (key, value) => value < 0 || value > 1 ? `${key} outside supported range` : undefined,
};

/**
 * Value and shape errors for the generic transport. Unknown keys are reported here
 * so the message set stays identical to the historical validator in harness/config.ts.
 */
export function genericSettingErrors(settings: Record<string, unknown>): string[] {
    const errors: string[] = [];
    for (const [key, value] of Object.entries(settings)) {
        if (key === 'providerOptions') {
            if (!isRecord(value)) errors.push('providerOptions must be an object');
            continue;
        }
        if (key === 'stopSequences') {
            if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) errors.push('stopSequences must be strings');
            continue;
        }
        if (!supports(GENERIC_SETTINGS, key)) {
            errors.push(`Unsupported model setting ${key}`);
            continue;
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            errors.push(`${key} must be finite`);
            continue;
        }
        const message = RULES[key as (typeof GENERIC_SETTINGS)[number]]?.(key, value);
        if (message) errors.push(message);
    }
    return errors;
}
