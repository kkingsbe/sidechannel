/**
 * Readable run timeline: folds model events into model-call rows, groups events by turn and
 * shows reasoning inline. Raw mode reproduces the original one-button-per-event list.
 */
import * as React from 'react';
import { ArrowUpRight, CheckCircle2, MessageSquare, Play, Wrench, XCircle } from 'lucide-react';
import type { HarnessEvent } from '@sidechannel/contracts/browser';
import { Badge } from '../../components/ui';
import { ModelCallMeta, OutputText, ReasoningBlock, ToolCallList } from '../../components/model-call';
import { MODEL_CALL_EVENT_TYPES, buildModelCalls, summarizeEvent, type ModelCall } from '../../lib/model-calls';
import { cn, pretty } from '../../lib/utils';
import './timeline-panel.css';

export interface TimelinePanelProps {
  /** One page of events, sorted by sequence. */
  events: HarnessEvent[];
  /** run.config.model.provider */
  provider: string;
  /** The run is being followed live: the newest unanswered model call shows a waiting state. */
  live?: boolean;
  /** Opens the event drawer. */
  onInspect: (eventId: string, sequence?: number) => void;
  /** Switches to Model & traces focused on that invocation. */
  onOpenTraces: (invocationId: string) => void;
}

/* ------------------------------------------------------------ persistence */

const KEY_MODE = 'sidechannel.timeline.mode';
const KEY_FOLD = 'sidechannel.timeline.fold';
const KEY_EXPAND = 'sidechannel.timeline.expandAll';

