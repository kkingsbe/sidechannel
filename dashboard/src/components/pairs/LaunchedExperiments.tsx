import { Card, CardHeading, Empty, ErrorState, Loading } from "../ui";
import { useClients } from "../../lib/clients/context";
import { useResource } from "../../lib/clients/query";
import type { Run } from "../../lib/types";
import { PairTable } from "./PairTable";
import { experimentKey, groupByPair } from "./group";

export interface LaunchedGroup {
  key: string;
  name: string;
  runs: Run[];
  pairs: number;
  latest: string;
}

/** Launched runs grouped by experiment (draft group or label), newest first. */
export function useLaunchedExperiments() {
  const clients = useClients();
  const runs = useResource<{ items: Run[] }>("runs:launched", () => clients.runs.list({ summary: true, limit: 50 }), { interval: 10000 });
  const items = runs.data?.items ?? [];
  const experiments = new Map<string, LaunchedGroup>();
  for (const run of items) {
    const key = experimentKey(run);
    const entry = experiments.get(key) ?? { key, name: run.config?.label || key, runs: [], pairs: 0, latest: "" };
    entry.runs.push(run);
    if ((run.createdAt ?? "") > entry.latest) entry.latest = run.createdAt ?? "";
    experiments.set(key, entry);
  }
  const groups = [...experiments.values()]
    .map((entry) => ({ ...entry, pairs: groupByPair(entry.runs).length }))
    .sort((a, b) => b.latest.localeCompare(a.latest));
  return { resource: runs, groups, runCount: items.length };
}

/**
 * Launched pairs. A group earns its own subheader only when it holds two or more pairs; every
 * single-pair experiment goes into one flat table so a name is never repeated as a heading.
 */
export function LaunchedExperiments({ data }: { data?: ReturnType<typeof useLaunchedExperiments> } = {}) {
  const own = useLaunchedExperiments();
  const { resource: runs, groups } = data ?? own;
  const multi = groups.filter((group) => group.pairs >= 2);
  const singles = groups.filter((group) => group.pairs < 2).flatMap((group) => group.runs);
  return (
    <Card>
      <CardHeading title="Launched experiments" count={groups.length || undefined} />
      {runs.loading ? (
        <Loading />
      ) : runs.error && !runs.data ? (
        <ErrorState error={runs.error} retry={runs.refresh} />
      ) : !groups.length ? (
        <Empty title="Nothing launched yet" description="Start a new experiment, validate it and launch the matched pair to see it here." />
      ) : (
        <>
          {multi.map((group) => (
            <section key={group.key} className="launched-experiment" style={{ padding: 0 }} aria-label={group.name}>
              <div className="trow" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", background: "var(--subtle)", minHeight: 36 }}>
                <span style={{ fontWeight: 500 }}>{group.name}</span>
                <span className="small muted">{group.pairs} pairs</span>
              </div>
              <PairTable runs={group.runs} label={"Pairs for " + group.name} />
            </section>
          ))}
          {singles.length > 0 && (
            <section className="launched-experiment" style={{ padding: 0 }} aria-label="Single-pair experiments">
              {multi.length > 0 && (
                <div className="trow" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", background: "var(--subtle)", minHeight: 36 }}>
                  <span style={{ fontWeight: 500 }}>Single-pair experiments</span>
                  <span className="small muted">{groupByPair(singles).length} pairs</span>
                </div>
              )}
              <PairTable runs={singles} label="Launched pairs" />
            </section>
          )}
        </>
      )}
    </Card>
  );
}
