/** Keeps the end of a growing list in view while the reader is at the end; otherwise counts what arrived below. */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { HarnessEvent } from '@sidechannel/contracts/browser';

const PIN_SLACK_PX = 80;
const isPinned = (end: HTMLElement | null) => !end || end.getBoundingClientRect().bottom <= window.innerHeight + PIN_SLACK_PX;

export function useFollowScroll(endRef: RefObject<HTMLElement | null>, events: readonly HarnessEvent[], follow: boolean) {
  const [unseen, setUnseen] = useState(0);
  const [arrived, setArrived] = useState(0);
  const pinned = useRef(true);
  const newest = useRef<number | undefined>(undefined);
  useEffect(() => {
    const onScroll = () => { pinned.current = isPinned(endRef.current); if (pinned.current) setUnseen(0); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [endRef]);
  const last = events.at(-1)?.sequence;
  useLayoutEffect(() => {
    const before = newest.current;
    newest.current = last;
    if (!follow || last === undefined) return;
    // First load of a followed window: start at the end. jsdom has no scrollIntoView, hence the optional call.
    if (before === undefined) { endRef.current?.scrollIntoView?.({ block: 'end' }); return; }
    if (last <= before) return;
    const count = events.filter(event => event.sequence > before).length;
    setArrived(count);
    if (pinned.current) endRef.current?.scrollIntoView?.({ block: 'end' });
    else setUnseen(n => n + count);
  }, [last, follow, endRef, events]);
  const jump = () => { endRef.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' }); pinned.current = true; setUnseen(0); };
  return { unseen, arrived, jump };
}
