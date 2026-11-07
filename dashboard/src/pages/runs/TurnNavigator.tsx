import type { TurnSummary } from '@sidechannel/contracts/browser';
import { Select } from '../../components/ui';
import type { EventStart } from '../../lib/use-run-events';

export function turnLabel(turn: TurnSummary): string {
  return `Round ${turn.round ?? '—'} · Turn ${turn.turn} · ${turn.agentId} · ${turn.eventCount} event${turn.eventCount === 1 ? '' : 's'}${turn.failures ? ` · ${turn.failures} failed` : ''}`;
}

export function TurnNavigator({ turns, start, onJump }: { turns: TurnSummary[] | undefined; start: EventStart; onJump: (at: number | 'end') => void }) {
  if (!turns?.length) return null;
  const containing = typeof start === 'number' ? turns.find(turn => start >= turn.firstSequence && start <= turn.lastSequence) : undefined;
  const value = start === 'latest' ? 'end' : containing ? String(containing.firstSequence) : '';
  const total = turns.reduce((sum, turn) => sum + turn.eventCount, 0);
  return (
    <div className="turn-nav">
      <Select aria-label="Jump to turn" value={value} onChange={event => onJump(event.target.value === 'end' ? 'end' : Number(event.target.value))}>
        {value === '' && <option value="">Jump to a turn…</option>}
        <option value="end">Newest events</option>
        {turns.map(turn => <option key={turn.firstSequence} value={turn.firstSequence}>{turnLabel(turn)}</option>)}
      </Select>
      <span className="helper">{turns.length} turns · {total} events in turns</span>
    </div>
  );
}
