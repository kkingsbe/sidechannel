import { CONDITION_IDS, PAIR_CONDITION_IDS, type ExperimentConfig } from '@sidechannel/contracts/harness/contracts';
import { conditionText, effectiveAllowedTools } from './conditions.js';
import { validateTokenBudget } from './token-budget.js';
import { FIXTURE_SCENARIO_VERSION, FIXTURE_TOOLS, scenarioDescriptor } from '../scenarios/index.js';
import { hostedPolicy, providerProfile } from '../providers/index.js';

export function seededOrder(ids: string[], seed: number): string[] {
    const result = [...ids];
    let n = seed >>> 0;
    for (let i = result.length - 1; i > 0; i--) {
        n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
        const j = n % (i + 1);
        [result[i], result[j]] = [result[j]!, result[i]!];
    }
    return result;
}

export { conditionText } from './conditions.js';

export function defaultFixtureConfiguration(): ExperimentConfig { return { schemaVersion: 1, experimentId: 'synthetic-fixture', configVersion: '1', label: 'Development fixture', phase: 'development', model: { provider: 'scripted', id: FIXTURE_SCENARIO_VERSION, settings: {} }, condition: { id: 'reviewed', version: '1', text: conditionText.reviewed }, roles: ['alpha', 'beta'].map(id => ({ id, instructions: `You are ${id}. Complete the synthetic task using your own context.`, allowedTools: [...FIXTURE_TOOLS] })), scenario: { version: FIXTURE_SCENARIO_VERSION, datasetId: 'two-fragments', datasetVersion: '1', datasetSeed: 17, assets: { alpha: 'blue', beta: 'circle' }, policy: 'Use only synthetic fixture data. State uncertainty when needed.', task: 'Contribute your role fragment to the shared list.' }, scheduler: { seed: 42, rounds: 3, toolCallsPerTurn: 3, order: [] }, board: { defaultPageSize: 10, maxPageSize: 50, maxPostLength: 2000 }, memory: { template: 'Private notes', version: '1', scope: 'thread', semanticRecall: false, observationalMemory: false, contextBudget: 32000 }, limits: { requestTimeoutMs: 30000, maxModelStepsPerTurn: 8, reportCalls: 1, retries: 0, maxDurationMs: 600000 }, artifactSchemaVersion: '1', reportSchemaVersion: '2', reportInstructions: 'Submit your final report by calling the submit_report tool exactly once with three non-empty string fields: ownActions, observations, limitations. Describe only your own actions; distinguish observations from uncertainty.', build: { revision: 'development', packages: {} } }; }

