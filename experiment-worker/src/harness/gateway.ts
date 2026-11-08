import { ScenarioValidationError } from './scenario.js';
import { z } from 'zod';
import type { ToolDefinition, Run, Role, MemorySnapshot, Json, Actor } from '@sidechannel/contracts/harness/contracts';
import type { Scenario, PrivateMemory } from '@sidechannel/contracts/harness/server';
import { effectiveAllowedTools } from '@sidechannel/domain/harness/conditions';

const object = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const commonTools: ToolDefinition[] = [
    { name: 'list_agents', description: 'List participating agents and lifecycle status', parameters: object() },
    { name: 'post_board', description: 'Post text to the shared board', parameters: object({ text: { type: 'string' } }, ['text']) },
    { name: 'read_board', description: 'Read latest messages or an older page by exclusive sequence cursor', parameters: object({ limit: { type: 'integer' }, beforeSequence: { type: 'integer' } }) },
    { name: 'update_working_memory', description: 'Replace your private working notes', parameters: object({ notes: { type: 'string' } }, ['notes']) },
    { name: 'end_turn', description: 'Yield your current turn', parameters: object() },
];

export function toolCatalog(run: Run, role: Role, scenario: Scenario): ToolDefinition[] {
    const allowed = effectiveAllowedTools(run.config, role);
    return [...commonTools, ...scenario.tools(run.config, role)].filter(t => allowed.includes(t.name));
}

export interface GatewayResult {
    result: Json;
    yielded: boolean;
    changed?: string;
    before?: unknown;
    after?: unknown;
}

export async function executeTool(run: Run, role: Role, scenario: Scenario, memory: PrivateMemory, snapshot: MemorySnapshot, actor: Actor, name: string, args: unknown): Promise<GatewayResult> {
    if (!effectiveAllowedTools(run.config, role).includes(name))
        return { result: { ok: false, error: 'Tool denied', disposition: 'denied' }, yielded: false };
    if (!args || typeof args !== 'object' || Array.isArray(args))
        return { result: { ok: false, error: 'Arguments must be an object' }, yielded: false };
    const definition = toolCatalog(run, role, scenario).find(t => t.name === name);
    if (!definition)
        return { result: { ok: false, error: 'Unknown tool' }, yielded: false };
    const validation = z.fromJSONSchema(definition.parameters).safeParse(args);
    if (!validation.success)
        return { result: { ok: false, error: 'Invalid arguments', disposition: 'invalid', details: validation.error.message }, yielded: false };
    const a = args as Record<string, unknown>;
    const allowedKeys: Record<string, string[]> = { list_agents: [], end_turn: [], post_board: ['text'], read_board: ['limit', 'beforeSequence'], update_working_memory: ['notes'] };
    if (name in allowedKeys && Object.keys(a).some(k => !allowedKeys[name]!.includes(k)))
        return { result: { ok: false, error: 'Unknown arguments' }, yielded: false };
    if (name === 'end_turn')
        return { result: { ok: true }, yielded: true };
    if (name === 'list_agents')
        return { result: { agents: run.config.roles.map(r => ({ id: r.id, status: run.activeAgentId === r.id ? 'currently_acting' : 'participating' })) }, yielded: false };
    if (name === 'post_board') {
        if (typeof a.text !== 'string' || !a.text.trim() || a.text.length > run.config.board.maxPostLength)
            return { result: { ok: false, error: 'Invalid post length' }, yielded: false };
        const message = { id: `${actor.operationId}:message`, runId: run.id, authorId: role.id, sequence: run.board.length + 1, timestamp: new Date().toISOString(), text: a.text };
        run.board.push(message);
        return { result: { ok: true, message }, yielded: false, changed: 'board_post', after: message };
    }
    if (name === 'read_board') {
        const limit = a.limit ?? run.config.board.defaultPageSize;
        const cursor = a.beforeSequence ?? Number.MAX_SAFE_INTEGER;
        if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > run.config.board.maxPageSize || !Number.isSafeInteger(cursor) || Number(cursor) < 1)
            return { result: { ok: false, error: 'Invalid board pagination' }, yielded: false };
        const eligible = run.board.filter(m => m.sequence < Number(cursor));
        const messages = eligible.slice(-Number(limit));
        const hasOlder = eligible.length > messages.length;
        return { result: { ok: true, messages: messages as unknown as Json[], hasOlder, beforeSequence: hasOlder ? messages[0]!.sequence : null }, yielded: false, changed: 'board_delivery', after: messages };
    }
    if (name === 'update_working_memory') {
        const noteLimit = run.config.memory.maxPrivateNoteCharacters ?? run.config.memory.contextBudget;
        if (typeof a.notes !== 'string' || a.notes.length > noteLimit)
            return { result: { ok: false, error: 'Invalid notes' }, yielded: false };
        const before = { version: snapshot.version, notes: snapshot.notes };
        snapshot.version++;
        snapshot.notes = a.notes;
        await memory.save(run.id, role.id, snapshot);
        return { result: { ok: true, version: snapshot.version }, yielded: false, changed: 'memory_updated', before, after: { version: snapshot.version, notes: snapshot.notes } };
    }
    if (!scenario.tools(run.config, role).some(t => t.name === name))
        return { result: { ok: false, error: 'Unknown tool' }, yielded: false };
    try {
        const before = structuredClone(run.artifacts.at(-1));
        const result = scenario.execute(run, actor, name, args);
        return { result: { ok: true, value: result }, yielded: false, ...(run.artifacts.at(-1)?.version !== before?.version ? { changed: 'artifact_updated', before, after: run.artifacts.at(-1) } : {}) };
    }
    catch (error) {
        if (!(error instanceof ScenarioValidationError))
            throw error;
        return { result: { ok: false, error: error.message, disposition: error.disposition, ...(error.details ? { details: error.details } : {}) }, yielded: false };
    }
}

const reportField = { type: 'string', minLength: 1 };
export const reportTools: ToolDefinition[] = [
    { name: 'submit_report', description: 'Submit your private final report. Call exactly once with all three fields.', parameters: object({ ownActions: reportField, observations: reportField, limitations: reportField }, ['ownActions', 'observations', 'limitations']) },
];

export function reportToolCatalog(): ToolDefinition[] { return reportTools; }

export type ReportValidation = { ok: true; value: { ownActions: string; observations: string; limitations: string } } | { ok: false; details: string };

export function validateReportCall(args: unknown): ReportValidation {
    const definition = reportTools[0]!;
    if (!args || typeof args !== 'object' || Array.isArray(args))
        return { ok: false, details: 'Arguments must be an object' };
    const validation = z.fromJSONSchema(definition.parameters).safeParse(args);
    if (!validation.success)
        return { ok: false, details: validation.error.message };
    return { ok: true, value: args as { ownActions: string; observations: string; limitations: string } };
}
