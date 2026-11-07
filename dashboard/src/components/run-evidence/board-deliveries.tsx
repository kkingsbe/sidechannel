import { Link } from "react-router-dom";
import type { HarnessEvent } from "../../lib/types";
import { eventLink, plural, shortRoundTurn } from "./evidence-model";

/** Delivery events (board reads) that included the given post. */
export function deliveriesOf(postId: string, deliveries?: HarnessEvent[]) {
  return (deliveries ?? []).filter((event) => {
    const after = (event.data as { after?: unknown } | undefined)?.after;
    return (
      Array.isArray(after) &&
      after.some((message) => (message as { id?: string })?.id === postId)
    );
  });
}

/** Compact per-role "first read" summary for a post, excluding the author. */
export function BoardDeliveries({
  postId,
  authorId,
  roles,
  deliveries,
}: {
  postId: string;
  authorId: string;
  roles: string[];
  deliveries?: HarnessEvent[];
}) {
  if (!deliveries)
    return (
      <span className="helper">
        No read/delivery events were loaded. Posting alone does not establish
        receipt.
      </span>
    );
  const matches = deliveriesOf(postId, deliveries)
    .filter((event) => event.agentId !== authorId)
    .sort((a, b) => a.sequence - b.sequence);
  const readers = roles.filter((role) => role !== authorId);
  for (const event of matches)
    if (event.agentId && !readers.includes(event.agentId))
      readers.push(event.agentId);
  return (
    <div className="delivery-summary">
      <span className="helper">First read by role (author excluded):</span>
      <ul>
        {readers.map((role) => {
          const reads = matches.filter((event) => event.agentId === role);
          const first = reads[0];
          return (
            <li key={role}>
              <strong>{role}</strong>{" "}
              {first ? (
                <>
                  <Link to={eventLink(first)}>
                    first read {shortRoundTurn(first)} (event #{first.sequence})
                  </Link>
                  {reads.length > 1 && (
                    <details className="inline-details">
                      <summary>
                        {plural(reads.length - 1, "repeat read")}
                      </summary>
                      {reads.slice(1).map((event) => (
                        <Link key={event.id} to={eventLink(event)}>
                          {shortRoundTurn(event)} · event #{event.sequence}
                        </Link>
                      ))}
                    </details>
                  )}
                </>
              ) : (
                <span className="helper">not read</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
