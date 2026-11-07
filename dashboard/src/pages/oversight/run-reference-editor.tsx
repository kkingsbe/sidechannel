import { REVIEWER_STORAGE_KEY } from "../../components/claimed-reviewer";
import { Link } from "react-router-dom";
import type { ReactElement } from "react";
import { Download } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeading,
  ErrorState,
  Field,
  Input,
  Loading,
  Notice,
  Pager,
  Select,
  Table,
  Textarea,
} from "../../components/ui";
import { useClients } from "../../lib/clients/context";
import { agreementMeta } from "../../lib/status";
import { short, when } from "../../lib/utils";
import { ReferenceHistory } from "./reference-history";
import { useMonitorDefinitionHistory } from "./use-monitor-definition";
import { useRunReference } from "./use-run-reference";

/** Human reference adjudication: claim identity, cite evidence, append immutable revisions. */
export function RunReferenceEditor({
  runId,
  initialDefinitionRevisionId,
}: {
  runId: string;
  initialDefinitionRevisionId?: string;
}): ReactElement {
  const reference = useRunReference(runId, initialDefinitionRevisionId);
  const clients = useClients();
  const definitionHistory = useMonitorDefinitionHistory();
  const { context, command, latest, reviews } = reference;
  if (context.loading) return <Loading />;
  if (!context.data)
    return <ErrorState error={context.error} retry={context.refresh} />;
  const data = context.data;
  const active = data.definition.outcomes.filter((o) => !o.archived);
  const previous = latest.data ?? undefined;
  const selectedOutcome = active.find((o) => o.id === reference.outcomeId);
  return (
    <Card style={{ marginTop: 20 }}>
      <CardHeading
        title="Run-level reference adjudication"
        description={`Source ${short(runId)} · definition revision ${data.definition.revision} · ${data.eventCount} source events`}
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <Link to={"/runs/" + runId}>Inspect full source evidence</Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a
                download
                href={clients.reviews.exportUrl(runId, data.definition.id)}
              >
                <Download size={14} />
                Reference export
              </a>
            </Button>
          </>
        }
      />
      <div className="card-body">
        {command.error && (
          <Notice kind="error">{command.error.message}</Notice>
        )}
        {command.message && <Notice kind="success">{command.message}</Notice>}
        {latest.error && (
          <ErrorState error={latest.error} retry={latest.refresh} />
        )}
        <div className="form-grid">
          <Field
            label="Reference definition revision"
            hint="Historical evaluations must be reviewed against their own immutable outcome definitions."
          >
            <Select
              aria-label="Reference definition revision"
              value={data.definition.id}
              onChange={(e) =>
                reference.setDefinitionRevisionId(e.target.value)
              }
            >
              {!definitionHistory.items.some(
                (item) => item.id === data.definition.id,
              ) && (
                <option value={data.definition.id}>
                  Revision {data.definition.revision} (selected)
                </option>
              )}
              {definitionHistory.items.map((item) => (
                <option key={item.id} value={item.id}>
                  Revision {item.revision} / {when(item.createdAt)}
                </option>
              ))}
            </Select>
            <Pager
              page={definitionHistory.page}
              hasMore={definitionHistory.hasMore}
              onChange={definitionHistory.onChange}
            />
            {definitionHistory.error && (
              <ErrorState
                error={definitionHistory.error}
                retry={definitionHistory.refresh}
              />
            )}
          </Field>
          <Field
            required
            label="Claimed reviewer identity"
            hint="Names are self-entered, not authenticated accounts."
          >
            <Input
              aria-label="Claimed reviewer identity"
              value={reference.reviewer}
              onChange={(e) => {
                reference.setReviewer(e.target.value);
                localStorage.setItem(REVIEWER_STORAGE_KEY, e.target.value);
              }}
            />
          </Field>
          <Field required label="Outcome definition">
            <Select
              value={reference.outcomeId}
              onChange={(e) => reference.setOutcomeId(e.target.value)}
            >
              {active.map((outcome) => (
                <option key={outcome.id} value={outcome.id}>
                  {outcome.name}
                </option>
              ))}
            </Select>
          </Field>
          {selectedOutcome && (
            <Notice>
              <strong>{selectedOutcome.definition}</strong>
              <p>{selectedOutcome.qualifyingCriteria}</p>
              <p>Present: {selectedOutcome.presentGuidance}</p>
              <p>Absent: {selectedOutcome.absentGuidance}</p>
              <p>Uncertain: {selectedOutcome.uncertainGuidance}</p>
            </Notice>
          )}
          <Field label="Human judgment">
            <Select
              value={reference.decision}
              onChange={(e) =>
                reference.setDecision(e.target.value as typeof reference.decision)
              }
            >
              <option>present</option>
              <option>absent</option>
              <option>uncertain</option>
            </Select>
          </Field>
          <Field
            required={reference.decision === "present"}
            label="Supporting source event IDs"
            hint="One actual event ID per line. Present judgments require at least one citation."
            className="full"
          >
            <Textarea
              value={reference.evidence}
              onChange={(e) => reference.setEvidence(e.target.value)}
            />
          </Field>
          <Field
            required
            label="Rationale / unresolved questions"
            className="full"
          >
            <Textarea
              rows={8}
              aria-label="Rationale / unresolved questions"
              value={reference.rationale}
              onChange={(e) => reference.setRationale(e.target.value)}
            />
          </Field>
          <div className="full action-prerequisites">
            <strong>Reference save requirements</strong>
            <ul>
              {[
                !reference.reviewer.trim() &&
                  "Enter your claimed reviewer identity.",
                !reference.outcomeId && "Select an active outcome definition.",
                !reference.rationale.trim() &&
                  "Write a rationale or unresolved questions.",
                reference.decision === "present" &&
                  !reference.evidence.trim() &&
                  "Cite at least one actual source event for a present judgment.",
                latest.loading && "Checking your latest revision - ",
                latest.error &&
                  "Retry loading your latest revision before saving.",
                command.busy && "Saving your review - ",
              ]
                .filter(Boolean)
                .map((item) => (
                  <li key={String(item)}>{item}</li>
                ))}
            </ul>
            <p className="helper">
              Two distinct reviewers must agree on the same evidence and
              definition revision to finalize a reference.
            </p>
          </div>
          <div className="full actions">
            <Button
              disabled={
                command.busy ||
                latest.loading ||
                !!latest.error ||
                !reference.reviewer.trim() ||
                !reference.rationale.trim() ||
                !reference.outcomeId ||
                (reference.decision === "present" && !reference.evidence.trim())
              }
              onClick={reference.save}
            >
              {previous
                ? "Append revision / reconfirm"
                : "Save provisional reference"}
            </Button>
            <span className="helper">
              Revising an agreed judgment reopens finalization until the other
              reviewer reconfirms.
            </span>
          </div>
        </div>
        <hr className="section-divider" />
        <Table
          label="Human outcome agreement states"
          headers={[
            "Outcome",
            "Finalization",
            "Decision",
            "Contributing revisions",
          ]}
        >
          {active.map((outcome) => {
            const agreement = reference.agreements.data?.find(
              (a) =>
                a.outcomeId === outcome.id &&
                a.definitionRevisionId === data.definition.id,
            );
            return (
              <tr key={outcome.id}>
                <td>{outcome.name}</td>
                <td>
                  {agreement ? (
                    <Badge tone={agreementMeta[agreement.state].tone}>{agreementMeta[agreement.state].label}</Badge>
                  ) : (
                    <Badge>Unreviewed</Badge>
                  )}
                </td>
                <td>{agreement?.decision || "Unresolved"}</td>
                <td>
                  {agreement?.reviewIds.length || 0} reviews
                  {agreement && !agreement.sourceMatches && (
                    <small>Source changed · excluded</small>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
        <ReferenceHistory reviews={reviews} />
      </div>
    </Card>
  );
}
