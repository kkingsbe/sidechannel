import { useState, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Card,
  CardHeading,
  Empty,
  ErrorState,
  Pager,
  Select,
} from "../../components/ui";
import { useClients } from "../../lib/clients/context";
import { useResourceOffsetPage } from "../../lib/clients/query";
import type { Run } from "../../lib/types";
import { short } from "../../lib/utils";
import { RunReferenceEditor } from "./run-reference-editor";

/** Human reference outcomes: terminal source runs and the independent adjudication form. */
export function ReferencesTab(): ReactElement {
  const clients = useClients();
  const [params] = useSearchParams();
  const [referenceRunId, setReferenceRunId] = useState(
    params.get("run") || "",
  );
  const referenceRuns = useResourceOffsetPage<Run>(
    "oversight:reference-runs",
    async (offset) => {
      const page = await clients.runs.list({
        summary: true,
        status: "completed,failed,cancelled,interrupted",
        offset,
        limit: 25,
      });
      return {
        items: page.items,
        total: page.total ?? page.items.length,
        nextOffset: page.nextOffset ?? null,
      };
    },
    { pageSize: 25 },
  );
  return (
    <div className="stack">
      <Card>
        <CardHeading
          title="Human reference outcomes"
          description="Independent of Jev. Two distinct claimed reviewers must agree on the same evidence and definition revision; an agreed uncertain label stays a final uncertainty."
          actions={
            <span className="cf">
              <span style={{ whiteSpace: "nowrap" }}>Source run</span>
              <Select
                aria-label="Run for outcome adjudication"
                style={{ border: 0, height: 26, minHeight: 26, width: "auto", maxWidth: 320 }}
                value={referenceRunId}
                onChange={(e) => setReferenceRunId(e.target.value)}
              >
                <option value="">Select a run</option>
                {referenceRunId &&
                  !referenceRuns.data.some((run) => run.id === referenceRunId) && (
                    <option value={referenceRunId}>
                      {short(referenceRunId)} (selected source)
                    </option>
                  )}
                {referenceRuns.data.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.config.label} · {run.config.condition.id} · {short(run.id)}
                  </option>
                ))}
              </Select>
            </span>
          }
        />
        {referenceRuns.error && (
          <div className="card-body">
            <ErrorState error={referenceRuns.error} retry={referenceRuns.refresh} />
          </div>
        )}
        {(referenceRuns.page > 0 || referenceRuns.hasMore) && (
          <Pager page={referenceRuns.page} hasMore={referenceRuns.hasMore} onChange={referenceRuns.onChange} />
        )}
        {!referenceRunId && (
          <Empty title="Choose a source run" description="Pick a completed, failed or cancelled run to adjudicate its five run-level outcomes." />
        )}
      </Card>
      {referenceRunId && (
        <RunReferenceEditor
          key={referenceRunId + (params.get("definition") || "")}
          runId={referenceRunId}
          initialDefinitionRevisionId={params.get("definition") || undefined}
        />
      )}
    </div>
  );
}
