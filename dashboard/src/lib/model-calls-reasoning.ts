/**
 * Reasoning-part extraction and availability classification for the model-call fold.
 * Split out of `model-calls.ts`; public names are re-exported there.
 */
import { isRecord, str, type ReasoningPart, type ReasoningState } from './model-calls-types';

/**
 * Heuristic: a part is a summary only when the provider says so. We look for a key
 * containing "summary" (case-insensitive, truthy value, depth <= 3) inside
 * `providerMetadata` / `providerOptions`, or `summary: true` / a `kind`/`format` mentioning
 * summary on the part itself. We never infer summary-ness from the text or its length.
 */
function isSummaryPart(part: Record<string, unknown>): boolean {
  if (part.summary === true) return true;
  for (const k of ['kind', 'format']) {
    const v = part[k];
    if (typeof v === 'string' && /summary/i.test(v)) return true;
  }
  const walk = (value: unknown, depth: number): boolean => {
    if (!isRecord(value) || depth > 3) return false;
    for (const [k, v] of Object.entries(value)) {
      if (/summary/i.test(k) && v !== false && v !== null && v !== undefined && v !== '') return true;
      if (walk(v, depth + 1)) return true;
    }
    return false;
  };
  return walk(part.providerMetadata, 0) || walk(part.providerOptions, 0);
}

/**
 * Extract reasoning text from a `model_response` event's `data`.
 * Sources, in order: `data.reasoning` (string), then for each `raw.steps[i]` the
 * `reasoning[]` parts of `type === 'reasoning'` with non-empty text; if a step has no
 * such parts, its `reasoningText` is used as a fallback. Reasoning is never inferred
 * from regular output text.
 */
export function extractReasoning(responseData: unknown): ReasoningPart[] {
  if (!isRecord(responseData)) return [];
  const out: ReasoningPart[] = [];
  if (typeof responseData.reasoning === 'string' && responseData.reasoning.trim()) {
    out.push({ text: responseData.reasoning, source: 'reasoning', summary: false });
  }
  const raw = responseData.raw;
  const steps = isRecord(raw) && Array.isArray(raw.steps) ? raw.steps : [];
  steps.forEach((step, i) => {
    if (!isRecord(step)) return;
    const before = out.length;
    if (Array.isArray(step.reasoning)) {
      step.reasoning.forEach((part, j) => {
        if (!isRecord(part) || part.type !== 'reasoning') return;
        const text = str(part.text);
        if (!text || !text.trim()) return;
        out.push({ text, source: `raw.steps[${i}].reasoning[${j}]`, summary: isSummaryPart(part) });
      });
    }
    if (out.length === before) {
      const t = str(step.reasoningText);
      if (t && t.trim()) out.push({ text: t, source: `raw.steps[${i}].reasoningText`, summary: false });
    }
  });
  return out;
}

/**
 * Decide which reasoning availability state applies. Checked in order:
 * scripted -> summary (all parts are summaries) / returned (any parts) ->
 * hidden (no parts, reasoningTokens > 0) -> not_returned (no parts, reasoningTokens === 0) -> unknown.
 */
export function classifyReasoning(args: {
  provider?: string;
  parts: ReasoningPart[];
  reasoningTokens?: number;
  usageSource?: string;
}): ReasoningState {
  const { provider, parts, reasoningTokens, usageSource } = args;
  if (provider === 'scripted' || usageSource === 'scripted') return 'scripted';
  if (parts.length > 0) return parts.every(p => p.summary) ? 'summary' : 'returned';
  if (usageSource !== 'unavailable' && typeof reasoningTokens === 'number') {
    return reasoningTokens > 0 ? 'hidden' : 'not_returned';
  }
  return 'unknown';
}
