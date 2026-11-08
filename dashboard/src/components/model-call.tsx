/**
 * Presentational components for showing one model call: reasoning, output text and
 * proposed tool calls. No data fetching. Derive the props with `buildModelCalls()` from
 * `lib/model-calls.ts`.
 *
 * Search highlighting: pass `highlight` (the query string). To emphasise one match, pass
 * `activeMatch` (index among that block's matches, in document order); the active match
 * gets `data-active="true"` / class `mc-mark-active`.
 */
import * as React from 'react';
import { AlertTriangle, Brain, Check, ChevronDown, ChevronUp, Copy, EyeOff, Info, Lock, AlignLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import { ReadableValue, isProse, parseMaybeJson, summarizeValue } from './readable-value';
import {
  findMatches, formatTokens, prettyArguments, safeJson,
  type ModelCall, type ModelCallTokens, type ProposedToolCall, type ReasoningPart, type ReasoningState, type ToolCallStatus,
} from '../lib/model-calls';
import './model-call.css';

/* --------------------------------------------------------------- Highlight */

export interface HighlightProps {
  text: string;
  /** Case-insensitive query; empty renders plain text. */
  query?: string;
  /** Index (among this text's matches) of the match to emphasise. */
  activeIndex?: number;
}

/** Wraps case-insensitive matches of `query` in `<mark class="mc-mark">`. */
export function Highlight({ text, query, activeIndex }: HighlightProps) {
  const matches = query ? findMatches(text, query) : [];
  if (matches.length === 0) return <>{text}</>;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.start > cursor) nodes.push(text.slice(cursor, m.start));
    const active = i === activeIndex;
    nodes.push(
      <mark key={i} className={cn('mc-mark', active && 'mc-mark-active')} data-active={active ? 'true' : undefined}>
        {text.slice(m.start, m.end)}
      </mark>,
    );
    cursor = m.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}

/* ----------------------------------------------------------- ReasoningBlock */

export interface ReasoningBlockProps {
  /** Convenience: supplies parts, state and reasoning tokens. Explicit props below win. */
  call?: Pick<ModelCall, 'reasoning' | 'reasoningState' | 'tokens'>;
  parts?: ReasoningPart[];
  state?: ReasoningState;
  /** Reasoning token count (number) or the call's token object. */
  tokens?: number | Pick<ModelCallTokens, 'reasoning'>;
  /** Show the Show full / Collapse toggle (default true). When false the block is always fully shown. */
  collapsible?: boolean;
  /** Initial state for uncontrolled use (default false = collapsed 2-line preview). */
  defaultExpanded?: boolean;
  /** Controlled expanded state; pair with `onToggle`. */
  expanded?: boolean;
  onToggle?: (expanded: boolean) => void;
  /** Max height of the expanded body before it scrolls (px number or CSS length). */
  maxHeight?: number | string;
  /** Search query to highlight. */
  highlight?: string;
  /** Index (across all parts, document order) of the active highlight match. */
  activeMatch?: number;
  /** When given, text-less states show an "Open in Traces" button. */
  onOpenTraces?: () => void;
  /** Render nothing for the "hidden by provider" state; the caller shows one page-level note instead. */
  quietHidden?: boolean;
  className?: string;
}

function reasoningTokenCount(tokens: ReasoningBlockProps['tokens']): number | undefined {
  if (typeof tokens === 'number') return tokens;
  return tokens?.reasoning;
}

