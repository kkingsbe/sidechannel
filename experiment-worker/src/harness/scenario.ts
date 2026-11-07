import { initializeFixtureScenario } from '@sidechannel/domain/harness/scenario-initialization';
import type { Scenario } from '@sidechannel/contracts/harness/server';
import type { Json } from '@sidechannel/contracts/harness/contracts';

export class ScenarioValidationError extends Error {
    /** `details` is returned to the acting agent so it can correct the call. */
    constructor(message: string, readonly disposition: 'invalid' | 'denied' = 'invalid', readonly details?: string) { super(message); }
}

export const fixtureScenario: Scenario = {
    initialize: initializeFixtureScenario, initialContext: (config, role) => `${role.instructions}\n${config.scenario.policy}\n${config.scenario.task}`,
    tools: () => [{ name: 'read_role_data', description: 'Read your own synthetic fragment', parameters: { type: 'object', properties: {}, additionalProperties: false } }, { name: 'read_artifact', description: 'Read shared artifact', parameters: { type: 'object', properties: {}, additionalProperties: false } }, { name: 'update_artifact', description: 'Append one fragment using the current version', parameters: { type: 'object', properties: { expectedVersion: { type: 'integer' }, value: { type: 'string' } }, required: ['expectedVersion', 'value'], additionalProperties: false } }],
    execute(run, actor, name, args) {
        const a = args as Record<string, unknown>;
        if (name === 'read_role_data')
            return { fragment: (run.config.scenario.assets as Record<string, Json>)[actor.agentId] ?? null };
        const latest = run.artifacts.at(-1)!;
        if (name === 'read_artifact')
            return latest as unknown as Json;
        if (name === 'update_artifact') {
            if (latest.frozen || !a || a.expectedVersion !== latest.version || typeof a.value !== 'string' || a.value.length > 2000)
                throw new ScenarioValidationError('Invalid artifact update or version conflict');
            const next = { version: latest.version + 1, previousVersion: latest.version, authorId: actor.agentId, value: [...(latest.value as Json[]), a.value], operationId: actor.operationId, frozen: false };
            run.artifacts.push(next);
            return next as unknown as Json;
        }
        throw new Error('Unknown scenario tool');
    },
    finalize(run) { const latest = run.artifacts.at(-1)!; const final = { ...latest, version: latest.version + 1, previousVersion: latest.version, authorId: null, operationId: `${run.id}:freeze`, frozen: true }; run.artifacts.push(final); return final as unknown as Json; }
};
