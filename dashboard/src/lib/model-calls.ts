/**
 * Pure helpers that turn raw run events (HarnessEvent) into per-invocation
 * "model calls" for the dashboard. No React, no I/O.
 *
 * Events written by the worker for one model invocation (all share `invocationId`):
 *   context_accounted -> model_requested -> model_response -> model_usage
 * plus tool lifecycle events (tool_requested/admitted/result/unexecuted/failed/
 * deduplicated) that carry `invocationId` + `toolCallId`.
 *
 * Split into focused modules (`model-calls-types`, `-reasoning`, `-tools`, `-summary`,
 * `-format`); every previous export is re-exported here so the public import surface is
 * unchanged.
 */
import type { HarnessEvent } from '@sidechannel/contracts/browser';
import {
  MODEL_CALL_EVENT_TYPES,
  isRecord,
  num,
  str,
  type ModelCall,
  type ModelCallTokens,
  type ProposedToolCall,
} from './model-calls-types';
import { classifyReasoning, extractReasoning } from './model-calls-reasoning';
import { isToolStatusEvent, resolveToolStatus } from './model-calls-tools';
import { formatTokens, prettyArguments, safeJson } from './model-calls-format';

export type {
  ModelCall,
  ModelCallTokens,
  PageNav,
  ProposedToolCall,
  ReasoningPart,
  ReasoningState,
  ToolCallStatus,
} from './model-calls-types';
export { MODEL_CALL_EVENT_TYPES } from './model-calls-types';
export { classifyReasoning, extractReasoning } from './model-calls-reasoning';
export { buildToolNames, humanizeCode, summarizeEvent } from './model-calls-summary';
export { formatTokens, prettyArguments, safeJson } from './model-calls-format';

/* ------------------------------------------------------------------- build */

/**
 * Group events into one ModelCall per `invocationId`. Sorted by sequence; tolerant of
 * partial pages (e.g. a response without its request, or no usage yet).
 * `opts.provider` is the configured model provider (config.model.provider).
 */