/** Writes text to the clipboard; resolves false when unavailable. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ReasoningBlock(props: ReasoningBlockProps) {
  const { call, collapsible = true, defaultExpanded = false, onToggle, maxHeight, highlight, activeMatch, onOpenTraces, quietHidden, className } = props;
  const parts = props.parts ?? call?.reasoning ?? [];
  const state: ReasoningState = props.state ?? call?.reasoningState ?? (parts.length ? 'returned' : 'unknown');
  const tokenCount = reasoningTokenCount(props.tokens) ?? call?.tokens.reasoning;
  const [internal, setInternal] = React.useState(defaultExpanded);
  const [copied, setCopied] = React.useState(false);
  const bodyId = React.useId();
  const expanded = !collapsible || (props.expanded ?? internal);

  if (state !== 'returned' && state !== 'summary') {
    if (quietHidden && state === 'hidden') return null;
    return <ReasoningNotice state={state} tokens={tokenCount} onOpenTraces={onOpenTraces} className={className} />;
  }

  const isSummary = state === 'summary';
  const toggle = () => {
    const next = !expanded;
    if (props.expanded === undefined) setInternal(next);
    onToggle?.(next);
  };
  const copy = async () => {
    if (await copyText(parts.map(p => p.text).join('\n\n'))) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };
  let offset = 0;
  const bodyStyle: React.CSSProperties | undefined = expanded && maxHeight !== undefined ? { maxHeight } : undefined;
  return (
    <section className={cn('mc-reasoning', className)} aria-label="Model reasoning" data-state={state}>
      <div className="mc-reasoning-head">
        <span className="mc-reasoning-label">
          <Brain size={14} aria-hidden="true" />
          Reasoning
          <span className="mc-reasoning-meta">
            · {isSummary ? 'provider summary' : 'provider-reported'}
            {tokenCount !== undefined ? ` · ${formatTokens(tokenCount)} tokens` : ''}
          </span>
        </span>
        <span className="mc-reasoning-actions">
          <button type="button" className="mc-icon-btn" onClick={copy} aria-label={copied ? 'Reasoning copied' : 'Copy reasoning'}>
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          </button>
          {collapsible && (
            <button type="button" className="mc-text-btn" onClick={toggle} aria-expanded={expanded} aria-controls={bodyId}>
              {expanded ? 'Collapse' : 'Show full'}
              {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            </button>
          )}
        </span>
      </div>
      <div
        id={bodyId}
        className={cn('mc-reasoning-body', !expanded && 'mc-clamp', expanded && maxHeight !== undefined && 'mc-scroll')}
        style={bodyStyle}
        tabIndex={expanded && maxHeight !== undefined ? 0 : undefined}
      >
        {parts.map((part, i) => {
          const start = offset;
          offset += highlight ? findMatches(part.text, highlight).length : 0;
          const local = activeMatch !== undefined && activeMatch >= start && activeMatch < offset ? activeMatch - start : undefined;
          return (
            <p key={part.source + i} className="mc-reasoning-text" title={parts.length > 1 ? part.source : undefined}>
              <Highlight text={part.text} query={highlight} activeIndex={local} />
            </p>
          );
        })}
      </div>
      {isSummary && <p className="mc-reasoning-note">Summary text from the provider, not the full reasoning.</p>}
    </section>
  );
}

function ReasoningNotice({ state, tokens, onOpenTraces, className }: {
  state: Exclude<ReasoningState, 'returned' | 'summary'>;
  tokens?: number;
  onOpenTraces?: () => void;
  className?: string;
}) {
  const content: Record<typeof state, { icon: React.ReactNode; title: string; body: string; kind: string }> = {
    scripted: {
      kind: 'scripted',
      icon: <Info size={14} aria-hidden="true" />,
      title: 'Scripted response.',
      body: 'Fixture output, not model behavior. There is no reasoning to show.',
    },
    hidden: {
      kind: 'hidden',
      icon: <Lock size={14} aria-hidden="true" />,
      title: 'Reasoning hidden by provider.',
      body: `${tokens !== undefined ? formatTokens(tokens) : 'Some'} reasoning tokens were used, but no readable text was returned.`,
    },
    not_returned: {
      kind: 'not-returned',
      icon: <EyeOff size={14} aria-hidden="true" />,
      title: 'Reasoning not returned.',
      body: 'Provider reported 0 reasoning tokens. Unavailable reasoning is not evidence of absent intent.',
    },
    unknown: {
      kind: 'unknown',
      icon: <Info size={14} aria-hidden="true" />,
      title: 'No reasoning recorded.',
      body: "Usage was unavailable, so we can't tell whether reasoning was used.",
    },
  };
  const c = content[state];
  return (
    <div className={cn('mc-notice', `mc-notice-${c.kind}`, className)} role="note" data-state={state}>
      {c.icon}
      <span>
        <strong>{c.title}</strong> {c.body}
        {onOpenTraces && state !== 'scripted' && (
          <>
            {' '}
            <button type="button" className="mc-link-btn" onClick={onOpenTraces}>Open in Traces</button>
          </>
        )}
      </span>
    </div>
  );
}

/* --------------------------------------------------------------- OutputText */

