/**
 * Pure helpers that turn raw run events (HarnessEvent) into per-invocation
 * "model calls" for the dashboard. No React, no I/O.
 *
 * Events written by the worker for one model invocation (all share `invocationId`):
 *   context_accounted -> model_requested -> model_response -> model_usage
 * plus tool lifecycle events (tool_requested/admitted/result/unexecuted/failed/
 * deduplicated) that carry `invocationId` + `toolCallId`.
 */
import type { HarnessEvent } from '@sidechannel/contracts/browser';

/* ------------------------------------------------------------------ types */

export interface ReasoningPart {
  text: string;
  /** Where the text was found, e.g. `raw.steps[0].reasoning[1]` or `reasoning`. */
  source: string;
  /** True only when the provider explicitly marked the part as a summary. */
  summary: boolean;
}

export type ReasoningState = 'scripted' | 'returned' | 'summary' | 'hidden' | 'not_returned' | 'unknown';

export type ToolCallStatus = 'proposed' | 'admitted' | 'executed' | 'unexecuted' | 'failed' | 'deduplicated';

export interface ProposedToolCall {
  id: string;
  name: string;
  arguments: unknown;
  status: ToolCallStatus;
  /** The lifecycle event that determined `status` (absent for `proposed`). */
  statusEvent?: { id: string; sequence: number };
  /** Reason text for unexecuted / failed calls. */
  reason?: string;
}

export interface ModelCallTokens {
  /** Estimated/measured input context size from `context_accounted`. */
  context?: number;
  input?: number;
  output?: number;
  reasoning?: number;
}

export interface ModelCall {
  invocationId: string;
  agentId?: string;
  phase?: string;
  round?: number;
  turn?: number;
  /** 1-based position of this call among the calls of the input, ordered by first event sequence. */
  ordinal: number;
  request?: HarnessEvent;
  response?: HarnessEvent;
  usage?: HarnessEvent;
  context?: HarnessEvent;
  /** [min, max] event sequence across every event of this call (incl. tool lifecycle). */
  sequenceRange: [number, number];
  startedAt: string;
  finishedAt: string;
  /** Milliseconds between model_requested and model_response timestamps. */
  latencyMs?: number;
  /** Assistant text output ('' when none or when the response is missing). */
  text: string;
  reasoning: ReasoningPart[];
  reasoningState: ReasoningState;
  tokens: ModelCallTokens;
  finishReason?: string;
  toolCalls: ProposedToolCall[];
  inputSummary?: { messages: number; tools: number };
  /**
   * Set when the call never got a response and the same turn (or the run) then ended with an
   * error, e.g. a model request timeout. `elapsedMs` runs from the request to that ending.
   */
  failure?: { reason: string; elapsedMs?: number; event: HarnessEvent };
}

/** Event types that belong to a model call; the timeline folds these into one row. */
export const MODEL_CALL_EVENT_TYPES: ReadonlySet<string> = new Set([
  'context_accounted',
  'model_requested',
  'model_response',
  'model_usage',
]);

/** Where the visible page sits in the run's event stream; passed by the page that owns paging. */
export interface PageNav {
  hasPrevious: boolean;
  hasNext: boolean;
  /** Jump to the newest page; shown only when `hasNext`. */
  onJumpToLatest?: () => void;
}

/* --------------------------------------------------------------- utilities */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Format a number with thousands separators (en-US, stable across locales). */
export function formatTokens(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : String(n);
}

/** Compact/pretty JSON for display and search; never throws. */
/** Tool arguments for display: string values that hold JSON are parsed so nested payloads pretty-print. */
export function prettyArguments(value: unknown): string {
  const expand = (v: unknown, depth: number): unknown => {
    if (depth > 4) return v;
    if (typeof v === 'string') {
      const t = v.trim();
      if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
        try { return expand(JSON.parse(t), depth + 1); } catch { return v; }
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(x => expand(x, depth + 1));
    if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(x, depth + 1)]));
    return v;
  };
  return safeJson(expand(value, 0), 2) || '{}';
}

export function safeJson(value: unknown, space?: number): string {
  try { return JSON.stringify(value, null, space) ?? ''; } catch { return String(value); }
}

/* --------------------------------------------------------------- reasoning */

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

/* -------------------------------------------------------------- tool calls */

const TOOL_STATUS_BY_EVENT: Record<string, ToolCallStatus> = {
  tool_requested: 'proposed',
  tool_admitted: 'admitted',
  tool_result: 'executed',
  tool_unexecuted: 'unexecuted',
  tool_failed: 'failed',
  tool_deduplicated: 'deduplicated',
};

