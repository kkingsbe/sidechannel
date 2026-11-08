import { Link } from "react-router-dom";
import { Button, Card, CardHeading, Empty, Table } from "../../components/ui";
import type { MonitorEvaluation } from "@sidechannel/contracts/browser";
import type { MonitorComparison } from "../../lib/types";
import { viewNames, views } from "./views";

/** Detection and false-positive denominators; missing views are never shown as zero. */
export function DetectionMetrics({
  evaluation,
  comparison,
}: {
  evaluation: MonitorEvaluation;
  comparison: MonitorComparison | undefined;
}) {
  const hasAgreedReferences = !!comparison?.comparisons.some((c) =>
    c.metrics.some(
      (m) =>
        m.referencePositive + m.referenceNegative + m.referenceUncertain > 0,
    ),
  );
  return (
    <Card className="form-section">
      <CardHeading
        title="Detection & false-positive denominators"
        description="Runs are the experimental unit. Monitor abstentions remain in binary reference denominators."
      />
      {!hasAgreedReferences ? (
        <Empty
          title="No agreed human references yet"
          description="Adjudicate outcomes to populate detection and false-positive rates."
        >
          <Button asChild variant="secondary" size="sm">
            <Link to="/oversight?view=references">
              Open Human reference outcomes
            </Link>
          </Button>
        </Empty>
      ) : (
      <Table
        label="Detection and false positive counts"
        headers={[
          "Outcome / view",
          "Detected / reference-positive",
          "False positives / reference-negative",
          "Monitor uncertain",
          "Excluded reference",
          "Unavailable view",
        ]}
      >
        {evaluation.definition.outcomes
          .filter((o) => !o.archived)
          .flatMap((outcome) =>
            views.map((view) => {
              const counts = comparison?.comparisons
                .find((c) => c.outcome.id === outcome.id)
                ?.metrics.find((m) => m.view === view);
              if (!counts)
                return (
                  <tr key={outcome.id + view}>
                    <td>
                      {outcome.name}
                      <small>{viewNames[view]}</small>
                    </td>
                    <td colSpan={5}>Reference comparison unavailable</td>
                  </tr>
                );
              return (
                <tr key={outcome.id + view}>
                  <td>
                    {outcome.name}
                    <small>{viewNames[view]}</small>
                  </td>
                  <td>
                    {counts.detectionRate == null
                      ? "Unavailable"
                      : (counts.detectionRate * 100).toFixed(1) + "%"}
                    <small>
                      {counts.detected} / {counts.referencePositive}{" "}
                      {counts.referencePositive === 1 ? "run" : "runs"}
                    </small>
                  </td>
                  <td>
                    {counts.falsePositiveRate == null
                      ? "Unavailable"
                      : (counts.falsePositiveRate * 100).toFixed(1) + "%"}
                    <small>
                      {counts.falsePositive} / {counts.referenceNegative}{" "}
                      {counts.referenceNegative === 1 ? "run" : "runs"}
                    </small>
                  </td>
                  <td>{counts.monitorUncertain}</td>
                  <td>
                    {counts.excludedReference}
                    <small>
                      {counts.referenceUncertain} agreed-uncertain
                    </small>
                  </td>
                  <td>{counts.missingView}</td>
                </tr>
              );
            }),
          )}
      </Table>
      )}
      <div className="card-body" style={{ paddingTop: 14 }}>
        <p className="helper">
          Only agreed present/absent references from two reviewers on matching
          evidence and definitions enter binary denominators. Provisional,
          disputed, agreed-uncertain, stale, and incompatible references are
          excluded. Completed monitor uncertain judgments remain in their
          reference denominator. Unavailable views are counted separately; no
          missing denominator is displayed as zero percent. Matched-run
          relationships remain available on each source page.
        </p>
      </div>
    </Card>
  );
}
