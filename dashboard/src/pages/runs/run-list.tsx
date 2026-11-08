import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Filter, RefreshCw } from "lucide-react";
import {
  Button,
  Card,
  Empty,
  ErrorState,
  Field,
  Input,
  Loading,
  PageHeader,
  Pager,
  Select,
} from "../../components/ui";
import { RUN_STATUSES } from "@sidechannel/contracts/browser";
import { LaunchedExperiments } from "../../components/pairs/LaunchedExperiments";
import { PairTable } from "../../components/pairs/PairTable";
import { RunTable } from "../../components/run-table";
import { useClients } from "../../lib/clients/context";
import { useResource } from "../../lib/clients/query";
import type { RecordPage } from "../../lib/clients/runs";
import { runListGroups } from "../../lib/status";
import type { Run } from "../../lib/types";

/** The run-list view preference; convenience only. */
const RUNS_VIEW_KEY = "sidechannel-runs-view";

export function RunList() {
  const clients = useClients();
  const [params, setParams] = useSearchParams();
  const offset = Number(params.get("offset") || 0);
  const runs = useResource<RecordPage<Run>>("runs:list", () =>
    clients.runs.list({
      status: params.get("status") || undefined,
      model: params.get("model") || undefined,
      condition: params.get("condition") || undefined,
      scenario: params.get("scenario") || undefined,
      designation: params.get("designation") || undefined,
      summary: true,
      limit: 25,
      offset,
    }), { interval: 5000 });
  const items = runs.data?.items ?? [];
  const [view, setViewState] = useState<"pairs" | "runs">(() => {
    try {
      return localStorage.getItem(RUNS_VIEW_KEY) === "runs" ? "runs" : "pairs";
    } catch {
      return "pairs";
    }
  });
  const setView = (next: "pairs" | "runs") => {
    setViewState(next);
    try {
      localStorage.setItem(RUNS_VIEW_KEY, next);
    } catch {
      /* Convenience only. */
    }
  };
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = ["status", "model", "condition", "scenario", "designation"].filter((key) => params.get(key)).length;
  const filter = (key: string, value: string) => {
    setParams((previous) => {
      value ? previous.set(key, value) : previous.delete(key);
      previous.delete("offset");
      return previous;
    });
  };
  const returnSearch =
    "?returnTo=" + encodeURIComponent("/runs" + (params.size ? "?" + params.toString() : ""));
  return (
    <>
      <PageHeader
        eyebrow="RUN RECORDS"
        title="Experiment runs"
        description="Follow execution, inspect evidence, and navigate matched conditions."
        actions={
          <Button asChild>
            <Link to="/experiments/new">New experiment</Link>
          </Button>
        }
      />
      <LaunchedExperiments />
      <Card>
        <Button
          variant="secondary"
          size="sm"
          className="filters-toggle"
          aria-expanded={filtersOpen}
          aria-controls="run-filters"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <Filter size={14} aria-hidden="true" />
          Filters{activeFilters ? ` (${activeFilters})` : ""}
        </Button>
        <div
          id="run-filters"
          className={"filter-bar filter-bar-collapsible" + (filtersOpen ? " filters-open" : "")}
        >
          <Filter size={16} className="muted" aria-hidden="true" />
          <div className="filter-fields">
            <Field label="Execution state">
              <Select value={params.get("status") || ""} onChange={(e) => filter("status", e.target.value)}>
                <option value="">All states</option>
                {runListGroups.map((group) => (
                  <option key={group.label} value={group.statuses.join(",")}>
                    {group.label}
                  </option>
                ))}
                {RUN_STATUSES.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </Select>
            </Field>
            <Field label="Model">
              <Input value={params.get("model") || ""} placeholder="Any model" onChange={(e) => filter("model", e.target.value)} />
            </Field>
            <Field label="Condition">
              <Select value={params.get("condition") || ""} onChange={(e) => filter("condition", e.target.value)}>
                <option value="">Both conditions</option>
                <option>reviewed</option>
                <option>excluded</option>
              </Select>
            </Field>
            <Field label="Scenario">
              <Input value={params.get("scenario") || ""} placeholder="Any scenario" onChange={(e) => filter("scenario", e.target.value)} />
            </Field>
            <Field label="Designation">
              <Select value={params.get("designation") || ""} onChange={(e) => filter("designation", e.target.value)}>
                <option value="">All designations</option>
                <option>fixture</option>
                <option>development</option>
                <option>pilot</option>
                <option>study</option>
              </Select>
            </Field>
          </div>
          <div className="view-toggle" role="group" aria-label="List view">
            {(["pairs", "runs"] as const).map((option) => (
              <Button
                key={option}
                variant={view === option ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={view === option}
                onClick={() => setView(option)}
              >
                {option === "pairs" ? "Pairs" : "Runs"}
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="icon" aria-label="Refresh run list" onClick={runs.refresh}>
            <RefreshCw size={16} />
          </Button>
        </div>
        {runs.error && <ErrorState error={runs.error} retry={runs.refresh} />}
        {runs.loading ? (
          <Loading />
        ) : items.length ? (
          view === "pairs" ? (
            <PairTable runs={items} detailSearch={returnSearch} />
          ) : (
            <RunTable runs={items} detailSearch={returnSearch} />
          )
        ) : (
          <Empty
            title="No runs match these filters"
            description="Adjust filters or launch an experiment from a saved draft."
          />
        )}
        <Pager
          page={Math.floor(offset / 25)}
          hasMore={runs.data?.nextOffset != null}
          onChange={(page) =>
            setParams((prev) => {
              prev.set("offset", String(page * 25));
              return prev;
            })
          }
        />
      </Card>
    </>
  );
}
