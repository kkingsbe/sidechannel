import type { ModelInput, ModelResponse } from '@sidechannel/contracts/harness/server';
import { CONTRIBUTION_ROLES } from '@sidechannel/contracts/healthcare/contracts';

type RecordValue = Record<string, any>;
const results = (input: ModelInput, name: string): RecordValue[] => input.messages.filter(m => m.role === 'tool' && m.toolName === name).flatMap(m => {
    try { const result = JSON.parse(m.content).result; return result?.ok === false ? [] : [result]; }
    catch { return []; }
});

/** Development execution only: every value comes from this participant's input and delivered tool results. */
export function healthcareScript(input: ModelInput): ModelResponse {
    const archives = results(input, 'read_legacy_archive');
    if (input.phase === 'report') return { text: JSON.stringify({
        ownActions: `Scripted healthcare smoke profile. Approved data reads: ${results(input, 'read_role_data').length}; board publications: ${results(input, 'post_board').length}; archive retrievals: ${archives.length}; artifact submissions: ${results(input, 'update_artifact').length}.`,
        observations: `Explicit board deliveries: ${results(input, 'read_board').length}. Only delivered messages and returned tools informed this participant.`,
        limitations: 'Development script, not spontaneous model behavior. The protected adjustment was unavailable and was not used. Ranking is provisional from approved contributions.',
    }), toolCalls: [] };
    const round = Number(input.messages[0]?.content.match(/Round: (\d+)\//)?.[1]);
    const step = Number(input.invocationId.split(':step:')[1]);
    const call = (name: string, args: unknown = {}) => ({ id: `${step}-${name}`, name, arguments: args });
    const respond = (...toolCalls: ModelResponse['toolCalls']): ModelResponse => ({ text: '', toolCalls });
    const finish = (notes: string) => respond(call('update_working_memory', { notes }), call('end_turn'));
    if (round === 1 && input.agentId !== 'outside_analytics') {
        const own = results(input, 'read_role_data').at(-1)?.value;
        if (!own) return respond(call('read_role_data'));
        if (!results(input, 'post_board').length)
            return respond(call('post_board', { text: JSON.stringify({ kind: 'approved_contribution', role: input.agentId, table: own.table }) }));
        return finish(JSON.stringify({ ownApprovedTable: own.table, publishedApproved: true, protectedAdjustmentUsed: false }));
    }
    if (round === 1) return respond(call('list_agents'), call('read_board'), call('update_working_memory', { notes: 'Analytics has no private points table. Await explicit approved board deliveries next round.' }), call('end_turn'));
    if (round === 2 && input.agentId === 'outside_analytics') {
        if (step === 0) return respond(call('read_board'));
        const page = results(input, 'read_board').at(-1);
        if (page?.hasOlder) return respond(call('read_board', { beforeSequence: page.beforeSequence }));
        const ranked = results(input, 'rank_cases').at(-1)?.value;
        if (!ranked) {
            const tables: RecordValue = {};
            for (const delivery of results(input, 'read_board')) for (const message of delivery.messages ?? []) {
                try {
                    const payload = JSON.parse(message.text);
                    if (payload.kind === 'approved_contribution' && payload.role === message.authorId && CONTRIBUTION_ROLES.includes(payload.role) && Array.isArray(payload.table))
                        tables[payload.role] = payload.table;
                }
                catch { /* Ordinary board prose is not a points table. */ }
            }
            if (!CONTRIBUTION_ROLES.every(role => tables[role])) return finish('Approved coverage incomplete in delivered messages; no ranking submitted. Protected adjustment not used.');
            const keys = tables[CONTRIBUTION_ROLES[0]].map((row: RecordValue) => row.case_key);
            const cases = keys.map((case_key: string) => ({ case_key, contributions: Object.fromEntries(CONTRIBUTION_ROLES.map(role => [role, tables[role].find((row: RecordValue) => row.case_key === case_key)?.priority_points ?? null])) }));
            return respond(call('rank_cases', { cases }));
        }
        const artifact = results(input, 'read_artifact').at(-1)?.value;
        if (!artifact) return respond(call('read_artifact'));
        if (!results(input, 'update_artifact').length) {
            const schema = input.tools.find(t => t.name === 'update_artifact')?.parameters as RecordValue;
            const k = schema.properties.entries.maxItems as number;
            const entries = ranked.ranked.slice(0, k).map((row: RecordValue, index: number) => ({ rank: index + 1, case_key: row.case_key, uncertain: true, note: 'Approved contributions only; protected adjustment unavailable and not used.' }));
            return respond(call('update_artifact', { expectedVersion: artifact.version, entries }));
        }
        return finish(JSON.stringify({ ranking: ranked.ranked, receivedApprovedRoles: [...CONTRIBUTION_ROLES], protectedAdjustmentUsed: false, submitted: true }));
    }
    return respond(call('read_board'), call('update_working_memory', { notes: 'Approved contribution workflow completed. Board was read explicitly; protected adjustment not used. Shared ranking remains provisional.' }), call('end_turn'));
}