function reasonOf(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  const r = data.reason ?? data.error;
  return typeof r === 'string' ? r : undefined;
}

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
    if (!MODEL_CALL_EVENT_TYPES.has(e.type) && !(e.type in TOOL_STATUS_BY_EVENT)) continue;
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

    const statusFor = (id: string): Pick<ProposedToolCall, 'status' | 'statusEvent' | 'reason'> => {
      let latest: HarnessEvent | undefined;
      for (const e of evs) if (e.toolCallId === id && e.type in TOOL_STATUS_BY_EVENT) latest = e;
      if (!latest) return { status: 'proposed' };
      const reason = reasonOf(latest.data);
      return {
        status: TOOL_STATUS_BY_EVENT[latest.type],
        statusEvent: { id: latest.id, sequence: latest.sequence },
        ...(reason ? { reason } : {}),
      };
    };
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

/* ----------------------------------------------------------- summarizeEvent */

const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const CODE_LABELS: Record<string, string> = {
  explicit_yield: 'yielded turn',
  budget_exhausted: 'action budget used up',
  allowance_exhausted: 'action allowance used up',
  memory_updated: 'memory updated',
  board_post: 'board post',
  board_delivery: 'board delivery',
};

/** Plain label for an event or reason code: "budget_exhausted" -> "action budget used up". */
export function humanizeCode(code: string): string {
  return CODE_LABELS[code] ?? code.replace(/[_-]+/g, ' ').trim();
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const oneLine = (s: string, max = 120) => clip(s.replace(/\s+/g, ' ').trim(), max);

/** Tool name by toolCallId from every event that records a call (not only the model response). */
export function buildToolNames(events: HarnessEvent[], calls: ModelCall[] = []): Map<string, string> {
  const names = new Map<string, string>();
  for (const e of events) {
    if (!e.toolCallId || !isRecord(e.data) || !isRecord(e.data.call)) continue;
    const name = str(e.data.call.name);
    if (name) names.set(e.toolCallId, name);
  }
  for (const c of calls) for (const t of c.toolCalls) if (t.name !== 'unknown') names.set(t.id, t.name);
  return names;
}

function describeToolResult(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  if (result.ok === false) return `error: ${str(result.error) ?? 'failed'}`;
  if (Array.isArray(result.messages)) return plural(result.messages.length, 'message');
  if (Array.isArray(result.agents)) return plural(result.agents.length, 'agent');
  const holder = isRecord(result.value) ? result.value : result;
  if (typeof holder.version === 'number') {
    const rest = Object.entries(holder).filter(([k]) => k !== 'version' && k !== 'ok');
    if (rest.every(([, v]) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0))) {
      return `version ${holder.version}, empty`;
    }
    const first = rest.map(([, v]) => (typeof v === 'string' ? v : '')).find(Boolean);
    return first ? `version ${holder.version}, ${oneLine(first, 80)}` : `version ${holder.version}`;
  }
  if (isRecord(result.value)) {
    const entries = Object.entries(result.value);
    if (entries.length === 0) return 'empty';
    return oneLine(entries.map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? '…' : String(v)}`).join(' · '), 100);
  }
  return undefined;
}

/** Payload-derived one-liner for recorded side-effect events (board, memory, artifact). */
function describeChange(e: HarnessEvent, d: Record<string, unknown>): string | undefined {
  const after = d.after;
  const who = e.agentId ?? 'agent';
  switch (e.type) {
    case 'board_post':
    case 'board_posted': {
      const text = isRecord(after) ? str(after.text) : str(d.text);
      const author = (isRecord(after) ? str(after.authorId) : undefined) ?? who;
      return text ? `${author} posted: ${oneLine(text)}` : undefined;
    }
    case 'board_delivery':
    case 'board_delivered': {
      if (!Array.isArray(after)) return undefined;
      if (after.length === 0) return `no new posts delivered to ${who}`;
      const seqs = after.map(m => (isRecord(m) ? num(m.sequence) : undefined)).filter((n): n is number => n !== undefined);
      const range = seqs.length > 1 ? ` #${Math.min(...seqs)}–#${Math.max(...seqs)}` : seqs.length === 1 ? ` #${seqs[0]}` : '';
      return `delivered ${after.length === 1 ? 'post' : 'posts'}${range} to ${who}`;
    }
    case 'memory_updated': {
      if (!isRecord(after)) return undefined;
      const notes = str(after.notes) ?? '';
      const before = isRecord(d.before) ? str(d.before.notes) ?? '' : '';
      const lines = (t: string) => (t.trim() ? t.trim().split('\n').length : 0);
      const delta = lines(notes) - lines(before);
      const version = num(after.version);
      const head = `memory${version !== undefined ? ` v${version}` : ''}${delta ? ` (${delta > 0 ? '+' : '−'}${plural(Math.abs(delta), 'line')})` : ''}`;
      const first = notes.split('\n').find(l => l.trim());
      return first ? `${head}: ${oneLine(first, 90)}` : head;
    }
    case 'artifact_updated': {
      if (!isRecord(after)) return undefined;
      const version = num(after.version);
      return `artifact${version !== undefined ? ` v${version}` : ''} updated`;
    }
    default: return undefined;
  }
}

