import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button, Card, CardHeading, Check, ErrorState, Field, Input, Loading, Notice, Select } from "../../components/ui";
import { useCommand } from "../../components/use-command";
import { useClients } from "../../lib/clients/context";
import { useResource } from "../../lib/clients/query";
import { COMPARISON_METRICS } from "@sidechannel/contracts/browser";
import type { AnalysisJob, Comparison, ComparisonMetric, ThresholdPolicy } from "../../lib/analysis-types";
import { short } from "../../lib/utils";
import { ComparisonResult } from "./comparison-result";
import { PolicyPicker } from "./policy-picker";
import { DEFAULT_POLICY } from "./summary-view";

const METRIC_LABELS: Record<ComparisonMetric, string> = {
  max: "Maximum window score",
  mean: "Mean window score",
  countAbove: "Windows at or above threshold",
  fractionAbove: "Fraction of windows at or above threshold",
  kStrikes: "Runs triggering k strikes",
};

const RESULT_STATUSES = new Set(["completed", "partial"]);

/**
 * Condition comparison (spec 8.3): choose analyses of different runs, the threshold policy and metric, then read per-run
 * values by condition with run-level bootstrap intervals. `?ids=a,b` preselects analyses; `?comparison=id` reopens a stored one.
 */
export function ConditionComparison() {
  const clients = useClients();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<string[]>(() => (params.get("ids") ?? "").split(",").filter(Boolean));
  const [policy, setPolicy] = useState<ThresholdPolicy>(DEFAULT_POLICY);
  const [metric, setMetric] = useState<ComparisonMetric>("max");
  const [paired, setPaired] = useState(true);
  const [seed, setSeed] = useState("1");
  const command = useCommand();
  const comparisonId = params.get("comparison");
  const analyses = useResource<{ items: AnalysisJob[] }>("analysis:compare:list", () => clients.analyses.list({ limit: 100 }));
  const stored = useResource<Comparison>(comparisonId ? `comparison:${comparisonId}` : null, () => clients.analyses.comparison(comparisonId!));
  // Oversight verdicts are optional context: a failure leaves the join out rather than blocking the comparison.
  const evaluations = useResource(stored.data ? `comparison:${comparisonId}:oversight` : null, () => clients.monitor.evaluations({ limit: 100 }));
  const available = (analyses.data?.items ?? []).filter((job) => RESULT_STATUSES.has(job.status));
  const seedNumber = Number(seed);
  const seedValid = seed.trim() !== "" && Number.isInteger(seedNumber) && seedNumber >= 0;
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  const run = async () => {
    const created = await command.run(() => clients.analyses.createComparison({ analysisIds: selected, policy, metric, paired, seed: seedNumber }));
    if (created)
      setParams((prev) => {
        prev.set("comparison", created.id);
        return prev;
      });
  };
  return (
    <>
      <Link className="crumb-back" to="/analysis">
        <ArrowLeft size={14} />
        All analyses
      </Link>
      <header className="objhead">
        <div className="an-headtext">
          <div className="titleline">
            <h1>Compare conditions</h1>
          </div>
          <div className="meta">
            <span>One analysis per run. Intervals resample runs, never windows, because windows within a run are correlated.</span>
          </div>
        </div>
      </header>
      <Card className="an-card">
        <CardHeading ruled title="Analyses" description="Pick completed analyses of different runs that share a codebook revision and model." />
        <div className="card-body an-body">
          {analyses.loading ? (
            <Loading />
          ) : analyses.error && !analyses.data ? (
            <ErrorState error={analyses.error} retry={analyses.refresh} />
          ) : (
            <div role="group" aria-label="Analyses to compare">
              {available.map((job) => (
                <Check key={job.id} label={`${short(job.id)} · run ${short(job.runId)} · ${job.manifest.settings.model} · ${job.manifest.settings.windowSize}/${job.manifest.settings.stride}`} checked={selected.includes(job.id)} onChange={() => toggle(job.id)} />
              ))}
              {selected.filter((id) => !available.some((job) => job.id === id)).map((id) => (
                <Check key={id} label={`${short(id)} (not in the recent list)`} checked onChange={() => toggle(id)} />
              ))}
            </div>
          )}
          <hr className="section-divider" />
          <PolicyPicker policy={policy} onChange={setPolicy} />
          <div className="form-grid">
            <Field label="Metric">
              <Select value={metric} onChange={(e) => setMetric(e.target.value as ComparisonMetric)}>
                {COMPARISON_METRICS.map((m) => (
                  <option key={m} value={m}>
                    {METRIC_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Bootstrap seed" hint="Recorded with the comparison so it reproduces" error={seedValid ? undefined : "Use a whole number, 0 or more."}>
              <Input inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value)} />
            </Field>
          </div>
          <Check label="Also show the paired variant (differences within matched pairs)" checked={paired} onChange={(e) => setPaired(e.target.checked)} />
          <div className="actions">
            <Button disabled={command.busy || selected.length < 2 || !seedValid} onClick={() => void run()}>
              Compare {selected.length || ""} {selected.length === 1 ? "analysis" : "analyses"}
            </Button>
          </div>
          {command.error && <Notice kind="error">{command.error.message}</Notice>}
        </div>
      </Card>
      {comparisonId &&
        (stored.loading ? (
          <Loading />
        ) : stored.error && !stored.data ? (
          <ErrorState error={stored.error} retry={stored.refresh} />
        ) : (
          stored.data && <ComparisonResult comparison={stored.data} evaluations={evaluations.data?.items ?? []} />
        ))}
    </>
  );
}
