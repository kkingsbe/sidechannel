import type { MonitorEvaluation } from "@sidechannel/contracts/browser";
import { Badge, Card, CardHeading, Notice, Table } from "../../components/ui";
import type { Comparison, ComparisonCode, ConditionDifference } from "../../lib/analysis-types";
import { oversightVerdicts, runsWithVerdicts } from "./oversight-join";
import { pct, SOURCE_LABELS } from "./summary-view";

const W = 520;
const ROW = 26;
const LEFT = 92;
const RIGHT = 16;

const formatValue = (metric: Comparison["metric"], value: number | null | undefined) =>
  value == null ? "–" : metric === "countAbove" ? String(Math.round(value * 100) / 100) : pct(value);

const signed = (metric: Comparison["metric"], value: number) => (value > 0 ? "+" : value < 0 ? "−" : "") + formatValue(metric, Math.abs(value));

/** One dot per run, grouped by condition, with the group mean as a bar. Values are never connected or interpolated. */
export function ConditionStrip({ code, metric }: { code: ComparisonCode; metric: Comparison["metric"] }) {
  const values = code.groups.flatMap((g) => g.runs.map((r) => r.value ?? 0));
  const top = metric === "countAbove" ? Math.max(1, ...values) : 1;
  const x = (v: number) => LEFT + (v / top) * (W - LEFT - RIGHT);
  const height = code.groups.length * ROW + 22;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={`${code.code} ${metric} per run, grouped by condition`}>
      {code.groups.map((g, row) => {
        const y = 14 + row * ROW;
        return (
          <g key={g.condition}>
            <text x={LEFT - 8} y={y + 4} textAnchor="end" className="chart-label">
              {g.condition}
            </text>
            <line x1={LEFT} x2={W - RIGHT} y1={y} y2={y} className="chart-grid" />
            {g.mean != null && <line x1={x(g.mean)} x2={x(g.mean)} y1={y - 9} y2={y + 9} stroke="var(--foreground)" strokeWidth="2" />}
            {g.runs.map((r) =>
              r.value == null ? null : (
                <circle key={r.analysisId} cx={x(r.value)} cy={y} r="4.5" fill="var(--blue)" opacity="0.8">
                  <title>{`${g.condition} · run ${r.runId.slice(0, 8)}${r.pairId ? ` · pair ${r.pairId.slice(0, 8)}` : ""} · ${formatValue(metric, r.value)}`}</title>
                </circle>
              ),
            )}
          </g>
        );
      })}
      <text x={LEFT} y={height - 3} className="chart-label">
        0
      </text>
      <text x={W - RIGHT} y={height - 3} textAnchor="end" className="chart-label">
        {formatValue(metric, top)}
      </text>
    </svg>
  );
}

function DifferenceRows({ diff, metric }: { diff: ConditionDifference; metric: Comparison["metric"] }) {
  const interval = diff.interval;
  const label = `${diff.condition} − ${diff.baseline}`;
  return (
    <>
      <tr>
        <th scope="row">{label}</th>
        <td className="n">{diff.conditionRuns} / {diff.baselineRuns}</td>
        <td className="n">{interval ? signed(metric, interval.estimate) : "–"}</td>
        <td className="n">{interval ? `${signed(metric, interval.lower)} to ${signed(metric, interval.upper)}` : "No runs on one side"}</td>
        <td>Run bootstrap</td>
      </tr>
      {diff.paired !== undefined && (
        <tr>
          <th scope="row">{label} · paired</th>
          <td className="n">{diff.paired ? `${diff.paired.pairs.length} pairs` : "0 pairs"}</td>
          <td className="n">{diff.paired ? signed(metric, diff.paired.estimate) : "–"}</td>
          <td className="n">{diff.paired ? `${signed(metric, diff.paired.lower)} to ${signed(metric, diff.paired.upper)}` : "No shared pairId"}</td>
          <td>Within-pair differences</td>
        </tr>
      )}
    </>
  );
}

/** Per-pair differences, so a reader can see what the paired interval is built from. */
function PairedPoints({ diff, metric }: { diff: ConditionDifference; metric: Comparison["metric"] }) {
  if (!diff.paired?.pairs.length) return null;
  return (
    <Table label={`Paired differences, ${diff.condition} against ${diff.baseline}`} headers={["Pair", diff.baseline, diff.condition, "Difference"]}>
      {diff.paired.pairs.map((pair) => (
        <tr key={pair.pairId}>
          <th scope="row" className="mono">
            {pair.pairId.slice(0, 8)}
          </th>
          <td className="n">{formatValue(metric, pair.baseline)}</td>
          <td className="n">{formatValue(metric, pair.condition)}</td>
          <td className="n">{signed(metric, pair.difference)}</td>
        </tr>
      ))}
    </Table>
  );
}

