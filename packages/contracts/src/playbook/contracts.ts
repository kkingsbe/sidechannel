import { z } from 'zod';

/**
 * Scripted playbooks: deterministic per-role tool-call transcripts that run through the real
 * scheduler and scenario tools. They validate instrumentation and labels; they are never
 * study observations, so a playbook run can never carry phase "study".
 */
export const PLAYBOOK_FORMAT_VERSION = 'sidechannel-playbook-v1';
/** `ExperimentConfig.model.provider` value that selects a registered playbook by `model.id`. */
export const PLAYBOOK_PROVIDER = 'playbook';
/** Model settings keys the playbook provider owns. `playbook` and `playbookHash` are server-embedded at launch. */
export const PLAYBOOK_SETTINGS_KEYS = ['playbookVersion', 'playbook', 'playbookHash'] as const;

const identifier = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const version = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/);
const json: z.ZodType<unknown> = z.lazy(() => z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(json), z.record(z.string(), json)]));

/**
 * Argument values are literal JSON. Two operator objects are resolved by the interpreter at run time:
 *   { "$from": "<toolName>", "$path": "value.version", "$nth": -1, "$default": <json> }
 *     The most recent (or `$nth`, 0-based, negative from the end) successful result of that tool in this
 *     role's own delivered tool messages, optionally narrowed by a dot/bracket path such as
 *     "value.messages[0].sequence". Results whose `ok` is false are skipped. Unresolvable without a
 *     `$default` fails the run loudly.
 *   { "$stringify": <value> }
 *     Resolves the inner value recursively, then JSON.stringify's it (for board posts of structured data).
 */
export const playbookCallSchema = z.strictObject({
    /** Optional stable call id; the interpreter generates one from turn/step/index otherwise. */
    id: z.string().min(1).max(80).optional(),
    name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    arguments: json.optional(),
});
/** One model response: the scheduler executes these calls in order, then asks for the next step unless the turn ended. */
export const playbookStepSchema = z.strictObject({ calls: z.array(playbookCallSchema).max(100) });
/** One scheduled turn. When steps run out before the turn ended, the interpreter returns a text-only response, which ends the turn. */
export const playbookTurnSchema = z.strictObject({ steps: z.array(playbookStepSchema).min(1).max(100) });
export const playbookReportSchema = z.strictObject({ ownActions: z.string().min(1), observations: z.string().min(1), limitations: z.string().min(1) });
export const playbookRoleSchema = z.strictObject({
    /** `turns[r - 1]` runs in round r. Rounds beyond the array use `default_turn`, or end immediately with no calls. */
    turns: z.array(playbookTurnSchema).max(10000),
    default_turn: playbookTurnSchema.optional(),
    report: playbookReportSchema,
});
export const playbookSchema = z.strictObject({
    format_version: z.literal(PLAYBOOK_FORMAT_VERSION),
    playbook_id: identifier,
    playbook_version: version,
    display_name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    /** Must equal `config.scenario.version` of the run. */
    scenario_version: z.string().min(1),
    /** When present, must equal `config.scenario.datasetId`. */
    dataset_id: z.string().min(1).optional(),
    /** Keys must be exactly the run's role ids. */
    roles: z.record(z.string().min(1), playbookRoleSchema),
});
export type Playbook = z.infer<typeof playbookSchema>;
export type PlaybookRole = z.infer<typeof playbookRoleSchema>;
export type PlaybookTurn = z.infer<typeof playbookTurnSchema>;
export type PlaybookStep = z.infer<typeof playbookStepSchema>;
export type PlaybookCall = z.infer<typeof playbookCallSchema>;

/** Browser-safe catalog row. */
export interface PlaybookCatalogItem {
    playbookId: string;
    playbookVersion: string;
    displayName: string;
    description?: string;
    scenarioVersion: string;
    datasetId?: string;
    roles: string[];
    /** Longest `turns` array across roles. */
    rounds: number;
    /** sha256 of the canonical playbook JSON. */
    playbookHash: string;
    registeredAt: string;
}
export interface ValidatedPlaybook {
    playbook: Playbook;
    playbookHash: string;
    /** Canonical JSON (sorted keys) the hash was computed over. */
    playbookBytes: string;
}
