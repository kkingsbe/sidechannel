import * as React from 'react';
import type { HarnessEvent } from '@sidechannel/contracts/browser';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { JsonView } from '../../components/ui';
import { ModelCallFailure, OutputText, ReasoningBlock, ToolCallList } from '../../components/model-call';
import { buildModelCalls, formatTokens, type ModelCall } from '../../lib/model-calls';
import './traces-panel.css';

export interface ModelCallDetailProps {
  /** The selected event (any model event of the call). */
  event: HarnessEvent;
  /** Current page, used to assemble the call and to find prev/next calls. */
  events: HarnessEvent[];
  provider: string;
  /** Prev/next call and linked events. */
  onNavigate: (eventId: string, sequence?: number) => void;
  onOpenTraces?: (invocationId: string) => void;
}

type View = 'readable' | 'raw';

/** Event the drawer should open for a call: its response, else its first event. */
function entryEvent(call: ModelCall): { id: string; sequence: number } | undefined {
  const e = call.response ?? call.request ?? call.context ?? call.usage;
  return e ? { id: e.id, sequence: e.sequence } : undefined;
}

export function ModelCallDetail({ event, events, provider, onNavigate, onOpenTraces }: ModelCallDetailProps) {
  const [view, setView] = React.useState<View>('readable');
  const calls = React.useMemo(() => buildModelCalls(events, { provider }), [events, provider]);
  const index = event.invocationId ? calls.findIndex(c => c.invocationId === event.invocationId) : -1;
  const call = index >= 0 ? calls[index] : undefined;
  const tabsId = React.useId();

  if (!call) return <JsonView value={event} open />;

  const prev = index > 0 ? entryEvent(calls[index - 1]) : undefined;
  const next = index < calls.length - 1 ? entryEvent(calls[index + 1]) : undefined;
  const sources = Array.from(new Set(call.reasoning.map(p => p.source)));
  const showsReasoningText = call.reasoningState === 'returned' || call.reasoningState === 'summary';
  const dash = (n: number | undefined) => (n === undefined ? '—' : formatTokens(n));
  const linked: { key: string; label: string; target: { id: string; sequence: number } }[] = [];
  if (call.request) linked.push({ key: 'req', label: 'Request', target: { id: call.request.id, sequence: call.request.sequence } });
  if (call.usage) linked.push({ key: 'usage', label: 'Usage', target: { id: call.usage.id, sequence: call.usage.sequence } });
  for (const t of call.toolCalls) {
    if (t.statusEvent) linked.push({ key: `tool-${t.id}`, label: `${t.name} ${t.status}`, target: t.statusEvent });
  }

  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const nextView: View = view === 'readable' ? 'raw' : 'readable';
      setView(nextView);
      document.getElementById(`${tabsId}-${nextView}`)?.focus();
    }
  };

  return (
    <div className="tr-detail">
      <div className="tr-detail-head">
        <strong>Call #{call.sequenceRange[0]} · {index + 1} of {calls.length} in the loaded turns</strong>
        <div className="tr-nav">
          <button type="button" className="tr-icon-btn" aria-label="Previous model call" disabled={!prev}
            onClick={() => prev && onNavigate(prev.id, prev.sequence)}><ChevronLeft size={16} aria-hidden="true" /></button>
          <button type="button" className="tr-icon-btn" aria-label="Next model call" disabled={!next}
            onClick={() => next && onNavigate(next.id, next.sequence)}><ChevronRight size={16} aria-hidden="true" /></button>
        </div>
      </div>

      <div className="tr-tabs" role="tablist" aria-label="Event view" onKeyDown={onTabKey}>
        {(['readable', 'raw'] as const).map(v => (
          <button
            key={v}
            type="button"
            role="tab"
            id={`${tabsId}-${v}`}
            className="tr-tab"
            aria-selected={view === v}
            aria-controls={`${tabsId}-panel`}
            tabIndex={view === v ? 0 : -1}
            onClick={() => setView(v)}
          >
            {v === 'readable' ? 'Readable' : 'Raw JSON'}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${view}`} className="tr-detail">
        {view === 'raw' ? (
          <JsonView value={event} open />
        ) : (
          <>
            <ModelCallFailure call={call} />
            {!call.failure && <ReasoningBlock call={call} collapsible={false} />}
            {showsReasoningText && sources.length > 0 && (
              <p className="tr-source">source <code>{sources.join(', ')}</code></p>
            )}
            {!call.failure && <OutputText text={call.text} hasToolCalls={call.toolCalls.length > 0} />}
            <ToolCallList
              calls={call.toolCalls}
              variant="detailed"
              onSelectEvent={id => {
                const hit = call.toolCalls.find(t => t.statusEvent?.id === id);
                onNavigate(id, hit?.statusEvent?.sequence);
              }}
            />

            <section aria-label="Usage">
              <h3 className="tr-section-label">USAGE</h3>
              <dl className="tr-usage">
                <div className="tr-tile"><dt>Context (est.)</dt><dd>{dash(call.tokens.context)}</dd></div>
                <div className="tr-tile"><dt>Output</dt><dd>{dash(call.tokens.output)}</dd></div>
                <div className="tr-tile tr-tile-reasoning"><dt>Reasoning</dt><dd>{dash(call.tokens.reasoning)}</dd></div>
                <div className="tr-tile"><dt>Finish</dt><dd>{call.finishReason ?? '—'}</dd></div>
              </dl>
            </section>

            {linked.length > 0 && (
              <div className="tr-linked" aria-label="Linked events">
                {linked.map(l => (
                  <button key={l.key} type="button" className="tr-link" onClick={() => onNavigate(l.target.id, l.target.sequence)}>
                    {l.label} #{l.target.sequence}
                  </button>
                ))}
              </div>
            )}

            <p className="tr-note" role="note">
              Tool requests are proposals until an admission and result are recorded. Reasoning is what the provider returned. It may be a summary and is not a complete account of the model&rsquo;s process.
            </p>
          </>
        )}
      </div>

      {onOpenTraces && (
        <button type="button" className="tr-btn" onClick={() => onOpenTraces(call.invocationId)}>Open in Model calls</button>
      )}
    </div>
  );
}