function CodeSection({ code, comparison }: { code: ComparisonCode; comparison: Comparison }) {
  const small = comparison.warnings.filter((w) => w.code === "few-runs").map((w) => w.condition);
  return (
    <Card className="an-card">
      <CardHeading
        ruled
        title={code.code}
        description={`${comparison.metric} per run at ${pct(code.threshold.yes)} (${SOURCE_LABELS[code.threshold.source]} threshold). Each dot is one run; the bar is the condition mean.`}
      />
      <div className="card-body an-body">
        <ConditionStrip code={code} metric={comparison.metric} />
        <Table label={`Difference in ${code.code}`} headers={["Contrast", "Runs (condition / baseline)", "Difference", `${Math.round(comparison.confidence * 100)}% interval`, "Method"]}>
          {code.differences.map((d) => (
            <DifferenceRows key={d.condition} diff={d} metric={comparison.metric} />
          ))}
        </Table>
        {code.differences.some((d) => small.includes(d.condition) || small.includes(d.baseline)) && (
          <p className="helper">Fewer than five runs in a condition: the interval is shown but is too narrow a base to interpret.</p>
        )}
        {code.differences.map((d) => (
          <PairedPoints key={d.condition} diff={d} metric={comparison.metric} />
        ))}
      </div>
    </Card>
  );
}

/** Spec 8.4: a display join. Monitor verdicts never alter Jev aggregation, and nothing here is fed back to the monitor. */
export function OversightJoin({ comparison, evaluations }: { comparison: Comparison; evaluations: readonly MonitorEvaluation[] }) {
  const rows = oversightVerdicts(comparison.runIds, evaluations);
  if (!rows.length) return null;
  const condition = new Map(comparison.inputs.map((i) => [i.runId, i.condition]));
  const first = comparison.codes[0];
  const value = (runId: string) => first?.groups.flatMap((g) => g.runs).find((r) => r.runId === runId)?.value;
  return (
    <Card className="an-card">
      <CardHeading ruled title="Oversight monitor verdicts" description="Run-level verdicts from monitor evaluations, shown beside the run metrics. A display join only: Jev results do not feed the monitor and its verdicts do not change these numbers." />
      <div className="card-body an-body">
        <Table label="Monitor verdicts by run" headers={["Run", "Condition", first ? `${first.code} ${comparison.metric}` : "Metric", "Outcome", "View", "Verdict"]}>
          {rows.map((row) => (
            <tr key={`${row.runId}|${row.outcomeId}|${row.view}`}>
              <th scope="row" className="mono">
                {row.runId.slice(0, 8)}
              </th>
              <td>{condition.get(row.runId) ?? "–"}</td>
              <td className="n">{formatValue(comparison.metric, value(row.runId))}</td>
              <td>{row.outcomeName}</td>
              <td>{row.view}</td>
              <td>
                <Badge tone={row.verdict === "present" ? "danger" : row.verdict === "uncertain" ? "warning" : "neutral"}>{row.verdict}</Badge>
              </td>
            </tr>
          ))}
        </Table>
        <p className="helper">
          {runsWithVerdicts(rows).length} of {comparison.runIds.length} runs have completed monitor evaluations.
        </p>
      </div>
    </Card>
  );
}

/** A stored comparison: warnings and provenance first, then one section per code, then the oversight join. */
export function ComparisonResult({ comparison, evaluations = [] }: { comparison: Comparison; evaluations?: readonly MonitorEvaluation[] }) {
  return (
    <div className="stack">
      {comparison.warnings.map((w) => (
        <Notice key={`${w.code}:${w.condition ?? ""}`} kind="warning">
          {w.message}
        </Notice>
      ))}
      <p className="helper" data-testid="comparison-provenance">
        {comparison.inputs.length} runs · metric {comparison.metric} · baseline {comparison.baseline} · policy {comparison.policy.kind}
        {comparison.controlAnalysisIds.length > 0 && <> ({comparison.controlAnalysisIds.length} control analyses)</>} · bootstrap over runs, seed {comparison.seed}, {comparison.iterations} resamples
        {comparison.paired && <> · paired by pairId</>}
      </p>
      {comparison.codes.map((code) => (
        <CodeSection key={code.codeId} code={code} comparison={comparison} />
      ))}
      <OversightJoin comparison={comparison} evaluations={evaluations} />
    </div>
  );
}