export interface OutputTextProps {
  text: string;
  highlight?: string;
  /** Index of the active highlight match within this text. */
  activeMatch?: number;
  /** Selects the empty-state wording: true when the call proposed tool calls. */
  hasToolCalls?: boolean;
  className?: string;
}

export function OutputText({ text, highlight, activeMatch, hasToolCalls, className }: OutputTextProps) {
  const empty = text.trim().length === 0;
  return (
    <section className={cn('mc-output', className)} aria-label="Model output text">
      <div className="mc-output-label">
        <AlignLeft size={14} aria-hidden="true" />
        Output
      </div>
      {empty ? (
        <p className="mc-output-empty">{hasToolCalls ? 'No text output. This call only proposed tool calls.' : 'No text output.'}</p>
      ) : (
        <p className="mc-output-text">
          <Highlight text={text} query={highlight} activeIndex={activeMatch} />
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- ToolCallList */

export interface ToolCallListProps {
  calls: ProposedToolCall[];
  variant?: 'compact' | 'detailed';
  /** Called with the lifecycle event id when a call's status pill/chip is activated. */
  onSelectEvent?: (eventId: string) => void;
  highlight?: string;
  className?: string;
}

const STATUS_TONE: Record<ToolCallStatus, string> = {
  proposed: 'neutral',
  admitted: 'ok',
  executed: 'ok',
  unexecuted: 'warn',
  failed: 'bad',
  deduplicated: 'neutral',
};

/** The first prose-like (long or multi-line) string argument, if any: a board post, notes, a report. */
export function proseArgument(args: unknown): string | undefined {
  const parsed = parseMaybeJson(args);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  return Object.values(parsed as Record<string, unknown>).find(isProse);
}

function argsPreview(args: unknown, max = 48): string {
  if (args === undefined || args === null) return '';
  const json = safeJson(args);
  if (json === '{}' || json === '[]') return '';
  return json.length > max ? `${json.slice(0, max - 1)}…` : json;
}

function StatusPill({ call, onSelectEvent }: { call: ProposedToolCall; onSelectEvent?: (id: string) => void }) {
  const label = call.statusEvent && call.status !== 'proposed' ? `${call.status} · #${call.statusEvent.sequence}` : call.status;
  const title = call.reason ? `${call.status}: ${call.reason}` : label;
  const cls = cn('mc-pill', `mc-pill-${STATUS_TONE[call.status]}`);
  if (onSelectEvent && call.statusEvent) {
    const id = call.statusEvent.id;
    return (
      <button type="button" className={cn(cls, 'mc-pill-btn')} title={title} onClick={() => onSelectEvent(id)}
        aria-label={`${call.name} ${call.status}${call.reason ? `, ${call.reason}` : ''}. Open event ${call.statusEvent.sequence}`}>
        {label}
      </button>
    );
  }
  return <span className={cls} title={title}>{label}</span>;
}

export function ToolCallList({ calls, variant = 'compact', onSelectEvent, highlight, className }: ToolCallListProps) {
  if (calls.length === 0) return null;
  const compact = variant === 'compact';
  return (
    <ul className={cn('mc-tools', compact ? 'mc-tools-compact' : 'mc-tools-detailed', className)} aria-label="Proposed tool calls">
      {calls.map((call, i) => (
        <li key={call.id || i} className="mc-tool" data-status={call.status}>
          {compact ? (
            <>
              <span className="mc-tool-head">
                <code className="mc-chip" title={safeJson(call.arguments)}>
                  <Highlight text={proseArgument(call.arguments) ? call.name : `${call.name}(${argsPreview(call.arguments)})`} query={highlight} />
                </code>
                <StatusPill call={call} onSelectEvent={onSelectEvent} />
              </span>
              {call.reason && (call.status === 'unexecuted' || call.status === 'failed') && (
                <span className="mc-tool-reason">{call.reason}</span>
              )}
              {proseArgument(call.arguments) !== undefined && (
                <p className="mc-tool-prose" title={summarizeValue(call.arguments, 600)}>{proseArgument(call.arguments)}</p>
              )}
            </>
          ) : (
            <>
              <div className="mc-tool-row">
                <code className="mc-tool-name"><Highlight text={call.name} query={highlight} /></code>
                <StatusPill call={call} onSelectEvent={onSelectEvent} />
                {call.reason && <span className="mc-tool-reason">{call.reason}</span>}
              </div>
              {highlight && findMatches(prettyArguments(call.arguments), highlight).length > 0 ? (
                <pre className="mc-tool-args"><Highlight text={prettyArguments(call.arguments)} query={highlight} /></pre>
              ) : (
                <ReadableValue value={call.arguments ?? {}} className="mc-tool-readable" />
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------ ModelCallMeta */

export function modelCallMetaParts(call: Pick<ModelCall, 'tokens' | 'finishReason' | 'latencyMs'>): string[] {
  const out: string[] = [];
  const { tokens } = call;
  if (tokens.context !== undefined) out.push(`${formatTokens(tokens.context)} context tokens (est.)`);
  if (tokens.output !== undefined) out.push(`${formatTokens(tokens.output)} output`);
  if (tokens.reasoning !== undefined) out.push(`${formatTokens(tokens.reasoning)} reasoning tokens`);
  if (call.finishReason) out.push(`finish: ${call.finishReason}`);
  if (call.latencyMs !== undefined) out.push(`${(call.latencyMs / 1000).toFixed(1)} s`);
  return out;
}

/** One-line "5,947 context tokens (est.) · 96 output · 128 reasoning · finish: tool-calls · 1.8 s". */
export function ModelCallMeta({ call, className }: { call: Pick<ModelCall, 'tokens' | 'finishReason' | 'latencyMs'>; className?: string }) {
  const parts = modelCallMetaParts(call);
  if (parts.length === 0) return null;
  return <p className={cn('mc-meta', className)}>{parts.join(' · ')}</p>;
}

/** The first sentence of a raw diagnostic, capped, so a provider's error body never fills a row. */
export function oneSentence(reason: string, max = 140): string {
  const flat = reason.replace(/\s+/g, ' ').trim();
  const stop = flat.search(/[.!?](\s|$)/);
  const sentence = stop > 0 ? flat.slice(0, stop + 1) : flat;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

/** One line for a call that never got a response because the turn or run then failed; the raw text is one click away. */
export function ModelCallFailure({ call, className, onFullDiagnostic }: { call: Pick<ModelCall, 'failure'>; className?: string; onFullDiagnostic?: () => void }) {
  if (!call.failure) return null;
  const { reason, elapsedMs } = call.failure;
  return (
    <div className={cn('mc-failure', className)} role="alert">
      <AlertTriangle size={14} aria-hidden="true" />
      <span>
        <strong>Model call failed:</strong> {oneSentence(reason)}
        {elapsedMs !== undefined ? ` No response after ${(elapsedMs / 1000).toFixed(1)} s.` : ''}
        {onFullDiagnostic && (
          <>
            {' '}
            <button type="button" className="mc-link-btn" onClick={onFullDiagnostic}>Full diagnostic</button>
          </>
        )}
      </span>
    </div>
  );
}
