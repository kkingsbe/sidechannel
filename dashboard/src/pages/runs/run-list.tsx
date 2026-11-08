import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Filter, RefreshCw } from "lucide-react";
import {
  Button,
  Card,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  Pager,
  Stamp,
} from "../../components/ui";
import { RUN_STATUSES, isTerminalRun } from "@sidechannel/contracts/browser";
import { PairTable } from "../../components/pairs/PairTable";
import { comparability, groupByPair } from "../../components/pairs/group";
import { RunTable } from "../../components/run-table";
import { BatchOutcome, RunDeleteDialog, RunSelectionBar } from "../../components/run-lifecycle";
import { useCommand } from "../../components/use-command";
import type { RunLifecycleBatch } from "../../lib/clients/runs";
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
      archived: params.get("archived") === "only" ? "only" : params.get("archived") === "include" ? "include" : undefined,
      summary: true,
      limit: 25,
      offset,
    }), { interval: 5000 });
  const items = runs.data?.items ?? [];
  const clients_ = clients;
  const command = useCommand();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [batch, setBatch] = useState<RunLifecycleBatch>();
  const archivedView = params.get("archived") === "only";
  const selectable = items.filter((run) => isTerminalRun(run.status));
  const chosen = items.filter((run) => selected.has(run.id));
  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const apply = async (action: RunLifecycleBatch["action"]) => {
    const result = await command.run(() => clients.runs.bulk(action, chosen.map((run) => run.id)));
    setConfirming(false);
    if (!result) return;
    setBatch(result);
    setSelected(new Set(result.results.filter((entry) => !entry.ok).map((entry) => entry.id)));
    void runs.refresh();
  };
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
  const activeFilters = ["status", "model", "condition", "scenario", "designation", "archived"].filter((key) => params.get(key)).length;
  const filter = (key: string, value: string) => {
    setParams((previous) => {
      value ? previous.set(key, value) : previous.delete(key);
      previous.delete("offset");
      return previous;
    });
  };
  const returnSearch =
    "?returnTo=" + encodeURIComponent("/runs" + (params.size ? "?" + params.toString() : ""));
  const groups = groupByPair(items);
  const total = runs.data?.total ?? items.length;
  const verdicts = groups.map((group) => comparability(group.runs));
  const yes = verdicts.filter((v) => v.state === "yes").length;
  const pending = verdicts.filter((v, i) => v.state === "pending" && groups[i]).length;
  const failedBoth = groups.filter((g) => g.runs.length > 1 && g.runs.every((r) => r.status === "failed")).length;
  const partial = verdicts.length - yes - pending - failedBoth;
  const clauses = [
    `${yes} comparable end to end`,
    partial > 0 && `${partial} stopped before both conditions completed`,
    failedBoth > 0 && `${failedBoth} failed in both conditions`,
    pending > 0 && `${pending} still running`,
  ].filter(Boolean);
  const pairCount = groups.filter((g) => g.pairId).length;
  const finding = runs.data ? (
    <>
      <strong>
        {pairCount} matched {pairCount === 1 ? "pair" : "pairs"}, {total} {total === 1 ? "run" : "runs"}.
      </strong>{" "}
      {items.length ? clauses.join("; ") + (total > items.length ? " on this page." : ".") : "Nothing matches the current filters."}
    </>
  ) : (
    "Loading run records."
  );
  const rangeLabel = items.length ? `${offset + 1}–${offset + items.length} of ${total}` : "";
  const showPager = offset > 0 || runs.data?.nextOffset != null;
  return (
    <>
      <PageHeader
        title="Runs"
        description={finding}
        actions={
          <>
            <Stamp at={runs.updatedAt} stale={!!runs.error} />
            <Button asChild>
              <Link to="/experiments/new">New experiment</Link>
            </Button>
          </>
        }
      />
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
          className={"filter-bar rl-filters filter-bar-collapsible" + (filtersOpen ? " filters-open" : "")}
        >
          <div className="filter-fields">
            <label className="cf">
              <span>State</span>
              <select aria-label="Execution state" value={params.get("status") || ""} onChange={(e) => filter("status", e.target.value)}>
                <option value="">All</option>
                {runListGroups.map((group) => (
                  <option key={group.label} value={group.statuses.join(",")}>
                    {group.label}
                  </option>
                ))}
                {RUN_STATUSES.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
            <label className="cf">
              <span>Condition</span>
              <select aria-label="Condition" value={params.get("condition") || ""} onChange={(e) => filter("condition", e.target.value)}>
                <option value="">All</option>
                <option>reviewed</option>
                <option>excluded</option>
                <option>no-board</option>
              </select>
            </label>
            <label className="cf">
              <span>Model</span>
              <input aria-label="Model" value={params.get("model") || ""} placeholder="Any" onChange={(e) => filter("model", e.target.value)} />
            </label>
            <label className="cf">
              <span>Scenario</span>
              <input aria-label="Scenario" value={params.get("scenario") || ""} placeholder="Any" onChange={(e) => filter("scenario", e.target.value)} />
            </label>
            <label className="cf">
              <span>Designation</span>
              <select aria-label="Designation" value={params.get("designation") || ""} onChange={(e) => filter("designation", e.target.value)}>
                <option value="">All</option>
                <option>fixture</option>
                <option>development</option>
                <option>pilot</option>
                <option>study</option>
              </select>
            </label>
            <label className="cf">
              <span>Archived</span>
              <select aria-label="Archived runs" value={params.get("archived") || ""} onChange={(e) => filter("archived", e.target.value)}>
                <option value="">Hide archived</option>
                <option value="include">Show archived</option>
                <option value="only">Only archived</option>
              </select>
            </label>
          </div>
          <div className="seg" role="group" aria-label="List view">
            {(["pairs", "runs"] as const).map((option) => (
              <button key={option} type="button" aria-pressed={view === option} onClick={() => setView(option)}>
                {option === "pairs" ? "Pairs" : "Runs"}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="icon" aria-label="Refresh run list" onClick={runs.refresh}>
            <RefreshCw size={16} />
          </Button>
        </div>
        {runs.error && <ErrorState error={runs.error} retry={runs.refresh} />}
        {command.error && <Notice kind="error">{command.error.message}</Notice>}
        <BatchOutcome batch={batch} runs={items} />
        {view === "runs" && (
          <RunSelectionBar
            count={chosen.length}
            archivedView={archivedView}
            busy={command.busy}
            onArchive={() => void apply(archivedView ? "unarchive" : "archive")}
            onDelete={() => setConfirming(true)}
            onClear={() => setSelected(new Set())}
          />
        )}
        {view === "runs" && selectable.length > 0 && (
          <label className="select-page small muted">
            <input
              type="checkbox"
              checked={selectable.every((run) => selected.has(run.id))}
              onChange={(e) => setSelected(e.target.checked ? new Set([...selected, ...selectable.map((run) => run.id)]) : new Set([...selected].filter((id) => !selectable.some((run) => run.id === id))))}
            />{" "}
            Select all finished runs on this page
          </label>
        )}
        {runs.loading ? (
          <Loading />
        ) : items.length ? (
          view === "pairs" ? (
            <PairTable runs={items} detailSearch={returnSearch} showComparable />
          ) : (
            <RunTable runs={items} detailSearch={returnSearch} selection={{ selected, onToggle: toggle }} />
          )
        ) : (
          <Empty
            title="No runs match these filters"
            description="Adjust filters or launch an experiment from a saved draft."
          />
        )}
        <RunDeleteDialog runs={confirming ? chosen : []} busy={command.busy} onCancel={() => setConfirming(false)} onConfirm={() => apply("delete")} />
        {rangeLabel && !runs.loading && (
          <div className="card-foot">
            <span>Showing runs {rangeLabel}</span>
          </div>
        )}
        {showPager && (
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
        )}
      </Card>
    </>
  );
}
