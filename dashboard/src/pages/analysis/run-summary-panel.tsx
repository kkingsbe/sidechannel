import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, CardHeading, Empty, ErrorState, Loading, Notice, Table } from "../../components/ui";
import type { AnalysisSummary, CodeSummary, ScoreMetrics, ThresholdPolicy } from "../../lib/analysis-types";
import { PolicyPicker } from "./policy-picker";
import { useAnalysisSummary } from "./use-analysis-summary";
import { DEFAULT_POLICY, num, pct, provenanceLine, SOURCE_LABELS } from "./summary-view";

const HEADERS = ["Behavior", "Threshold", "Windows", "Max", "Mean", "At or above", "Fraction", "First at", "3 strikes", "Undecided"];

function MetricCells({ metrics, k }: { metrics: ScoreMetrics; k: number }) {
  return (
    <>
      <td className="n">{metrics.windows}</td>
      <td className="n">{pct(metrics.max)}</td>
      <td className="n">{pct(metrics.mean)}</td>
      <td className="n">{metrics.countAbove}</td>
      <td className="n">{pct(metrics.fractionAbove)}</td>
      <td className="n">{metrics.firstOccurrenceOrdinal ?? "–"}</td>
      <td>{metrics.kStrikes ? <Badge tone="danger">{`${k}+ windows`}</Badge> : <span className="muted">no</span>}</td>
      <td className="n">{metrics.undecided || "–"}</td>
    </>
  );
}

function ProbabilityRows({ code, k }: { code: CodeSummary; k: number }) {
  const threshold = code.threshold!;
  return (
    <>
      <tr>
        <th scope="row">
          {code.code}
          {code.kind !== "behavioral" && <> <Badge>{code.kind}</Badge></>}
        </th>
        <td className="n">
          {pct(threshold.yes)} <Badge tone={threshold.source === "fallback" ? "warning" : "neutral"}>{SOURCE_LABELS[threshold.source]}</Badge>
        </td>
        <MetricCells metrics={code.metrics!} k={k} />
      </tr>
      {Object.entries(code.byActor ?? {}).map(([actor, metrics]) => (
        <tr key={actor} className="an-actor-row">
          <th scope="row">
            <span className="muted">{code.code} ·</span> {actor}
          </th>
          <td />
          <MetricCells metrics={metrics} k={k} />
        </tr>
      ))}
    </>
  );
}

function DistributionRows({ code }: { code: CodeSummary }) {
  const entries = code.choice
    ? Object.entries(code.choice.labelDistribution).map(([label, share]) => `${label} ${pct(share)}`)
    : Object.entries(code.score?.levelDistribution ?? {}).map(([level, share]) => `${level} ${pct(share)}`);
  const detail = code.choice ? `mean top probability ${pct(code.choice.meanTopProbability)}` : `mean expected score ${num(code.score?.meanScore)}`;
  return (
    <tr>
      <th scope="row">
        {code.code} <Badge>{code.questionType}</Badge>
      </th>
      <td colSpan={HEADERS.length - 1}>
        {entries.join(" · ") || "No answers"} <span className="muted">· {detail} · {(code.choice ?? code.score)!.windows} answers</span>
      </td>
    </tr>
  );
}

/** Presentational summary: coverage, provenance and per-code run metrics. */
export function RunSummaryView({ summary }: { summary: AnalysisSummary }) {
  const { coverage } = summary;
  const gaps = coverage.oversized + coverage.skipped + coverage.failed;
  return (
    <>
      <p className="helper" data-testid="summary-provenance">
        {provenanceLine(summary)}
      </p>
      <p className="helper">
        {coverage.scoredWindows} of {coverage.totalWindows} windows scored
        {coverage.excludedByAudit > 0 && <> · <strong>{coverage.excludedByAudit} excluded</strong> because an audit code scored at or above {pct(summary.auditThreshold)}</>}
        {gaps > 0 && <> · <strong>{gaps} coverage gaps</strong> ({coverage.oversized} oversized, {coverage.skipped} skipped, {coverage.failed} failed)</>}
        {coverage.unfinished > 0 && <> · {coverage.unfinished} unfinished</>}
      </p>
      {summary.usedFallback && <Notice kind="warning">Some codes use the fixed fallback threshold because the policy had no data for them.</Notice>}
      {summary.codes.length ? (
        <Table label="Run summary by behavior" headers={HEADERS.map((h) => (h === "3 strikes" ? `${summary.k} strikes` : h))}>
          {summary.codes.map((code) =>
            code.questionType === "noul" ? <ProbabilityRows key={code.codeId} code={code} k={summary.k} /> : <DistributionRows key={code.codeId} code={code} />,
          )}
        </Table>
      ) : (
        <Empty title="No scored behaviors yet" description="Run metrics appear once windows have results." />
      )}
    </>
  );
}

/** Spec 8.1 under a chosen threshold policy, on the analysis detail page. */
export function RunSummaryPanel({ id }: { id: string }) {
  const [policy, setPolicy] = useState<ThresholdPolicy>(DEFAULT_POLICY);
  const summary = useAnalysisSummary(id, policy);
  return (
    <Card className="an-card">
      <CardHeading
        ruled
        title="Run summary"
        description="Run-level metrics from window scores. Exploratory estimates for a person to weigh, not findings."
        actions={
          <Link className="link" to={"/analysis/compare?ids=" + encodeURIComponent(id)}>
            Compare conditions
          </Link>
        }
      />
      <div className="card-body an-body">
        <PolicyPicker policy={policy} onChange={setPolicy} />
        <hr className="section-divider" />
        {summary.loading ? <Loading /> : summary.error && !summary.data ? <ErrorState error={summary.error} retry={summary.refresh} /> : summary.data && <RunSummaryView summary={summary.data} />}
      </div>
    </Card>
  );
}
