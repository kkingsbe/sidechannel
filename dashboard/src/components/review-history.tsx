import type { ReactNode } from "react";
import type { Verdict } from "@sidechannel/contracts/browser";
import { Badge } from "./ui";
import { reviewDecisionMeta } from "../lib/status";

/** One review-history row: reviewer, decision badge, scope meta, rationale and note. */
export function ReviewHistoryRow({
  reviewer,
  decision,
  meta,
  rationale,
  note,
}: {
  reviewer: string;
  decision: Verdict;
  meta: ReactNode;
  rationale: string;
  note: ReactNode;
}) {
  return (
    <div style={{ padding: "13px 0", borderBottom: "1px solid var(--border)" }}>
      <div className="actions">
        <strong>{reviewer}</strong>
        <Badge tone={reviewDecisionMeta[decision].tone}>{reviewDecisionMeta[decision].label}</Badge>
        <span className="helper">{meta}</span>
      </div>
      <p className="text-block">{rationale}</p>
      <p className="helper">{note}</p>
    </div>
  );
}
