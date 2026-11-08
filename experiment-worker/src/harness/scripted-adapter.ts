import type { ModelAdapter, ModelInput, ModelResponse } from '@sidechannel/contracts/harness/server';
import { HEALTHCARE_SCENARIO_VERSION } from '@sidechannel/contracts/healthcare/contracts';
import { FIXTURE_SCENARIO_VERSION } from '@sidechannel/domain/scenarios';
import { healthcareScript } from './healthcare-script.js';

export class ScriptedAdapter implements ModelAdapter {
    readonly inputs: ModelInput[] = [];
    constructor(private script: ModelResponse[] | ((input: ModelInput, index: number) => ModelResponse | Promise<ModelResponse>)) { }
    async complete(input: ModelInput): Promise<ModelResponse> { const index = this.inputs.length; this.inputs.push(structuredClone({ ...input, signal: undefined })); if (typeof this.script === 'function')
        return this.script(input, index); const response = this.script[index]; if (!response)
        throw new Error(`Script exhausted at ${index}`); return structuredClone(response); }
}

export function fixtureScript(input: ModelInput): ModelResponse {
    if (input.phase === 'report')
        return { text: '', toolCalls: [{ id: 'report', name: 'submit_report', arguments: { ownActions: 'Read my own synthetic fragment, posted it, saved private notes, and appended a shared artifact contribution.', observations: 'Read the shared board explicitly.', limitations: 'Scripted development fixture, not a model-generated research observation.' } }] };
    const turn = Number(input.invocationId.split(':turn:')[1]?.split(':')[0]);
    const round = Math.ceil(turn / 2);
    const step = Number(input.invocationId.split(':step:')[1]);
    const call = (id: string, name: string, args: unknown) => ({ id, name, arguments: args });
    const own = input.agentId === 'alpha' ? 'blue' : 'circle';
    if (round === 1)
        return { text: '', toolCalls: [call('data', 'read_role_data', {}), call('post', 'post_board', { text: `My synthetic fragment is ${own}.` }), call('note', 'update_working_memory', { notes: `My fragment: ${own}. Initial contribution posted.` })] };
    if (round === 2 && step === 0)
        return { text: '', toolCalls: [call('board', 'read_board', {}), call('artifact-read', 'read_artifact', {})] };
    if (round === 2) {
        const last = input.messages.filter(m => m.toolName === 'read_artifact').at(-1);
        const version = JSON.parse(last!.content).result.value.version;
        return { text: '', toolCalls: [call('artifact-update', 'update_artifact', { expectedVersion: version, value: own })] };
    }
    return { text: '', toolCalls: [call('note', 'update_working_memory', { notes: `My fragment: ${own}. Shared artifact contribution completed.` }), call('board', 'read_board', {}), call('yield', 'end_turn', {})] };
}

/** Scripted drivers are keyed by scenario version; descriptors name the expected model id. */
export const SCRIPTED_DRIVERS: Record<string, (input: ModelInput) => ModelResponse> = {
    [FIXTURE_SCENARIO_VERSION]: fixtureScript,
    [HEALTHCARE_SCENARIO_VERSION]: healthcareScript,
};

export function scriptedDriver(scenarioVersion: string): (input: ModelInput) => ModelResponse {
    const driver = SCRIPTED_DRIVERS[scenarioVersion];
    if (!driver) throw new Error(`Scripted driver unavailable: ${scenarioVersion}`);
    return driver;
}
