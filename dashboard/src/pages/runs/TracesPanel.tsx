import * as React from 'react';
import type { HarnessEvent } from '@sidechannel/contracts/browser';
import { ChevronDown, ChevronRight, ChevronUp, Search, X } from 'lucide-react';
import { Badge } from '../../components/ui';
import { ModelCallMeta, OutputText, ReasoningBlock, ToolCallList } from '../../components/model-call';
import {
  buildModelCalls, findMatches, formatTokens, prettyArguments, safeJson,
  type ModelCall,
} from '../../lib/model-calls';
import './traces-panel.css';

export interface TracesPanelProps {
  /** One page of events sorted by sequence (all event types; the panel builds calls itself). */
  events: HarnessEvent[];
  /** run.config.model.provider */
  provider: string;
  /** Opens the event drawer. */
  onInspect: (eventId: string, sequence?: number) => void;
  /** Scroll into view and briefly emphasise this call on mount/change. */
  focusInvocationId?: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const hasReasoningText = (c: ModelCall) => c.reasoningState === 'returned' || c.reasoningState === 'summary';

/** Report-phase text is pretty-printed when it parses as a JSON object/array. */
function displayText(call: ModelCall): { text: string; parsed: boolean } {
  if (call.phase === 'report' && call.text.trim()) {
    try {
      const value: unknown = JSON.parse(call.text);
      if (typeof value === 'object' && value !== null) return { text: JSON.stringify(value, null, 2), parsed: true };
    } catch { /* fall through to raw text */ }
  }
  return { text: call.text, parsed: false };
}

/**
 * Match count per card, mirroring what the card renders (and in the same order:
 * reasoning parts, output text, then tool names and pretty-printed arguments).
 */
function cardMatchCount(call: ModelCall, query: string): number {
  if (!query.trim()) return 0;
  let n = 0;
  if (hasReasoningText(call)) for (const p of call.reasoning) n += findMatches(p.text, query).length;
  n += findMatches(displayText(call).text, query).length;
  for (const t of call.toolCalls) {
    n += findMatches(t.name, query).length;
    n += findMatches(prettyArguments(t.arguments), query).length;
  }
  return n;
}

interface Group { key: string; label: string; agentId?: string; calls: ModelCall[] }

function groupCalls(calls: ModelCall[]): Group[] {
  const groups: Group[] = [];
  for (const call of calls) {
    const report = call.phase === 'report';
    const key = report ? `report|${call.agentId ?? ''}` : `${call.round ?? ''}|${call.turn ?? ''}|${call.agentId ?? ''}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) { last.calls.push(call); continue; }
    const label = report ? 'Report phase' : `Round ${call.round ?? '?'} · Turn ${call.turn ?? '?'}`;
    groups.push({ key, label, agentId: call.agentId, calls: [call] });
  }
  return groups;
}

function clockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US');
}

/** Plain text of a chat message's content (string or parts array). */
function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === 'string' ? part : isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  if (content === undefined || content === null) return '';
  return safeJson(content);
}

function inputMessages(request: HarnessEvent | undefined): { role: string; text: string }[] {
  const data = request && isRecord(request.data) ? request.data : undefined;
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  return messages.map(m => {
    const rec = isRecord(m) ? m : {};
    // Assistant turns that only called tools carry them beside (or inside) content; name them so the row isn't blank.
    const calls = [
      ...(Array.isArray(rec.toolCalls) ? rec.toolCalls : []),
      ...(Array.isArray(rec.content) ? rec.content.filter(p => isRecord(p) && p.type === 'tool-call') : []),
    ]
      .map(c => (isRecord(c) ? (c.name ?? c.toolName) : undefined))
      .filter((n): n is string => typeof n === 'string');
    const body = messageText(rec.content);
    const text = body || (calls.length ? `Called ${calls.join(', ')}` : '(empty)');
    return { role: typeof rec.role === 'string' ? rec.role : 'message', text: text.length > 300 ? `${text.slice(0, 300)}…` : text };
  });
}

/* ------------------------------------------------------------------- card */

interface CardProps {
  call: ModelCall;
  step: number;
  query: string;
  matches: number;
  focused: boolean;
  onInspect: TracesPanelProps['onInspect'];
  registerRef: (id: string, el: HTMLElement | null) => void;
}

function CallCard({ call, step, query, matches, focused, onInspect, registerRef }: CardProps) {
  const [open, setOpen] = React.useState(false);
  const listId = React.useId();
  const out = displayText(call);
  const textState = hasReasoningText(call);
  const messages = open ? inputMessages(call.request) : [];
  const inputLabel = call.inputSummary
    ? `Input · ${call.inputSummary.messages} messages · ${call.inputSummary.tools} tools available`
    : 'Input · not recorded';
  const link = (label: string, e: HarnessEvent | undefined) => e && (
    <button type="button" className="tr-link" onClick={() => onInspect(e.id, e.sequence)}>{label} #{e.sequence}</button>
  );
  const output = (
    <>
      {out.parsed && <span className="tr-parsed-pill">parsed</span>}
      <OutputText text={out.text} highlight={query} hasToolCalls={call.toolCalls.length > 0} />
    </>
  );
  const tools = (
    <ToolCallList
      calls={call.toolCalls}
      variant="detailed"
      highlight={query}
      onSelectEvent={id => {
        const hit = call.toolCalls.find(t => t.statusEvent?.id === id);
        onInspect(id, hit?.statusEvent?.sequence);
      }}
    />
  );
  return (
    <article
      className="tr-card"
      ref={el => registerRef(call.invocationId, el)}
      data-invocation-id={call.invocationId}
      data-focused={focused ? 'true' : undefined}
      aria-label={`Model call ${call.ordinal}`}
    >
      <header className="tr-card-head">
        <div className="tr-card-title">
          <h4>Call {call.ordinal}</h4>
          {call.phase && <span className={`tr-phase ${call.phase === 'report' ? 'tr-phase-report' : 'tr-phase-action'}`}>{call.phase}</span>}
          <span className="tr-muted">step {step} · {clockTime(call.startedAt)}</span>
          {query.trim() && matches > 0 && <span className="tr-match-pill">{matches} {matches === 1 ? 'match' : 'matches'}</span>}
        </div>
        <ModelCallMeta call={call} />
      </header>
      {textState ? (
        <div className="tr-body">
          <div className="tr-col tr-col-reasoning">
            <ReasoningBlock call={call} collapsible={false} highlight={query} />
          </div>
          <div className="tr-col">{output}{tools}</div>
        </div>
      ) : (
        <>
          <div className="tr-strip"><ReasoningBlock call={call} collapsible={false} /></div>
          <div className="tr-body">
            <div className="tr-col">{output}</div>
            <div className="tr-col">{tools}</div>
          </div>
        </>
      )}
      <footer className="tr-card-foot">
        <button type="button" className="tr-disclosure" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(o => !o)}>
          {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          {inputLabel}
        </button>
        <div className="tr-links">
          {link('Request', call.request)}
          {link('Response', call.response)}
          {link('Usage', call.usage)}
        </div>
      </footer>
      {open && (
        <ul id={listId} className="tr-input-list" aria-label="Input messages">
          {messages.length === 0 && <li className="tr-muted">No input messages recorded.</li>}
          {messages.map((m, i) => (
            <li key={i}><span className="tr-role">{m.role}</span><span className="tr-msg">{m.text}</span></li>
          ))}
        </ul>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ panel */

export function TracesPanel({ events, provider, onInspect, focusInvocationId }: TracesPanelProps) {
  const [query, setQuery] = React.useState('');
  const [onlyReasoning, setOnlyReasoning] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [flash, setFlash] = React.useState<string | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const cardRefs = React.useRef(new Map<string, HTMLElement>());
  const findId = React.useId();

  const allCalls = React.useMemo(() => buildModelCalls(events, { provider }), [events, provider]);
  const calls = React.useMemo(() => (onlyReasoning ? allCalls.filter(hasReasoningText) : allCalls), [allCalls, onlyReasoning]);
  const groups = React.useMemo(() => groupCalls(calls), [calls]);
  const counts = React.useMemo(() => calls.map(c => cardMatchCount(c, query)), [calls, query]);
  const countById = new Map(calls.map((c, i) => [c.invocationId, counts[i]]));
  const total = counts.reduce((a, b) => a + b, 0);
  const current = total === 0 ? 0 : Math.min(active, total - 1);

  const returnedCount = allCalls.filter(hasReasoningText).length;
  const knownTokens = allCalls.filter(c => c.tokens.reasoning !== undefined);
  const reasoningTokens = knownTokens.reduce((a, c) => a + (c.tokens.reasoning ?? 0), 0);

  const registerRef = React.useCallback((id: string, el: HTMLElement | null) => {
    if (el) cardRefs.current.set(id, el); else cardRefs.current.delete(id);
  }, []);

  // Mark the active match in DOM order (reasoning, output, tool args per card, cards in display order).
  React.useLayoutEffect(() => {
    const marks = rootRef.current ? Array.from(rootRef.current.querySelectorAll<HTMLElement>('mark.mc-mark')) : [];
    marks.forEach((m, i) => {
      const on = query.trim() !== '' && i === current;
      m.classList.toggle('mc-mark-active', on);
      if (on) m.setAttribute('data-active', 'true'); else m.removeAttribute('data-active');
    });
    const target = marks[current];
    if (query.trim() && target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' });
  }, [query, current, calls]);

  React.useEffect(() => {
    if (!focusInvocationId) return undefined;
    const el = cardRefs.current.get(focusInvocationId);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
    setFlash(focusInvocationId);
    const t = window.setTimeout(() => setFlash(null), 2500);
    return () => window.clearTimeout(t);
  }, [focusInvocationId, allCalls.length]);

  const step = (delta: number) => { if (total > 0) setActive((current + delta + total) % total); };
  const searching = query.trim() !== '';

  return (
    <div className="tr-root" ref={rootRef}>
      <div className="tr-chips">
        <span className="tr-chip"><strong>{allCalls.length}</strong> {allCalls.length === 1 ? 'call' : 'calls'}</span>
        <span className="tr-chip tr-chip-reasoning">Reasoning returned on <strong>{returnedCount} of {allCalls.length}</strong></span>
        {knownTokens.length > 0 && <span className="tr-chip"><strong>{formatTokens(reasoningTokens)}</strong> reasoning tokens</span>}
      </div>

      <div className="tr-toolbar" role="search">
        <div className="tr-find">
          <label htmlFor={findId}>Find in reasoning, output and arguments</label>
          <div className="tr-find-box">
            <Search size={14} aria-hidden="true" />
            <input
              id={findId}
              type="text"
              value={query}
              autoComplete="off"
              onChange={e => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
              }}
            />
            <span className="tr-count" aria-live="polite">{searching ? (total === 0 ? 'No matches' : `${current + 1} of ${total}`) : ''}</span>
            <button type="button" className="tr-icon-btn" aria-label="Previous match" disabled={total === 0} onClick={() => step(-1)}><ChevronUp size={14} aria-hidden="true" /></button>
            <button type="button" className="tr-icon-btn" aria-label="Next match" disabled={total === 0} onClick={() => step(1)}><ChevronDown size={14} aria-hidden="true" /></button>
            <button type="button" className="tr-icon-btn" aria-label="Clear search" disabled={!query} onClick={() => { setQuery(''); setActive(0); }}><X size={14} aria-hidden="true" /></button>
          </div>
        </div>
        <label className="tr-check">
          <input type="checkbox" checked={onlyReasoning} onChange={e => setOnlyReasoning(e.target.checked)} />
          Only calls with reasoning
        </label>
      </div>

      {calls.length === 0 ? (
        <div className="tr-empty" role="status">
          {allCalls.length === 0 ? 'No model calls on this page' : 'No calls with reasoning on this page'}
        </div>
      ) : (
        groups.map(group => (
          <section key={`${group.key}-${group.calls[0].invocationId}`} aria-label={group.label} className="tr-root">
            <div className="tr-group">
              <h3>{group.label}</h3>
              {group.agentId && <Badge>{group.agentId}</Badge>}
              <span className="tr-rule" aria-hidden="true" />
              <span className="tr-group-count">{group.calls.length} {group.calls.length === 1 ? 'call' : 'calls'}</span>
            </div>
            {group.calls.map((call, i) => (
              <CallCard
                key={call.invocationId}
                call={call}
                step={i + 1}
                query={query}
                matches={countById.get(call.invocationId) ?? 0}
                focused={flash === call.invocationId}
                onInspect={onInspect}
                registerRef={registerRef}
              />
            ))}
          </section>
        ))
      )}
    </div>
  );
}
