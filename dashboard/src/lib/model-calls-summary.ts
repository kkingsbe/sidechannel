/**
 * One-line human summaries of recorded events for the timeline. Split out of
 * `model-calls.ts`; public names are re-exported there.
 */
import type { HarnessEvent } from '@sidechannel/contracts/browser';
import { isRecord, num, str, type ModelCall } from './model-calls-types';
import { formatTokens } from './model-calls-format';

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
        return `Model request${str(d.phase) ? ` · ${d.phase}` : ''}${m !== undefined ? ` · ${plural(m, 'message')}` : ''}${t !== undefined ? ` · ${plural(t, 'tool')}` : ''}`;
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
