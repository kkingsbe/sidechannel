import { Link } from "react-router-dom";
import { Badge } from "../../components/ui";
import type { HarnessEvent } from "../../lib/types";

/** One board message's exact delivery records. Posting never implies receipt. */
export function BoardDelivery({
  id,
  deliveries,
}: {
  id: string;
  deliveries?: HarnessEvent[];
}) {
  const matches = deliveries?.filter((event) => {
    const after = (event.data as { after?: unknown })?.after;
    return Array.isArray(after) && after.some((message) => message.id === id);
  });
  return (
    <div style={{ marginTop: 12 }}>
      {matches?.length ? (
        <div className="actions">
          <span className="helper">Exact delivery records:</span>
          {matches.map((e) => (
            <Link
              key={e.id}
              to={`/runs/${e.runId}?view=timeline&evidence=${encodeURIComponent(e.id)}`}
            >
              <Badge>
                {e.agentId} · event #{e.sequence}
              </Badge>
            </Link>
          ))}
        </div>
      ) : (
        <span className="helper">
          No read/delivery event for this post is present in this response.
          Posting alone does not establish receipt.
        </span>
      )}
    </div>
  );
}
