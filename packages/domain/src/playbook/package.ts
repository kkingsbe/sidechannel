import { createHash } from 'node:crypto';
import { playbookSchema, type Playbook, type PlaybookCatalogItem, type ValidatedPlaybook } from '@sidechannel/contracts/playbook/contracts';
import type { ExperimentConfig } from '@sidechannel/contracts/harness/contracts';

/** Canonical JSON (sorted keys, two-space indent, ASCII-escaped) shared with any external tooling that hashes playbooks. */
export function canonicalPlaybookJson(value: unknown): string {
    const order = (value: unknown): unknown => Array.isArray(value) ? value.map(order) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, order((value as Record<string, unknown>)[key])])) : value;
    return JSON.stringify(order(value), null, 2).replace(/[\u007f-￿]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')) + '\n';
}

export const playbookHash = (playbook: Playbook): string => createHash('sha256').update(canonicalPlaybookJson(playbook)).digest('hex');

/** Structural validation only; cross-checks against a run configuration live in `validatePlaybookForConfig`. */
export function validatePlaybook(input: unknown): ValidatedPlaybook {
    const parsed = playbookSchema.safeParse(input);
    if (!parsed.success) throw new Error(`Invalid playbook: ${parsed.error.issues.map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')}`);
    const playbook = parsed.data;
    if (!Object.keys(playbook.roles).length) throw new Error('Invalid playbook: roles must not be empty');
    const bytes = canonicalPlaybookJson(playbook);
    return { playbook, playbookHash: createHash('sha256').update(bytes).digest('hex'), playbookBytes: bytes };
}

export const playbookRounds = (playbook: Playbook): number => Math.max(0, ...Object.values(playbook.roles).map(role => role.turns.length));

export function playbookCatalogItem(value: ValidatedPlaybook, registeredAt: string): PlaybookCatalogItem {
    const p = value.playbook;
    return { playbookId: p.playbook_id, playbookVersion: p.playbook_version, displayName: p.display_name, ...(p.description ? { description: p.description } : {}), scenarioVersion: p.scenario_version, ...(p.dataset_id ? { datasetId: p.dataset_id } : {}), roles: Object.keys(p.roles).sort(), rounds: playbookRounds(p), playbookHash: value.playbookHash, registeredAt };
}

/**
 * Cross-checks an embedded playbook against the run it will drive. Returns `path: message` strings
 * in the same style as the other configuration validators; empty means compatible.
 */
export function validatePlaybookForConfig(playbook: Playbook, config: Pick<ExperimentConfig, 'roles' | 'scenario' | 'scheduler' | 'limits' | 'phase'>): string[] {
    const errors: string[] = [];
    const prefix = 'model.settings.playbook';
    if (config.phase === 'study') errors.push('phase: Playbook runs validate instrumentation and may not be study runs');
    if (playbook.scenario_version !== config.scenario.version) errors.push(`${prefix}: Playbook targets scenario ${playbook.scenario_version}, configuration uses ${config.scenario.version}`);
    if (playbook.dataset_id !== undefined && playbook.dataset_id !== config.scenario.datasetId) errors.push(`${prefix}: Playbook targets dataset ${playbook.dataset_id}, configuration uses ${config.scenario.datasetId}`);
    const configRoles = config.roles.map(role => role.id).sort(), playbookRoles = Object.keys(playbook.roles).sort();
    if (JSON.stringify(configRoles) !== JSON.stringify(playbookRoles)) errors.push(`${prefix}: Playbook roles [${playbookRoles.join(', ')}] must match configuration roles [${configRoles.join(', ')}]`);
    for (const [id, role] of Object.entries(playbook.roles)) {
        if (role.turns.length > config.scheduler.rounds) errors.push(`${prefix}: Role ${id} scripts ${role.turns.length} turns but the scheduler runs ${config.scheduler.rounds} rounds`);
        for (const [index, turn] of [...role.turns, ...(role.default_turn ? [role.default_turn] : [])].entries())
            if (turn.steps.length > config.limits.maxModelStepsPerTurn) errors.push(`${prefix}: Role ${id} turn ${index + 1} has ${turn.steps.length} steps but limits.maxModelStepsPerTurn is ${config.limits.maxModelStepsPerTurn}`);
    }
    return errors;
}