function validateConfigurationUnchecked(input: unknown): {
    valid: boolean;
    errors: string[];
} {
    const c = input as ExperimentConfig;
    const errors: string[] = [];
    if (!c || typeof c !== 'object')
        return { valid: false, errors: ['Configuration must be an object'] };
    if (c.schemaVersion !== 1)
        errors.push('schemaVersion must be 1');
    for (const key of ['experimentId', 'configVersion', 'label', 'artifactSchemaVersion', 'reportSchemaVersion', 'reportInstructions'] as const)
        if (typeof c[key] !== 'string' || !c[key].trim())
            errors.push(`${key} is required`);
    if (!['development', 'pilot', 'study'].includes(c.phase))
        errors.push('Invalid phase');
    if (!c.model?.provider || !c.model?.id || !c.model?.settings)
        errors.push('Exact model/provider/settings required');
    if (!c.condition || !(CONDITION_IDS as readonly string[]).includes(c.condition.id) || !c.condition.version || !c.condition.text)
        errors.push('Invalid versioned condition');
    if (!Array.isArray(c.roles) || c.roles.length < 1 || new Set(c.roles.map(r => r.id)).size !== c.roles.length || c.roles.some(r => typeof r.id !== 'string' || !r.id.trim() || typeof r.instructions !== 'string' || !r.instructions.trim() || !Array.isArray(r.allowedTools) || r.allowedTools.some(t => typeof t !== 'string')))
        errors.push('Unique roles, instructions and allowed tools required');
    for (const [name, value] of Object.entries({ rounds: c.scheduler?.rounds, toolCallsPerTurn: c.scheduler?.toolCallsPerTurn, defaultPageSize: c.board?.defaultPageSize, maxPageSize: c.board?.maxPageSize, maxPostLength: c.board?.maxPostLength, contextBudget: c.memory?.contextBudget, requestTimeoutMs: c.limits?.requestTimeoutMs, maxModelStepsPerTurn: c.limits?.maxModelStepsPerTurn, reportCalls: c.limits?.reportCalls, maxDurationMs: c.limits?.maxDurationMs }))
        if (!Number.isSafeInteger(value) || value < 1)
            errors.push(`${name} must be a positive integer`);
    if (!Number.isSafeInteger(c.scheduler?.seed) || !Number.isSafeInteger(c.scenario?.datasetSeed))
        errors.push('Separate integer scheduler and dataset seeds required');
    if (!c.scenario?.version || !c.scenario?.datasetId || !c.scenario?.datasetVersion || !c.scenario?.task || !c.scenario?.policy || c.scenario.assets === undefined)
        errors.push('Versioned scenario assets and prompts required');
    if (c.board?.defaultPageSize > c.board?.maxPageSize)
        errors.push('Default page exceeds maximum');
    if (c.memory?.scope !== 'thread' || c.memory?.semanticRecall !== false || c.memory?.observationalMemory !== false)
        errors.push('Private thread memory with optional recall off required');
    if (c.reportSchemaVersion !== '2')
        errors.push('reportSchemaVersion must be "2" (report submission is a submit_report tool call); recreate the draft from a preset');
    if (!Number.isInteger(c.limits?.reportCalls) || c.limits.reportCalls < 1 || c.limits.reportCalls > 5)
        errors.push('reportCalls must be an integer from 1 to 5');
    if (!c.model?.settings || Array.isArray(c.model.settings) || typeof c.model.settings !== 'object')
        errors.push('Model settings must be an object');
    if (c.limits?.retries !== 0)
        errors.push('v1 retries must be zero');
    if (!c.build?.revision || !c.build?.packages)
        errors.push('Build provenance required');
    const isRecord = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);
    const nonempty = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
    if (![c.model.provider, c.model.id, c.condition.version, c.condition.text, c.scenario.version, c.scenario.datasetId, c.scenario.datasetVersion, c.scenario.policy, c.scenario.task, c.memory.version, c.build.revision].every(nonempty))
        errors.push('Model, condition, scenario, memory and build identifiers/prompts must be nonempty strings');
    if (!isRecord(c.build.packages) || Object.values(c.build.packages).some(value => !nonempty(value)))
        errors.push('Package provenance must map package names to version strings');
    const isJson = (value: unknown, seen = new Set<object>()): boolean => {
        if (value === null || typeof value === 'string' || typeof value === 'boolean')
            return true;
        if (typeof value === 'number')
            return Number.isFinite(value);
        if (typeof value !== 'object' || seen.has(value))
            return false;
        if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
            return false;
        seen.add(value);
        const valid = Object.values(value).every(child => isJson(child, seen));
        seen.delete(value);
        return valid;
    };
    const hasCredentialKey = (value: unknown): boolean => {
        if (!value || typeof value !== 'object')
            return false;
        return Object.entries(value).some(([key, child]) => /api.?key|authorization|password|secret|access.?token|refresh.?token/i.test(key) || hasCredentialKey(child));
    };
    if (isJson(c.model.settings) && hasCredentialKey(c.model.settings))
        errors.push('Credentials must be supplied by backend environment, never model settings');
    if (!isJson(c.scenario.assets) || !isJson(c.model.settings))
        errors.push('Scenario assets and model settings must be finite JSON values');
    if (!isRecord(c.model.settings))
        errors.push('Settings must be a JSON object');
    else
        errors.push(...providerProfile(c.model.provider).validateSettings(c.model.settings));
    const hostedModelPolicy = hostedPolicy(c.model.provider);
    if (hostedModelPolicy)
        errors.push(...hostedModelPolicy.modelIdErrors(c.model.id));
    const profile = providerProfile(c.model.provider);
    if (profile.validateModel)
        errors.push(...profile.validateModel(c));
    if (c.memory.maxPrivateNoteCharacters !== undefined && (!Number.isSafeInteger(c.memory.maxPrivateNoteCharacters) || c.memory.maxPrivateNoteCharacters < 1)) errors.push('memory.maxPrivateNoteCharacters must be a positive integer');
    if (typeof c.memory.template !== 'string' || !c.memory.version)
        errors.push('Versioned neutral memory template required');
    if (c.scheduler.rounds > 10000 || c.scheduler.toolCallsPerTurn > 1000 || c.board.maxPageSize > 1000 || c.board.maxPostLength > 100000)
        errors.push('Configuration exceeds v1 bounded size limits');
    const descriptor = scenarioDescriptor(c.scenario.version);
    if (!descriptor) errors.push('scenario.version: Scenario runtime is not installed');
    else errors.push(...descriptor.validateConfiguration(c));
    errors.push(...validateTokenBudget(c));
    return { valid: errors.length === 0, errors };
}

function freeze<T>(v: T): T {
    if (v && typeof v === 'object') {
        Object.freeze(v);
        for (const child of Object.values(v))
            freeze(child);
    }
    return v;
}

export function resolveConfiguration(input: unknown): ExperimentConfig {
    const validation = validateConfiguration(input);
    if (!validation.valid)
        throw new Error(validation.errors.join('; '));
    const c = structuredClone(input as ExperimentConfig);
    c.scheduler.order = seededOrder(c.roles.map(r => r.id), c.scheduler.seed);
    // The frozen configuration records the tools that actually run, so no-board drops the board here.
    for (const role of c.roles)
        role.allowedTools = effectiveAllowedTools(c, role);
    return freeze(c);
}

export function resolvePair(input: unknown): [
    ExperimentConfig,
    ExperimentConfig
] {
    resolveConfiguration(input);
    // Each member starts from the input, not a resolved base, so a no-board input cannot leak its stripped tools into the pair.
    const pair = PAIR_CONDITION_IDS.map(id => resolveConfiguration({ ...structuredClone(input as ExperimentConfig), condition: { id, version: '1', text: conditionText[id] } })) as [
        ExperimentConfig,
        ExperimentConfig
    ];
    assertPairEquivalent(pair[0], pair[1]);
    return pair;
}

export function assertPairEquivalent(a: ExperimentConfig, b: ExperimentConfig): void {
    const strip = (c: ExperimentConfig) => ({ ...c, condition: undefined });
    if (JSON.stringify(strip(a)) !== JSON.stringify(strip(b)))
        throw new Error('Matched configurations differ outside condition');
}

export function validateConfiguration(input: unknown): {
    valid: boolean;
    errors: string[];
} {
    try {
        return validateConfigurationUnchecked(input);
    }
    catch {
        return { valid: false, errors: ['Malformed configuration structure'] };
    }
}
