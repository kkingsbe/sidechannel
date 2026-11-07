import { Card, CardHeading, ErrorState, Loading } from "../ui";
import { arrayOf, useApi } from "../../lib/api";
import type { Run } from "../../lib/types";
import { PairTable } from "./PairTable";
import { experimentKey, groupByPair } from "./group";

/** Launched runs grouped by experiment (draft group or label), newest first. */
export function LaunchedExperiments() {
  const runs = useApi<{ items: Run[] }>("/runs?summary=true&limit=50", 10000);
  const items = arrayOf<Run>(runs.data);
  const experiments = new Map<string, { name: string; runs: Run[]; latest: string }>();
  for (const run of items) {
    const key = experimentKey(run);
    const entry = experiments.get(key) ?? { name: run.config?.label || key, runs: [], latest: "" };
    entry.runs.push(run);
    if ((run.createdAt ?? "") > entry.latest) entry.latest = run.createdAt ?? "";
    experiments.set(key, entry);
  }
  const ordered = [...experiments.entries()].sort((a, b) => b[1].latest.localeCompare(a[1].latest));
  return (
    <Card>
      <CardHeading title="Launched experiments" description="Matched pairs that have been launched, grouped by experiment, newest first." />
      {runs.loading ? (
        <Loading />
      ) : runs.error && !runs.data ? (
        <ErrorState error={runs.error} retry={runs.refresh} />
      ) : !ordered.length ? (
        <p className="card-body">No experiments launched yet.</p>
      ) : (
        ordered.map(([key, entry]) => {
          const pairs = groupByPair(entry.runs).length;
          return (
            <section key={key} className="launched-experiment" aria-label={entry.name}>
              <h3>{entry.name}</h3>
              <small className="muted">{pairs} {pairs === 1 ? "pair" : "pairs"}</small>
              <PairTable runs={entry.runs} label={"Pairs for " + entry.name} />
            </section>
          );
        })
      )}
    </Card>
  );
}
