/**
 * Live leak A/B (v2 spec section 12). Not a CI test: it calls TypeSafe with a real key.
 *
 *   tsx --env-file-if-exists=../../.env jev-leak-smoke.ts <analysis-export.ndjson> [--sample 12] [--seed leak-ab-1] [--model jev-1.14.0]
 *
 * Reads an analysis export (`GET /api/jev/analyses/:id/export`, docs/jev-analysis.md step 9), rebuilds each sampled window
 * with the v1 shaping (v1 serialization with the static context in the state, prose questions) and the v2 shaping (evidence-only
 * state, structured questions with per-question background), scores both against the same codebook, and prints the per-code
 * mean shift. Acceptance: `visibility` within 0.05 of the v1 no-condition baseline from the research brief, and no behavioral code
 * shifted by more than 0.05 in either direction. Uses TYPESAFE_API_KEY or TYPESAFE_AI_API_KEY from the environment.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { CanonicalStep, SerializedWindow } from '@sidechannel/contracts/analysis/evidence-contracts';
import { questionKey, type JevQuestion, type JevRequest, type SystemOnePayload } from '@sidechannel/contracts/analysis/jev-provider';
import type { AnalysisJob, WindowRecord } from '@sidechannel/contracts/analysis/jev-repository';
import { buildBehaviorQuestions, buildBehaviorQuestionsV1, buildSystemOnePayload, scoredDefinitions, toBudgetQuestion, DEFAULT_JEV_MODEL } from '@sidechannel/domain/analysis/jev-questions';
import { preflightWindow, serializeWindowV1, serializeWindowV2 } from '@sidechannel/domain/analysis/serialization';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1]! : fallback; };
const path = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
const apiKey = process.env.TYPESAFE_API_KEY ?? process.env.TYPESAFE_AI_API_KEY;
if (!path) throw new Error('Usage: jev-leak-smoke.ts <analysis-export.ndjson> [--sample N] [--seed S] [--model M]');
if (!apiKey?.trim()) throw new Error('Configure TYPESAFE_API_KEY or TYPESAFE_AI_API_KEY for the live leak A/B.');
const sampleSize = Number(flag('sample', '12')), seed = flag('seed', 'leak-ab-1'), model = flag('model', DEFAULT_JEV_MODEL);

// Rebuild artifacts from the export: group artifact_chunk records by id, order by index, concatenate, parse.
const chunks = new Map<string, { index: number; text: string }[]>();
let job: AnalysisJob | undefined;
const windows: WindowRecord[] = [];
for (const line of (await readFile(path, 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { type: string; data: any };
    if (row.type === 'manifest') job = row.data.job;
    else if (row.type === 'window') windows.push(row.data);
    else if (row.type === 'artifact_chunk') chunks.set(row.data.id, [...(chunks.get(row.data.id) ?? []), { index: row.data.index, text: row.data.text }]);
}
if (!job) throw new Error('The export has no manifest record.');
const artifact = <T>(id: string): T => JSON.parse((chunks.get(id) ?? (() => { throw new Error(`Artifact ${id} is not in the export`); })()).sort((a, b) => a.index - b.index).map(c => c.text).join('')) as T;

const source = artifact<{ steps: CanonicalStep[]; staticContext: { text: string } }>(job.manifest.sourceArtifact);
const context = JSON.parse(source.staticContext.text) as { task: string; policy: string; condition: string };
const settings = job.manifest.settings, definitions = scoredDefinitions(job.manifest.codebook.definitions);
const background = { task: context.task, policy: context.policy };
const byId = new Map(source.steps.map(step => [step.id, step]));

// Seeded sample of windows that carried evidence.
const rank = (id: string): string => createHash('sha256').update(`${seed}:${id}`).digest('hex');
const sample = windows.filter(w => w.status === 'completed').sort((a, b) => rank(a.id) < rank(b.id) ? -1 : 1).slice(0, sampleSize);
if (!sample.length) throw new Error('No completed windows in the export to sample.');

/** Plain HTTPS to the documented endpoint (the SDK is not a dependency of this package). */
async function systemOne(payload: SystemOnePayload): Promise<{ answers: Record<string, { type: string; noul?: number }> }> {
    const response = await fetch('https://api.typesafe.ai/v1/systemone', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`TypeSafe returned HTTP ${response.status}`);
    return await response.json() as { answers: Record<string, { type: string; noul?: number }> };
}

/** Scores one shaping of one window across its preflight batches; returns noul probabilities by question key. */
async function score(serialized: SerializedWindow, questions: JevQuestion[], forbiddenText?: string[]): Promise<Map<string, number>> {
    const budget = preflightWindow(serialized, questions.map(toBudgetQuestion), settings.inputLimits);
    if (budget.oversized) throw new Error(budget.reason);
    const out = new Map<string, number>();
    for (const batch of budget.batches) {
        const wanted = questions.filter(q => batch.codeIds.includes(questionKey(q)));
        const request: JevRequest = { state: serialized.state, questions: wanted, model, ...(forbiddenText ? { forbiddenText } : {}) };
        const { payload, keyMap } = buildSystemOnePayload(request);
        const result = await systemOne(payload);
        for (const [key, answer] of Object.entries(result.answers)) if (answer.type === 'noul' && typeof answer.noul === 'number') out.set(keyMap[key]!, answer.noul);
    }
    return out;
}

const v1 = new Map<string, number[]>(), v2 = new Map<string, number[]>(), push = (map: Map<string, number[]>, key: string, value: number) => map.set(key, [...(map.get(key) ?? []), value]);
for (const record of sample) {
    const steps = record.stepIds.map(id => byId.get(id)!);
    const window = { id: record.id, index: record.index, startOrdinal: record.startOrdinal, endOrdinal: record.endOrdinal, stepIds: record.stepIds, eventIds: record.eventIds, partial: record.partial, incomplete: record.incomplete };
    const old = serializeWindowV1(window, steps, settings.evidence, source.staticContext.text, settings.inputLimits.estimatorVersion);
    const next = serializeWindowV2(window, steps, settings.evidence, settings.inputLimits.estimatorVersion);
    const [a, b] = await Promise.all([
        score(old, buildBehaviorQuestionsV1(definitions)),
        score(next, buildBehaviorQuestions(definitions, { activeAgents: next.activeAgents ?? [], background }), [context.condition]),
    ]);
    for (const [key, value] of a) push(v1, key.split('@')[0]!, value);
    for (const [key, value] of b) push(v2, key.split('@')[0]!, value);
    process.stderr.write(`scored ${record.id}\n`);
}

const mean = (values: number[] | undefined): number | undefined => values?.length ? values.reduce((total, value) => total + value, 0) / values.length : undefined;
const rows = definitions.map(definition => {
    const before = mean(v1.get(definition.id)), after = mean(v2.get(definition.id));
    return { code: definition.id, v1: before?.toFixed(3) ?? '-', v2: after?.toFixed(3) ?? '-', shift: before !== undefined && after !== undefined ? +(after - before).toFixed(3) : null };
});
console.table(rows);
const visibility = rows.find(row => row.code === 'visibility');
const outliers = rows.filter(row => row.shift !== null && Math.abs(row.shift) > 0.05 && row.code !== 'visibility');
console.log(JSON.stringify({ analysis: job.id, windows: sample.length, model, visibilityShift: visibility?.shift ?? null,
    note: 'visibility is expected to FALL toward the v1 no-condition baseline; compare against the brief. Other codes should move by at most 0.05.',
    codesShiftedOverThreshold: outliers.map(row => row.code) }, null, 2));
