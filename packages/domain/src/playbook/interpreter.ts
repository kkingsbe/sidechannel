import type { ModelInput, ModelResponse } from '@sidechannel/contracts/harness/server';
import type { Playbook } from '@sidechannel/contracts/playbook/contracts';

type Json = unknown;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const LOOKUP_KEYS = new Set(['$from', '$path', '$nth', '$default']);

function toolResults(input: ModelInput, tool: string): unknown[] {
    return input.messages.filter(m => m.role === 'tool' && m.toolName === tool).flatMap(m => {
        try { const result = JSON.parse(m.content).result; return result === undefined || (isRecord(result) && result.ok === false) ? [] : [result]; }
        catch { return []; }
    });
}
const pathSegments = (path: string): string[] => path.split(/[.[\]]/).filter(segment => segment !== '');

function lookup(input: ModelInput, spec: Record<string, unknown>): Json {
    const tool = spec.$from;
    if (typeof tool !== 'string' || !tool) throw new Error('Playbook operator $from needs a tool name');
    if (spec.$path !== undefined && typeof spec.$path !== 'string') throw new Error('Playbook operator $path must be a string');
    if (spec.$nth !== undefined && !Number.isInteger(spec.$nth)) throw new Error('Playbook operator $nth must be an integer');
    for (const key of Object.keys(spec)) if (!LOOKUP_KEYS.has(key)) throw new Error(`Playbook unknown operator key ${key} next to $from`);
    const results = toolResults(input, tool), nth = (spec.$nth as number | undefined) ?? -1;
    let value: unknown = results[nth < 0 ? results.length + nth : nth];
    for (const segment of pathSegments((spec.$path as string | undefined) ?? '')) {
        if (value === undefined || value === null || typeof value !== 'object') { value = undefined; break; }
        value = (value as Record<string, unknown>)[segment];
    }
    if (value !== undefined) return value;
    if ('$default' in spec) return spec.$default;
    throw new Error(`Playbook reference unresolved: ${tool} ${(spec.$path as string | undefined) ?? ''}`.trimEnd());
}

function resolve(input: ModelInput, value: Json): Json {
    if (Array.isArray(value)) return value.map(item => resolve(input, item));
    if (!isRecord(value)) return value;
    const keys = Object.keys(value);
    if ('$from' in value) return lookup(input, value);
    if (keys.length === 1 && keys[0] === '$stringify') return JSON.stringify(resolve(input, value.$stringify));
    if (keys.length === 1 && keys[0]!.startsWith('$')) throw new Error(`Playbook unknown operator ${keys[0]}`);
    return Object.fromEntries(keys.map(key => [key, resolve(input, value[key])]));
}

/** Pure and deterministic: every value comes from the playbook and this participant's delivered input. */
export function interpretPlaybook(playbook: Playbook): (input: ModelInput) => ModelResponse {
    return input => {
        const role = playbook.roles[input.agentId];
        if (!role) throw new Error(`Playbook has no role ${input.agentId}`);
        if (input.phase === 'report') return { text: '', toolCalls: [{ id: 'report', name: 'submit_report', arguments: role.report }] };
        const round = Number(input.messages.map(m => m.content.match(/Round: (\d+)\//)?.[1]).find(match => match !== undefined));
        if (!Number.isInteger(round) || round < 1) throw new Error(`Playbook cannot read the round from the system message for ${input.agentId} (${input.invocationId})`);
        const step = Number(input.invocationId.match(/:step:(\d+)/)?.[1]);
        if (!Number.isInteger(step)) throw new Error(`Playbook cannot read the step from invocation id ${input.invocationId}`);
        const turn = role.turns[round - 1] ?? role.default_turn;
        if (!turn) return { text: 'No scripted actions for this round.', toolCalls: [] };
        const definition = turn.steps[step];
        if (!definition) return { text: 'Scripted turn complete.', toolCalls: [] };
        return { text: '', toolCalls: definition.calls.map((call, index) => ({ id: call.id ?? `r${round}-s${step}-c${index}-${call.name}`, name: call.name, arguments: resolve(input, call.arguments ?? {}) })) };
    };
}