function readStored(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeStored(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}
function usePersisted<T extends string | boolean>(key: string, initial: T, parse: (raw: string) => T | undefined): [T, (v: T) => void] {
  const [value, setValue] = React.useState<T>(() => {
    const raw = readStored(key);
    return (raw === null ? undefined : parse(raw)) ?? initial;
  });
  const set = React.useCallback((v: T) => { setValue(v); writeStored(key, String(v)); }, [key]);
  return [value, set];
}
const parseBool = (raw: string) => (raw === 'true' ? true : raw === 'false' ? false : undefined);
const parseMode = (raw: string) => (raw === 'readable' || raw === 'raw' ? raw : undefined);

/* ----------------------------------------------------------------- helpers */

type Row =
  | { kind: 'event'; event: HarnessEvent }
  | { kind: 'call'; call: ModelCall; anchor: HarnessEvent; target: HarnessEvent; range: [number, number] };

interface Segment { key: string | null; round?: number; turn?: number; agentId?: string; rows: Row[] }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const FAILURE = /denied|error|fail/;
const rowEvent = (r: Row) => (r.kind === 'event' ? r.event : r.anchor);

function turnKey(e: HarnessEvent): string | null {
  // Run-level events (no agent, or turn 0 before the first turn) stay ungrouped.
  return !e.turn || !e.agentId ? null : `${e.agentId}|${e.round ?? ''}|${e.turn}`;
}

function quoteOf(e: HarnessEvent): string | undefined {
  if (e.type === 'model_response' || !isRecord(e.data)) return undefined;
  const t = e.data.text;
  return typeof t === 'string' && t.trim() ? t : undefined;
}

function buildRows(events: HarnessEvent[], calls: ModelCall[], fold: boolean): Row[] {
  const byInvocation = new Map(calls.map(c => [c.invocationId, c]));
  const anchors = new Map<string, { anchor: HarnessEvent; range: [number, number] }>();
  for (const call of calls) {
    const modelEvents = [call.context, call.request, call.response, call.usage].filter((e): e is HarnessEvent => !!e);
    const seqs = modelEvents.map(e => e.sequence);
    const earliest = [...modelEvents].sort((a, b) => a.sequence - b.sequence)[0];
    anchors.set(call.invocationId, { anchor: call.response ?? earliest, range: [Math.min(...seqs), Math.max(...seqs)] });
  }
  const rows: Row[] = [];
  for (const e of events) {
    const call = e.invocationId ? byInvocation.get(e.invocationId) : undefined;
    if (fold && call) {
      if (MODEL_CALL_EVENT_TYPES.has(e.type)) {
        const a = anchors.get(call.invocationId)!;
        if (a.anchor.id === e.id) rows.push({ kind: 'call', call, anchor: a.anchor, target: a.anchor, range: a.range });
        continue;
      }
      if (e.type === 'tool_requested' || e.type === 'tool_admitted') continue;
    }
    rows.push({ kind: 'event', event: e });
  }
  return rows;
}

function segmentRows(rows: Row[]): Segment[] {
  const out: Segment[] = [];
  for (const row of rows) {
    const e = rowEvent(row);
    const key = turnKey(e);
    const last = out[out.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else out.push({ key, round: e.round, turn: e.turn, agentId: e.agentId, rows: [row] });
  }
  return out;
}

function turnSummary(seg: Segment, callsById: Map<string, ModelCall>): string {
  const parts: string[] = [];
  let allowance: number | undefined;
  let remaining: number | undefined;
  const invocations = new Set<string>();
  for (const row of seg.rows) {
    if (row.kind === 'call') invocations.add(row.call.invocationId);
    else {
      const e = row.event;
      if (e.invocationId && MODEL_CALL_EVENT_TYPES.has(e.type)) invocations.add(e.invocationId);
      if (!isRecord(e.data)) continue;
      if (e.type === 'turn_started' && typeof e.data.allowance === 'number') allowance = e.data.allowance;
      if (e.type === 'turn_ended' && typeof e.data.remainingAllowance === 'number') remaining = e.data.remainingAllowance;
    }
  }
  if (allowance !== undefined && remaining !== undefined) parts.push(`${Math.max(0, allowance - remaining)} of ${allowance} actions used`);
  const calls = [...invocations].map(id => callsById.get(id)).filter((c): c is ModelCall => !!c);
  if (invocations.size > 0) {
    parts.push(`${invocations.size} model call${invocations.size === 1 ? '' : 's'}`);
    const withReasoning = calls.filter(c => c.reasoningState === 'returned' || c.reasoningState === 'summary').length;
    if (withReasoning > 0) parts.push(`reasoning on ${withReasoning}`);
  }
  return parts.join(' · ');
}

function markerFor(e: HarnessEvent): { Icon: typeof Play; tone: string } {
  if (FAILURE.test(e.type)) return { Icon: XCircle, tone: 'danger' };
  if (/board/.test(e.type)) return { Icon: MessageSquare, tone: 'neutral' };
  if (/tool/.test(e.type)) return { Icon: Wrench, tone: 'neutral' };
  if (/complete|success/.test(e.type)) return { Icon: CheckCircle2, tone: 'success' };
  return { Icon: Play, tone: 'neutral' };
}

const time = (e: HarnessEvent) => new Date(e.timestamp).toLocaleTimeString();
const typeLabel = (type: string) => type.replaceAll('_', ' ');

/* ---------------------------------------------------------------- component */

export function TimelinePanel({ events, provider, live = false, onInspect, onOpenTraces }: TimelinePanelProps) {
  const [mode, setMode] = usePersisted<'readable' | 'raw'>(KEY_MODE, 'readable', parseMode);
  const [fold, setFold] = usePersisted<boolean>(KEY_FOLD, true, parseBool);
  const [expandAll, setExpandAll] = usePersisted<boolean>(KEY_EXPAND, false, parseBool);
  // Explicit per-row choices win over expand-all; toggling expand-all resets them.
  const [rowOpen, setRowOpen] = React.useState<Record<string, boolean>>({});
  const [collapsedTurns, setCollapsedTurns] = React.useState<Record<string, boolean>>({});

  const sorted = React.useMemo(() => [...events].sort((a, b) => a.sequence - b.sequence), [events]);
  const calls = React.useMemo(() => buildModelCalls(sorted, { provider }), [sorted, provider]);
  const callsById = React.useMemo(() => new Map(calls.map(c => [c.invocationId, c])), [calls]);
  const toolNames = React.useMemo(
    () => new Map(calls.flatMap(c => c.toolCalls.map(t => [t.id, t.name] as const))),
    [calls],
  );
  const callByResponse = React.useMemo(() => {
    const m = new Map<string, ModelCall>();
    for (const c of calls) if (c.response) m.set(c.response.id, c);
    return m;
  }, [calls]);
  const eventById = React.useMemo(() => new Map(sorted.map(e => [e.id, e])), [sorted]);
  const segments = React.useMemo(() => segmentRows(buildRows(sorted, calls, fold)), [sorted, calls, fold]);

  const lastSequence = sorted.at(-1)?.sequence;
  const isPending = (call: ModelCall) => live && !call.response && call.sequenceRange[1] === lastSequence;

  const inspectById = (id: string) => onInspect(id, eventById.get(id)?.sequence);

  const renderBody = (call: ModelCall) => (
    <>
      <ReasoningBlock
        call={call}
        collapsible
        expanded={rowOpen[call.invocationId] ?? expandAll}
        onToggle={next => setRowOpen(prev => ({ ...prev, [call.invocationId]: next }))}
        maxHeight={240}
        onOpenTraces={() => onOpenTraces(call.invocationId)}
      />
      <OutputText text={call.text} hasToolCalls={call.toolCalls.length > 0} />
      <ToolCallList calls={call.toolCalls} variant="compact" onSelectEvent={inspectById} />
    </>
  );

  const renderEventRow = (e: HarnessEvent) => {
    const { Icon, tone } = markerFor(e);
    const quote = quoteOf(e);
    const bodyCall = e.type === 'model_response' ? callByResponse.get(e.id) : undefined;
    return (
      <li key={e.id} className="tl-row" data-type={e.type}>
        <span className={cn('tl-marker', `tl-marker-${tone}`)} aria-hidden="true"><Icon size={13} /></span>
        <div className={cn('tl-main', bodyCall && 'tl-main-call')}>
          <div className="tl-head">
            <strong>{typeLabel(e.type)}</strong>
            <Badge>{e.agentId || 'system'}</Badge>
            <span className="tl-seq">#{e.sequence} · R{e.round ?? '—'} / T{e.turn ?? '—'}</span>
            {FAILURE.test(e.type) && <Badge status="failed">Diagnostic</Badge>}
          </div>
          {quote ? <blockquote className="tl-quote">{quote}</blockquote> : <p className="tl-summary">{summarizeEvent(e, toolNames)}</p>}
          {bodyCall && renderBody(bodyCall)}
        </div>
        <time className="tl-time">{time(e)}</time>
        <OpenButton label={`Open event #${e.sequence}`} onClick={() => onInspect(e.id, e.sequence)} />
      </li>
    );
  };

  const renderCallRow = (row: Extract<Row, { kind: 'call' }>) => {
    const { call, anchor, target, range } = row;
    return (
      <li key={`call-${call.invocationId}`} className="tl-row" data-type="model_call">
        <span className="tl-marker tl-marker-call" aria-hidden="true"><MessageSquare size={14} /></span>
        <div className="tl-main tl-main-call">
          <div className="tl-head">
            <strong>model call</strong>
            <Badge>{call.agentId || anchor.agentId || 'system'}</Badge>
            <span className="tl-seq">
              #{range[0] === range[1] ? range[0] : `${range[0]}–${range[1]}`} · R{call.round ?? '—'} / T{call.turn ?? '—'}
              {call.phase ? ` · ${call.phase}` : ''}
            </span>
          </div>
          <ModelCallMeta call={call} />
          {isPending(call) && <PendingResponse since={call.request?.timestamp ?? call.startedAt} />}
          {renderBody(call)}
        </div>
        <time className="tl-time">{time(anchor)}</time>
        <OpenButton label={`Open model call #${target.sequence}`} onClick={() => onInspect(target.id, target.sequence)} />
      </li>
    );
  };

  const toolbar = (
    <div className="tl-toolbar">
      <div className="tl-segmented" role="group" aria-label="Row detail">
        <button type="button" aria-pressed={mode === 'readable'} onClick={() => setMode('readable')}>Readable</button>
        <button type="button" aria-pressed={mode === 'raw'} onClick={() => setMode('raw')}>Raw events</button>
      </div>
      <label className="tl-check">
        <input type="checkbox" checked={fold} onChange={e => setFold(e.target.checked)} />
        Fold request &amp; usage into model calls
      </label>
      <button
        type="button"
        className="tl-switch"
        aria-pressed={expandAll}
        onClick={() => { setRowOpen({}); setExpandAll(!expandAll); }}
      >
        <span className="tl-switch-track" aria-hidden="true"><span className="tl-switch-thumb" /></span>
        Expand all reasoning
      </button>
    </div>
  );

  if (mode === 'raw') {
    return (
      <div className="tl-panel">
        {toolbar}
        <ol className="tl-raw-list timeline-list">
          {sorted.map(e => {
            const { Icon } = markerFor(e);
            return (
              <li key={e.id}>
                <button type="button" className="timeline-row" onClick={() => onInspect(e.id, e.sequence)}>
                  <span className="timeline-marker"><Icon size={13} aria-hidden="true" /></span>
                  <div className="timeline-main">
                    <div>
                      <strong>{typeLabel(e.type)}</strong>
                      <Badge>{e.agentId || 'system'}</Badge>
                      <span className="helper">#{e.sequence} · R{e.round ?? '—'} / T{e.turn ?? '—'}</span>
                      {FAILURE.test(e.type) && <Badge status="failed">Diagnostic</Badge>}
                    </div>
                    <p>{pretty(e.data).slice(0, 190)}</p>
                  </div>
                  <time className="timeline-time">{time(e)}</time>
                  <ArrowUpRight size={13} className="muted" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  return (
    <div className="tl-panel">
      {toolbar}
      <ol className="tl-list">
        {segments.map(seg => {
          const first = rowEvent(seg.rows[0]);
          const groupId = `${seg.key ?? 'none'}@${first.id}`;
          const collapsed = seg.key !== null && !!collapsedTurns[groupId];
          return (
            <React.Fragment key={groupId}>
              {seg.key !== null && (
                <li className="tl-turn" data-testid="turn-header">
                  <h3>Round {seg.round ?? '—'} · Turn {seg.turn}</h3>
                  <Badge>{seg.agentId || 'system'}</Badge>
                  <span className="tl-turn-summary">{turnSummary(seg, callsById)}</span>
                  <button
                    type="button"
                    className="tl-turn-toggle"
                    aria-expanded={!collapsed}
                    onClick={() => setCollapsedTurns(prev => ({ ...prev, [groupId]: !collapsed }))}
                  >
                    {collapsed ? 'Expand turn' : 'Collapse turn'}
                  </button>
                </li>
              )}
              {!collapsed && seg.rows.map(row => (row.kind === 'call' ? renderCallRow(row) : renderEventRow(row.event)))}
            </React.Fragment>
          );
        })}
      </ol>
    </div>
  );
}

function OpenButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="tl-open" aria-label={label} title={label} onClick={onClick}>
      <ArrowUpRight size={14} aria-hidden="true" />
    </button>
  );
}

function PendingResponse({ since }: { since: string }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  // The ticking counter is hidden from assistive tech so it is not announced every second.
  return (
    <p className="tl-pending">
      <span className="tl-pending-dot" aria-hidden="true" />
      Waiting for model response <span aria-hidden="true">· {seconds}s</span>
    </p>
  );
}
