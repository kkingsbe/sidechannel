import { useState, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Card,
  CardHeading,
  ErrorState,
  Field,
  Notice,
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
    <>
      <Notice>
        Human references are independent from Jev. Two distinct claimed
        reviewers must agree on the same evidence and definition revision. An
        agreed uncertain label remains a final uncertainty.
      </Notice>
      <Card>
        <CardHeading title="Select a terminal source run" />
        <div className="card-body">
          <Field label="Run for outcome adjudication">
            <Select
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
                  {run.config.label} · {short(run.id)}
                </option>
              ))}
            </Select>
          </Field>
          {referenceRuns.error && (
            <ErrorState error={referenceRuns.error} retry={referenceRuns.refresh} />
          )}
          <Pager
            page={referenceRuns.page}
            hasMore={referenceRuns.hasMore}
            onChange={referenceRuns.onChange}
          />
        </div>
      </Card>
      {referenceRunId && (
        <RunReferenceEditor
          key={referenceRunId + (params.get("definition") || "")}
          runId={referenceRunId}
          initialDefinitionRevisionId={params.get("definition") || undefined}
        />
      )}
    </>
  );
}