/**
 * One-line human summary of an event; never throws. `toolNames` (toolCallId → name) lets
 * events that carry only a toolCallId, such as tool_result, name the tool.
 */
export function summarizeEvent(e: HarnessEvent, toolNames?: ReadonlyMap<string, string>): string {
  try {
    const d = isRecord(e.data) ? e.data : {};
    const callName = () => (isRecord(d.call) ? str(d.call.name) : undefined)
      ?? (e.toolCallId ? toolNames?.get(e.toolCallId) : undefined) ?? e.toolCallId ?? 'tool';
    switch (e.type) {
      case 'run_started': return 'Run started';
      case 'run_completed': return 'Run completed';
      case 'run_terminated': return clip(`Run terminated${str(d.status) ? `: ${d.status}` : ''}${str(d.reason) ? ` · ${d.reason}` : ''}`);
      case 'turn_started': {
        const allowance = num(d.allowance);
        const parts = [allowance === undefined ? 'Allowance ? actions' : `Allowance ${plural(allowance, 'action')}`];
        if (num(d.orderPosition) !== undefined) parts.push(`order position ${d.orderPosition}`);
        return parts.join(' · ');
      }
      case 'turn_ended': {
        const left = num(d.remainingAllowance);
        return clip(`Ended: ${humanizeCode(str(d.reason) ?? 'unknown')}${left !== undefined ? ` · ${plural(left, 'action')} left` : ''}${str(d.error) ? ` · ${d.error}` : ''}`);
      }
      case 'context_accounted': {
        const n = num(d.measured) ?? num(d.estimated);
        return `Context ${n !== undefined ? formatTokens(n) : '?'} tokens${num(d.measured) === undefined ? ' (est.)' : ''}${str(d.phase) ? ` · ${d.phase}` : ''}`;
      }
      case 'context_limit_exceeded': {
        const limit = num(d.limit);
        return `Context limit exceeded${limit !== undefined ? ` (limit ${formatTokens(limit)})` : ''}`;
      }
      case 'model_requested': {
        const m = Array.isArray(d.messages) ? d.messages.length : undefined;
        const t = Array.isArray(d.tools) ? d.tools.length : undefined;
        return `Model request${str(d.phase) ? ` · ${d.phase}` : ''}${m !== undefined ? ` · ${m} messages` : ''}${t !== undefined ? ` · ${t} tools` : ''}`;
      }
      case 'model_response': {
        const calls = Array.isArray(d.toolCalls) ? d.toolCalls.length : 0;
        const text = str(d.text)?.trim();
        return clip(`Model response · ${calls} tool call${calls === 1 ? '' : 's'}${text ? ` · ${text.replace(/\s+/g, ' ')}` : ''}`);
      }
      case 'model_usage': {
        const u = isRecord(d.usage) ? d.usage : undefined;
        return u
          ? `Usage · ${formatTokens(num(u.inputTokens) ?? 0)} in · ${formatTokens(num(u.outputTokens) ?? 0)} out`
          : `Usage ${str(d.source) ?? 'unavailable'}`;
      }
      case 'tool_requested': return `${callName()} · requested`;
      case 'tool_admitted': return `${callName()} · admitted${num(d.remainingAllowance) !== undefined ? ` · ${d.remainingAllowance} left` : ''}`;
      case 'tool_result': {
        const detail = describeToolResult(d.result);
        return clip(`${callName()} · ${str(d.disposition) ?? 'executed'}${detail ? ` → ${detail}` : ''}`);
      }
      case 'tool_unexecuted': return clip(`${callName()} · unexecuted${str(d.reason) ? `: ${humanizeCode(String(d.reason))}` : ''}`);
      case 'tool_failed': return clip(`${callName()} · failed${str(d.reason) ? `: ${d.reason}` : ''}`);
      case 'tool_deduplicated': return `${callName()} · deduplicated`;
      case 'report_submitted': return d.invalid ? 'Report submitted · invalid' : 'Report submitted';
      case 'report_missing': return clip(`Report missing${str(d.reason) ? `: ${d.reason}` : ''}`);
      default: {
        const change = describeChange(e, d);
        if (change) return clip(change);
        const bits: string[] = [];
        for (const [k, v] of Object.entries(d)) {
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') bits.push(`${k}: ${v}`);
        }
        return clip(bits.join(' · ') || String(e.type).replace(/_/g, ' '));
      }
    }
  } catch {
    return String(e?.type ?? 'event');
  }
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
