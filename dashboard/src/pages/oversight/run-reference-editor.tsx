import { REVIEWER_STORAGE_KEY } from "../../components/claimed-reviewer";
import { IdentityLine } from "../../components/identity-line";
import { Link } from "react-router-dom";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { HarnessEvent } from "@sidechannel/contracts/browser";
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
import { list, short, when } from "../../lib/utils";
import { summarizeValue } from "../../components/readable-value";
import { ReferenceHistory } from "./reference-history";
import { useMonitorDefinitionHistory } from "./use-monitor-definition";
import { useRunReference } from "./use-run-reference";

/** Cites actual run events by id; the textarea remains the source of truth. */
function CitationPicker({
  runId,
  value,
  onChange,
}: {
  runId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const clients = useClients();
  const [events, setEvents] = useState<HarnessEvent[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();
  const [query, setQuery] = useState("");
  const load = useCallback(
    async (after?: string) => {
      setLoading(true);
      setError(undefined);
      try {
        const result = await clients.runs.events(runId, { limit: 50, after });
        setEvents((previous) =>
          after ? [...previous, ...result.items] : result.items,
        );
        setNext(result.nextCursor);
      } catch (caught) {
        setError(caught as Error);
      } finally {
        setLoading(false);
      }
    },
    [clients, runId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const ids = list(value);
  const needle = query.trim().toLowerCase();
  const rows = events
    .map((event) => ({ event, summary: summarizeValue(event.data, 100) }))
    .filter(
      ({ event, summary }) =>
        !needle ||
        `${event.sequence} ${event.type} ${event.agentId ?? ""} ${summary}`
          .toLowerCase()
          .includes(needle),
    );
  const toggle = (id: string, checked: boolean) =>
    onChange(
      (checked
        ? [...ids.filter((x) => x !== id), id]
        : ids.filter((x) => x !== id)
      ).join("\n"),
    );
  return (
    <div className="oversight-citation-picker">
      <strong>Cite events from this run</strong>
      <p className="helper">{ids.length} selected. Present judgments need at least one citation.</p>
      <Input
        type="search"
        aria-label="Search run events"
        placeholder="Search loaded events by sequence, type, actor or text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && (
        <ErrorState
          error={error}
          retry={() => load(events.length ? (next ?? undefined) : undefined)}
        />
      )}
      <div className="oversight-citation-list">
        {rows.map(({ event, summary }) => (
          <label key={event.id} className="oversight-citation-row">
            <input
              type="checkbox"
              aria-label={"Cite event " + event.sequence}
              checked={ids.includes(event.id)}
              onChange={(e) => toggle(event.id, e.target.checked)}
            />
            <span className="mono">#{event.sequence}</span>
            <span>{event.type.replaceAll("_", " ")}</span>
            <span>{event.agentId ?? "system"}</span>
            <span className="oversight-citation-summary">{summary}</span>
          </label>
        ))}
        {!loading && !error && !rows.length && (
          <p className="helper">No loaded events match.</p>
        )}
        {loading && <Loading label="Loading events…" />}
      </div>
      {next != null && !loading && (
        <Button variant="secondary" size="sm" onClick={() => load(next)}>
          Load more events
        </Button>
      )}
    </div>
  );
}

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
  const requirements = [
    !reference.reviewer.trim() && "Enter your claimed reviewer identity.",
    !reference.outcomeId && "Select an active outcome definition.",
    !reference.rationale.trim() && "Write a rationale or unresolved questions.",
    reference.decision === "present" && !reference.evidence.trim() && "Cite at least one actual source event for a present judgment.",
    latest.loading && "Checking your latest revision…",
    latest.error && "Retry loading your latest revision before saving.",
    command.busy && "Saving your review…",
  ].filter(Boolean) as string[];
  return (
    <div className="stack">
      <Card>
        <CardHeading
          ruled
          title="Run-level reference adjudication"
          description={`Source ${short(runId)} · definition revision ${data.definition.revision} · ${data.eventCount} source events`}
          actions={
            <>
              <Button asChild variant="secondary" size="sm">
                <Link to={"/runs/" + runId}>Inspect full source evidence</Link>
              </Button>
              <Button asChild variant="secondary" size="sm">
                <a download href={clients.reviews.exportUrl(runId, data.definition.id)}>
                  <Download size={14} />
                  Reference export
                </a>
              </Button>
            </>
          }
        />
        <div className="card-body" style={{ paddingTop: 16, display: "grid", gap: 16 }}>
          {command.error && <Notice kind="error">{command.error.message}</Notice>}
          {command.message && <Notice kind="success">{command.message}</Notice>}
          {latest.error && <ErrorState error={latest.error} retry={latest.refresh} />}
          <div className="two">
            <Field
              label="Reference definition revision"
              hint="Historical evaluations are reviewed against their own immutable definitions."
            >
              <Select
                aria-label="Reference definition revision"
                value={data.definition.id}
                onChange={(e) => reference.setDefinitionRevisionId(e.target.value)}
              >
                {!definitionHistory.items.some((item) => item.id === data.definition.id) && (
                  <option value={data.definition.id}>Revision {data.definition.revision} (selected)</option>
                )}
                {definitionHistory.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    Revision {item.revision} / {when(item.createdAt)}
                  </option>
                ))}
              </Select>
              {(definitionHistory.page > 0 || definitionHistory.hasMore) && (
                <Pager page={definitionHistory.page} hasMore={definitionHistory.hasMore} onChange={definitionHistory.onChange} />
              )}
              {definitionHistory.error && <ErrorState error={definitionHistory.error} retry={definitionHistory.refresh} />}
            </Field>
            <div className="field">
              <div><span style={{ fontSize: 14, fontWeight: 500 }}>Reviewer</span></div>
              <div style={{ minHeight: 38, display: "flex", alignItems: "center" }}>
                <IdentityLine
                  lead="Adjudicating as"
                  value={reference.reviewer}
                  onChange={(value) => {
                    reference.setReviewer(value);
                    localStorage.setItem(REVIEWER_STORAGE_KEY, value);
                  }}
                  inputLabel="Claimed reviewer identity"
                />
              </div>
              <span className="field-hint">Names are self-entered, not authenticated accounts.</span>
            </div>
          </div>
          <div className="well">
            <Field required label="Outcome definition">
              <Select value={reference.outcomeId} onChange={(e) => reference.setOutcomeId(e.target.value)}>
                {active.map((outcome) => (
                  <option key={outcome.id} value={outcome.id}>{outcome.name}</option>
                ))}
              </Select>
            </Field>
            {selectedOutcome && (
              <div className="small muted" style={{ display: "grid", gap: 4 }}>
                <strong style={{ color: "var(--foreground)", fontWeight: 500, fontSize: 13 }}>{selectedOutcome.definition}</strong>
                <span>{selectedOutcome.qualifyingCriteria}</span>
                <span>Present: {selectedOutcome.presentGuidance}</span>
                <span>Absent: {selectedOutcome.absentGuidance}</span>
                <span>Uncertain: {selectedOutcome.uncertainGuidance}</span>
              </div>
            )}
          </div>
          <Field label="Human judgment">
            <Select value={reference.decision} onChange={(e) => reference.setDecision(e.target.value as typeof reference.decision)}>
              <option>present</option>
              <option>absent</option>
              <option>uncertain</option>
            </Select>
          </Field>
          <CitationPicker runId={runId} value={reference.evidence} onChange={reference.setEvidence} />
          <details>
            <summary className="small muted" style={{ cursor: "pointer" }}>Paste IDs instead</summary>
            <div style={{ marginTop: 8 }}>
              <Field
                required={reference.decision === "present"}
                label="Supporting source event IDs"
                hint="One actual event ID per line."
                error={command.error?.message}
              >
                <Textarea rows={3} value={reference.evidence} onChange={(e) => reference.setEvidence(e.target.value)} />
              </Field>
            </div>
          </details>
          <Field required label="Rationale / unresolved questions">
            <Textarea
              rows={4}
              aria-label="Rationale / unresolved questions"
              value={reference.rationale}
              onChange={(e) => reference.setRationale(e.target.value)}
            />
          </Field>
        </div>
        <div className="card-foot editor-foot">
          <span className="why">
            {requirements.length
              ? requirements.join(" ")
              : "Two distinct reviewers must agree on the same evidence and definition revision to finalize. Revising an agreed judgment reopens finalization."}
          </span>
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
            {previous ? "Append revision / reconfirm" : "Save provisional reference"}
          </Button>
        </div>
      </Card>
      <Card>
        <CardHeading ruled title="Outcome status" description="Finalization and decision per outcome for this definition revision." />
        <Table label="Human outcome agreement states" headers={["Outcome", "Status", "Reviews"]}>
          {active.map((outcome) => {
            const agreement = reference.agreements.data?.find(
              (a) => a.outcomeId === outcome.id && a.definitionRevisionId === data.definition.id,
            );
            const n = agreement?.reviewIds.length || 0;
            return (
              <tr key={outcome.id}>
                <td>{outcome.name}</td>
                <td>
                  {agreement ? (
                    <>
                      <Badge tone={agreementMeta[agreement.state].tone}>{agreementMeta[agreement.state].label}</Badge>{" "}
                      <span className="small muted">{agreement.decision || "unresolved"}</span>
                    </>
                  ) : (
                    <Badge>Unreviewed</Badge>
                  )}
                  {agreement && !agreement.sourceMatches && <small>Source changed · excluded</small>}
                </td>
                <td className="n">{n} {n === 1 ? "review" : "reviews"}</td>
              </tr>
            );
          })}
        </Table>
      </Card>
      <Card>
        <div className="card-body" style={{ paddingTop: 16 }}>
          <ReferenceHistory reviews={reviews} />
        </div>
      </Card>
    </div>
  );
}
