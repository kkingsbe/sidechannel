import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { HarnessEvent } from "../../lib/types";
import { eventLink, roleColor, rt } from "./evidence-model";
import "./run-evidence.css";

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

/** "First read by" chips for one post: each other role with the turn of its first read and "×n" for re-reads. */
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
    <>
      <span>First read by</span>
      {readers.map((role) => {
        const reads = matches.filter((event) => event.agentId === role);
        const first = reads[0];
        return (
          <span
            key={role}
            className="who-chip"
            style={{ "--c": roleColor(role) } as CSSProperties}
          >
            {first ? (
              <Link to={eventLink(first)} title={`First read at event #${first.sequence}`}>
                {role}
              </Link>
            ) : (
              role
            )}
            <span className="muted">
              {first
                ? `${rt(first)}${reads.length > 1 ? ` · ×${reads.length - 1}` : ""}`
                : "not read"}
            </span>
          </span>
        );
      })}
    </>
  );
}
