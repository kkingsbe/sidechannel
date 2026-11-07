import type { ReactNode } from "react";
import { Badge } from "./ui";

/** One review-history row: reviewer, decision badge, scope meta, rationale and note. */
export function ReviewHistoryRow({
  reviewer,
  decision,
  meta,
  rationale,
  note,
}: {
  reviewer: string;
  decision: Parameters<typeof Badge>[0]["status"];
  meta: ReactNode;
  rationale: string;
  note: ReactNode;
}) {
  return (
    <div style={{ padding: "13px 0", borderBottom: "1px solid var(--border)" }}>
      <div className="actions">
        <strong>{reviewer}</strong>
        <Badge status={decision} />
        <span className="helper">{meta}</span>
      </div>
      <p className="text-block">{rationale}</p>
      <p className="helper">{note}</p>
    </div>
  );
}
