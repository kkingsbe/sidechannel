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
import { RunTable } from "../../components/run-table";
import { RUN_STATUSES } from "@sidechannel/contracts/browser";
import { useClients } from "../../lib/clients/context";
import { useResource } from "../../lib/clients/query";
import type { RecordPage } from "../../lib/clients/runs";
import { runListGroups } from "../../lib/status";
import type { Run } from "../../lib/types";

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
  const filter = (key: string, value: string) => {
    setParams((previous) => {
      value ? previous.set(key, value) : previous.delete(key);
      previous.delete("offset");
      return previous;
    });
  };
  return (
    <>
      <PageHeader
        eyebrow="CANONICAL SOURCE RECORD"
        title="Experiment runs"
        description="Follow execution, inspect evidence, and navigate matched conditions."
        actions={
          <Button asChild>
            <Link to="/experiments/new">New experiment</Link>
          </Button>
        }
      />
      <Card>
        <div className="filter-bar">
          <Filter size={16} className="muted" aria-hidden="true" />
          <Field label="Execution state">
            <Select value={params.get("status") || ""} onChange={(e) => filter("status", e.target.value)}>
              <option value="">All states</option>
              {runListGroups.map((group) => (
                <option key={group.label} value={group.statuses.join(",")}>{group.label}</option>
              ))}
              {RUN_STATUSES.map((v) => (
                <option key={v}>{v}</option>
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
          <Button variant="ghost" size="icon" aria-label="Refresh run list" onClick={runs.refresh}>
            <RefreshCw size={16} />
          </Button>
        </div>
        {runs.error && <ErrorState error={runs.error} retry={runs.refresh} />}
        {runs.loading ? (
          <Loading />
        ) : items.length ? (
          <RunTable
            runs={items}
            detailSearch={"?returnTo=" + encodeURIComponent("/runs" + (params.size ? "?" + params.toString() : ""))}
          />
        ) : (
          <Empty title="No runs match these filters" description="Adjust filters or launch an experiment from a saved draft." />
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