export function buildModelCalls(events: HarnessEvent[], opts: { provider: string }): ModelCall[] {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const groups = new Map<string, HarnessEvent[]>();
  for (const e of sorted) {
    if (!e.invocationId) continue;
    if (!MODEL_CALL_EVENT_TYPES.has(e.type) && !isToolStatusEvent(e.type)) continue;
    const g = groups.get(e.invocationId);
    if (g) g.push(e); else groups.set(e.invocationId, [e]);
  }
  const calls: ModelCall[] = [];
  for (const [invocationId, evs] of groups) {
    // Skip groups with only tool lifecycle events (no model event at all).
    if (!evs.some(e => MODEL_CALL_EVENT_TYPES.has(e.type))) continue;
    const last = (type: string) => [...evs].reverse().find(e => e.type === type);
    const request = last('model_requested');
    const response = last('model_response');
    const usage = last('model_usage');
    const context = last('context_accounted');
    const first = evs[0];
    const reqData = isRecord(request?.data) ? request.data : undefined;
    const respData = isRecord(response?.data) ? response.data : undefined;
    const usageData = isRecord(usage?.data) ? usage.data : undefined;
    const ctxData = isRecord(context?.data) ? context.data : undefined;

    const reasoning = extractReasoning(response?.data);
    const usageObj = isRecord(usageData?.usage) ? usageData.usage : isRecord(respData?.usage) ? respData.usage : undefined;
    const usageSource = str(usageData?.source) ?? (usage && !usageObj ? 'unavailable' : undefined);
    // A usage object without a reasoningTokens field counts as 0 reasoning tokens.
    const reasoningTokens = usageObj && usageSource !== 'unavailable' ? (num(usageObj.reasoningTokens) ?? 0) : undefined;

    const phase = str(reqData?.phase) ?? str(ctxData?.phase) ?? str(usageData?.phase);
    const provider = str(usageData?.provider) ?? opts.provider;

    const tokens: ModelCallTokens = {
      context: num(ctxData?.measured) ?? num(ctxData?.estimated),
      input: usageObj ? num(usageObj.inputTokens) : undefined,
      output: usageObj ? num(usageObj.outputTokens) : undefined,
      reasoning: reasoningTokens,
    };

    const statusFor = (id: string): Pick<ProposedToolCall, 'status' | 'statusEvent' | 'reason'> =>
      resolveToolStatus(evs, id);
    const toolCalls: ProposedToolCall[] = [];
    const seen = new Set<string>();
    const proposed = Array.isArray(respData?.toolCalls) ? respData.toolCalls : [];
    for (const tc of proposed) {
      if (!isRecord(tc)) continue;
      const id = str(tc.id) ?? '';
      seen.add(id);
      toolCalls.push({ id, name: str(tc.name) ?? 'unknown', arguments: tc.arguments, ...statusFor(id) });
    }
    // Partial page: response missing, but lifecycle events still carry the calls.
    if (!response) {
      for (const e of evs) {
        if (e.type !== 'tool_requested' || !e.toolCallId || seen.has(e.toolCallId)) continue;
        const call = isRecord(e.data) && isRecord(e.data.call) ? e.data.call : undefined;
        seen.add(e.toolCallId);
        toolCalls.push({ id: e.toolCallId, name: str(call?.name) ?? 'unknown', arguments: call?.arguments, ...statusFor(e.toolCallId) });
      }
    }

    const raw = isRecord(respData?.raw) ? respData.raw : undefined;
    const reqTime = request ? Date.parse(request.timestamp) : NaN;
    const resTime = response ? Date.parse(response.timestamp) : NaN;

    calls.push({
      invocationId,
      agentId: first.agentId ?? str(reqData?.agentId),
      phase,
      round: first.round,
      turn: first.turn,
      ordinal: 0,
      request, response, usage, context,
      sequenceRange: [evs[0].sequence, evs[evs.length - 1].sequence],
      startedAt: evs[0].timestamp,
      finishedAt: evs[evs.length - 1].timestamp,
      latencyMs: Number.isFinite(reqTime) && Number.isFinite(resTime) ? Math.max(0, resTime - reqTime) : undefined,
      text: str(respData?.text) ?? '',
      reasoning,
      reasoningState: classifyReasoning({ provider, parts: reasoning, reasoningTokens, usageSource }),
      tokens,
      finishReason: str(raw?.finishReason) ?? str(respData?.finishReason),
      toolCalls,
      inputSummary: reqData
        ? { messages: Array.isArray(reqData.messages) ? reqData.messages.length : 0, tools: Array.isArray(reqData.tools) ? reqData.tools.length : 0 }
        : undefined,
    });
  }
  calls.sort((a, b) => a.sequenceRange[0] - b.sequenceRange[0]);
  calls.forEach((c, i) => { c.ordinal = i + 1; });
  for (const c of calls) if (!c.response) c.failure = findFailure(c, sorted);
  return calls;
}

/** The error ending (turn_ended with an error, or run_terminated) that follows a response-less call. */
function findFailure(call: ModelCall, sorted: HarnessEvent[]): ModelCall['failure'] {
  const lastSeq = call.sequenceRange[1];
  for (const e of sorted) {
    if (e.sequence <= lastSeq) continue;
    const d = isRecord(e.data) ? e.data : {};
    const sameTurn = e.agentId === call.agentId && e.round === call.round && e.turn === call.turn;
    const failedTurn = e.type === 'turn_ended' && sameTurn && (str(d.error) !== undefined || d.reason === 'error');
    if (!failedTurn && e.type !== 'run_terminated') continue;
    const reason = str(d.error) ?? str(d.reason) ?? 'error';
    const start = Date.parse(call.request?.timestamp ?? call.startedAt);
    const end = Date.parse(e.timestamp);
    return { reason, elapsedMs: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : undefined, event: e };
  }
  return undefined;
}

/* ------------------------------------------------------------------ search */

/** All case-insensitive, non-overlapping match ranges of `query` in `text`. */
export function findMatches(text: string, query: string): { start: number; end: number }[] {
  if (!query.trim() || !text) return [];
  const hay = text.toLowerCase();
  const needle = query.toLowerCase();
  const out: { start: number; end: number }[] = [];
  let i = hay.indexOf(needle);
  while (i !== -1) {
    out.push({ start: i, end: i + needle.length });
    i = hay.indexOf(needle, i + needle.length);
  }
  return out;
}

/** Total match count across a call's reasoning parts, output text, tool names and JSON tool arguments. */
export function countCallMatches(call: ModelCall, query: string): number {
  if (!query.trim()) return 0;
  let n = 0;
  for (const p of call.reasoning) n += findMatches(p.text, query).length;
  n += findMatches(call.text, query).length;
  for (const t of call.toolCalls) {
    n += findMatches(t.name, query).length;
    n += findMatches(safeJson(t.arguments), query).length;
  }
  return n;
}
