import { Badge, ErrorState, Pager } from "../../components/ui";
import { reviewDecisionMeta } from "../../lib/status";
import { short, when } from "../../lib/utils";
import type { RunOutcomeReview } from "../../lib/types";

/** Preserved outcome review history for one source run. */
export function ReferenceHistory({
  reviews,
}: {
  reviews: {
    data: RunOutcomeReview[];
    page: number;
    hasMore: boolean;
    onChange: (next: number) => void;
    error: Error | undefined;
    refresh: () => Promise<void>;
  };
}) {
  return (
    <>
      <hr className="section-divider" />
      <h3>Preserved review history</h3>
      <p className="helper">
        All outcome and definition revisions remain available through these
        pages and the complete reference export. Your latest revision is
        resolved independently by reviewer identity, outcome, and definition.
      </p>
      {reviews.error ? (
        <ErrorState error={reviews.error} retry={reviews.refresh} />
      ) : (
        reviews.data.map((review) => (
          <div
            key={review.id}
            style={{
              padding: "13px 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div className="actions">
              <strong>{review.reviewer}</strong>
              <Badge tone={reviewDecisionMeta[review.decision].tone}>{reviewDecisionMeta[review.decision].label}</Badge>
              <span className="helper">
                {review.outcomeDefinition.name} · {review.definitionRevisionId}{" "}
                · r{review.revision} · {when(review.createdAt)}
              </span>
            </div>
            <p className="text-block">{review.rationale}</p>
            <p className="helper">
              Evidence:{" "}
              {review.eventIds.length
                ? review.eventIds.join(", ")
                : "No source event citations"}
              {review.supersedesId
                ? " · revises " + short(review.supersedesId)
                : ""}
            </p>
          </div>
        ))
      )}
      <Pager
        page={reviews.page}
        hasMore={reviews.hasMore}
        onChange={reviews.onChange}
      />
    </>
  );
}
