/** The Timeline / Model & traces body: turn navigator, turn-aligned event window, load controls and live follow. */
import * as React from 'react';
import type { TurnSummary } from '@sidechannel/contracts/browser';
import { Badge, Button, Empty, ErrorState, Loading } from '../../components/ui';
import type { EventStart, RunEvents, StreamStatus } from '../../lib/use-run-events';
import { TimelinePanel } from './TimelinePanel';
import { TracesPanel } from './TracesPanel';
import { TurnNavigator } from './TurnNavigator';
import { useFollowScroll } from './use-follow-scroll';
import './run-events.css';

const STATUS_LABEL: Record<StreamStatus, string> = {
  idle: 'Browsing', connecting: 'Connecting…', live: '● Live', reconnecting: 'Reconnecting…', polling: '● Live (polling)', ended: 'Run ended',
};

export function StreamBadge({ status }: { status: StreamStatus }) {
  return <Badge status={status === 'live' || status === 'polling' ? 'running' : status === 'reconnecting' ? 'stopping' : ''}>{STATUS_LABEL[status]}</Badge>;
}

export interface RunEventsViewProps {
  tab: 'timeline' | 'traces';
  runEvents: RunEvents;
  follow: boolean;
  turns: TurnSummary[] | undefined;
  start: EventStart;
  provider: string;
  focusCall: string | null;
  onInspect: (eventId: string, sequence?: number) => void;
  onOpenTraces: (invocationId: string) => void;
  onJump: (at: number | 'end') => void;
}

export function RunEventsView({ tab, runEvents, follow, turns, start, provider, focusCall, onInspect, onOpenTraces, onJump }: RunEventsViewProps) {
  const endRef = React.useRef<HTMLDivElement>(null);
  const { unseen, arrived, jump } = useFollowScroll(endRef, runEvents.events, follow);
  // Keep the reader's place when earlier turns are inserted above (Safari has no overflow-anchor).
  const heightBefore = React.useRef<number | null>(null);
  const firstId = runEvents.events[0]?.id;
  React.useLayoutEffect(() => {
    if (heightBefore.current === null) return;
    window.scrollBy(0, document.documentElement.scrollHeight - heightBefore.current);
    heightBefore.current = null;
  }, [firstId]);
  const loadEarlier = async () => {
    heightBefore.current = document.documentElement.scrollHeight;
    if (!(await runEvents.loadEarlier())) heightBefore.current = null;
  };
  return (
    <div className="run-events">
      <div className="run-events-bar">
        <TurnNavigator turns={turns} start={start} onJump={onJump} />
      </div>
      {runEvents.error && <ErrorState error={runEvents.error} retry={runEvents.reload} />}
      {runEvents.loading ? (
        <Loading label="Loading events…" />
      ) : runEvents.events.length ? (
        <>
          {runEvents.hasEarlier && <Button variant="secondary" size="sm" className="run-events-more" onClick={() => void loadEarlier()}>Load earlier turns</Button>}
          {tab === 'timeline' ? (
            <TimelinePanel events={runEvents.events} provider={provider} live={follow} onInspect={onInspect} onOpenTraces={onOpenTraces} />
          ) : (
            <TracesPanel events={runEvents.events} provider={provider} onInspect={onInspect} focusInvocationId={focusCall} />
          )}
          {runEvents.hasLater && <Button variant="secondary" size="sm" className="run-events-more" onClick={() => void runEvents.loadLater()}>Load later turns</Button>}
        </>
      ) : (
        <Empty title="No matching events" description="New recorded evidence will appear here without changing your selected object." />
      )}
      <div ref={endRef} aria-hidden="true" />
      {unseen > 0 && <button type="button" className="run-events-pill" onClick={jump}>{unseen} new event{unseen === 1 ? '' : 's'} ↓</button>}
      <p className="sr-only" aria-live="polite">{follow && arrived ? `${arrived} new event${arrived === 1 ? '' : 's'}` : ''}</p>
    </div>
  );
}
