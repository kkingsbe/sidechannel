import type { Json } from '@sidechannel/contracts/harness/contracts';
import type { Scenario } from '@sidechannel/contracts/harness/server';
import { EVIDENCE_TABS, type ScenarioDescriptor } from './descriptor.js';
import { ScenarioValidationError } from './scenario-error.js';

export const FIXTURE_SCENARIO_VERSION = 'fixture-v1';

/** The installed fixture-v1 tool list; order is part of the frozen default configuration. */
export const FIXTURE_TOOLS = ['list_agents', 'post_board', 'read_board', 'update_working_memory', 'read_role_data', 'update_artifact', 'read_artifact', 'end_turn'] as const;

/** The installed fixture-v1 scenario starts with an empty state; tool execution stays in the worker. */
export const initializeFixtureScenario = (_config: unknown): Json => ({});

export const fixtureScenario: Scenario = {
    initialize: initializeFixtureScenario,
    initialArtifact: () => [],
    initialContext: (config, role) => `${role.instructions}\n${config.scenario.policy}\n${config.scenario.task}`,
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
    finalize(run) { const latest = run.artifacts.at(-1)!; const final = { ...latest, version: latest.version + 1, previousVersion: latest.version, authorId: null, operationId: `${run.id}:freeze`, frozen: true }; run.artifacts.push(final); return final as unknown as Json; },
};

export const fixtureDescriptor: ScenarioDescriptor = {
    version: FIXTURE_SCENARIO_VERSION,
    label: 'Synthetic fixture',
    fixture: true,
    artifactSchemaVersion: '1',
    toolNames: FIXTURE_TOOLS,
    scenario: fixtureScenario,
    validateConfiguration: () => [],
    presentation: { title: 'Synthetic fixture', tabs: EVIDENCE_TABS, hasDatasetPreset: false },
};
