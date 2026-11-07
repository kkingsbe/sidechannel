import { useState } from "react";
import { Link } from "react-router-dom";
import { EyeOff } from "lucide-react";
import { Badge, Button, ErrorState, Field, Input, JsonView, Notice, Pager, Select, Textarea } from "../../components/ui";
import { useApi, useMutation, usePage } from "../../lib/api";
import { useClients } from "../../lib/clients/context";
import type { AnalysisJob, Decision, HumanReview, Page, WindowDetail } from "../../lib/analysis-types";
import { list, short, when } from "../../lib/utils";
import { CanonicalEvent } from "./canonical-event";
const decisions: Decision[] = ["present", "absent", "uncertain"];

export function WindowInspector({
  detail,
  job,
  blind,
  onSaved,
  onNext,
  onReturn,
}: {
  onSaved?: () => void;
  onNext?: () => void;
  onReturn?: () => void;
  detail: WindowDetail;
  job: AnalysisJob;
  blind: boolean;
}) {
  const [reviewer, setReviewer] = useState(
    () => localStorage.getItem("sidechannel-reviewer") || "",
  );
  const clients = useClients();
  const reviews = usePage<HumanReview>(
    clients.analyses.paths.reviews(job.id, { windowId: detail.window.id }),
    { interval: 4000, limit: 30 },
  );
  const [scope, setScope] = useState<"window" | "event">("window");
  const [codeId, setCodeId] = useState(
    job.manifest.codebook.codes.find((c) => c.enabled && !c.archived)?.id || "",
  );
  const [decision, setDecision] = useState<Decision>("uncertain");
  const [rationale, setRationale] = useState("");
  const [eventIds, setEventIds] = useState("");
  const ownPresence = useApi<Page<HumanReview>>(
    reviewer.trim()
      ? clients.analyses.paths.reviews(job.id, { windowId: detail.window.id, reviewer, latest: "true", limit: 1 })
      : null,
  );
  const subjectId = scope === "window" ? detail.window.id : list(eventIds)[0];
  const ownLatest = useApi<Page<HumanReview>>(
    reviewer.trim() && subjectId
      ? clients.analyses.paths.reviews(job.id, { windowId: detail.window.id, subjectId, scope, codeId, reviewer, latest: "true", limit: 1 })
      : null,
  );
  const mutation = useMutation();
  const ownReviews =
    ownPresence.data?.items.filter(
      (r) =>
        r.reviewer === reviewer.trim() &&
        (r.subjectId === detail.window.id ||
          detail.window.eventIds.includes(r.subjectId ?? "")),
    ) || [];
  const predictionsVisible = !blind || ownReviews.length > 0;
  const latest = ownLatest.data?.items
    .filter(
      (r) =>
        r.reviewer === reviewer.trim() &&
        r.scope === scope &&
        r.codeId === codeId &&
        (scope === "window"
          ? r.subjectId === detail.window.id
          : r.subjectId === list(eventIds)[0]),
    )
    .at(-1);
  const save = async (advance = false) => {
    const result = await mutation.run(
      () =>
        clients.analyses.saveReview(job.id, {
          reviewer,
          scope,
          windowId: detail.window.id,
          codeId,
          decision,
          rationale,
          eventIds: list(eventIds),
          stepIds: scope === "window" ? detail.window.stepIds : [],
          predictionsVisible,
          supersedes: latest,
        }),
      "Judgment appended to the review history.",
    );
    if (result) {
      void reviews.refresh();
      void ownPresence.refresh();
      void ownLatest.refresh();
      setRationale("");
      onSaved?.();
      if (advance) onNext?.();
    }
  };
  return (
    <>
      <dl className="definition-list">
        <dt>Source run</dt>
        <dd>
          <Link className="table-title" to={"/runs/" + job.runId}>
            {job.runId}
          </Link>
        </dd>
        <dt>Source steps</dt>
        <dd>
          {detail.window.startStep}–{detail.window.endStep}
        </dd>
        <dt>Coverage</dt>
        <dd>
          {detail.window.partial ? "Partial window. " : ""}
          {detail.window.incomplete ? "Incomplete evidence. " : ""}
          {detail.window.status}
        </dd>
        <dt>Frozen definitions</dt>
        <dd>Codebook revision {job.manifest.codebook.revision}</dd>
      </dl>
      <hr className="section-divider" />
      {!predictionsVisible ? (
        <div className="blind-banner">
          <EyeOff size={16} aria-hidden="true" /> Blind initial review. Model
          scores and selection cues remain hidden until you save a judgment.
        </div>
      ) : (
        <div className="actions" style={{ marginBottom: 18 }}>
          {job.manifest.codebook.codes
            .filter((c) => c.enabled && !c.archived)
            .map((code) => (
              <Badge key={code.id}>
                {code.code}:{" "}
                {detail.window.results?.find((r) => r.codeId === code.id)
                  ?.probability == null
                  ? "missing"
                  : (
                      detail.window.results!.find((r) => r.codeId === code.id)!
                        .probability * 100
                    ).toFixed(1) + "%"}
              </Badge>
            ))}
        </div>
      )}
      {detail.window.error && (
        <Notice kind="warning">{detail.window.error}</Notice>
      )}
      <nav className="analysis-review-nav" aria-label="Review sections">
        <a href="#analysis-evidence">Read evidence</a>
        <a href="#analysis-judgment">Jump to judgment</a>
      </nav>
      <div className="analysis-review-layout">
        <section
          id="analysis-evidence"
          tabIndex={-1}
          aria-label="Canonical source evidence"
        >
          <h3>Canonical source events ({detail.window.eventIds.length})</h3>
          <p className="helper">
            Recorded content in source order. Tool requests are proposals until
            their admission and result are recorded. Select citations to support
            your judgment.
          </p>
          {!detail.window.eventIds.length && (
            <p>
              No canonical events in this window.
              {detail.window.incomplete
                ? " Source evidence is incomplete."
                : ""}
            </p>
          )}
          {detail.window.eventIds.map((eventId) => (
            <CanonicalEvent
              key={eventId}
              eventId={eventId}
              runId={job.runId}
              supplied={detail.events?.find((e) => e.id === eventId)}
              selected={list(eventIds).includes(eventId)}
              onToggle={() =>
                setEventIds((previous) =>
                  list(previous).includes(eventId)
                    ? list(previous)
                        .filter((id) => id !== eventId)
                        .join("\n")
                    : [...list(previous), eventId].join("\n"),
                )
              }
              onAnnotate={() => {
                setScope("event");
                setEventIds(eventId);
              }}
            />
          ))}
          <JsonView
            value={detail.window.state}
            title="Exact normalized evidence used for this window"
          />
        </section>
        <section
          id="analysis-judgment"
          tabIndex={-1}
          aria-label="Human judgment"
          className="analysis-judgment"
        >
          <hr className="section-divider" />
          <h3 style={{ marginBottom: 15 }}>Record a human judgment</h3>
          <a className="table-title" href="#analysis-evidence">
            Back to evidence
          </a>
          {mutation.error && (
            <Notice kind="error">{mutation.error.message}</Notice>
          )}
          {mutation.message && (
            <Notice kind="success">{mutation.message}</Notice>
          )}
          <div className="form-grid">
            <Field label="Claimed reviewer identity" required>
              <Input
                value={reviewer}
                onChange={(e) => {
                  setReviewer(e.target.value);
                  localStorage.setItem("sidechannel-reviewer", e.target.value);
                }}
              />
            </Field>
            <Field label="Judgment scope">
              <Select
                value={scope}
                onChange={(e) => setScope(e.target.value as "window" | "event")}
              >
                <option value="window">Whole window</option>
                <option value="event">One source event</option>
              </Select>
            </Field>
            <Field label="Behavior definition">
              <Select
                value={codeId}
                onChange={(e) => setCodeId(e.target.value)}
              >
                {job.manifest.codebook.codes.map((code) => (
                  <option key={code.id} value={code.id}>
                    {code.code}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="full analysis-definition">
              {job.manifest.codebook.codes
                .filter((c) => c.id === codeId)
                .map((code) => (
                  <div key={code.id}>
                    <h4>{code.name || code.code}</h4>
                    <p className="text-block">{code.definition}</p>
                    {[
                      ["Include", code.inclusionCriteria],
                      ["Exclude", code.exclusionCriteria],
                      ["Examples", code.examples],
                      ["Counterexamples", code.counterexamples],
                    ].map(
                      ([label, values]) =>
                        Array.isArray(values) &&
                        values.length > 0 && (
                          <div key={String(label)}>
                            <strong>{String(label)}</strong>
                            <ul>
                              {values.map((value) => (
                                <li key={value}>{value}</li>
                              ))}
                            </ul>
                          </div>
                        ),
                    )}
                  </div>
                ))}
            </div>
            <Field label="Judgment">
              <Select
                value={decision}
                onChange={(e) => setDecision(e.target.value as Decision)}
              >
                {decisions.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </Select>
            </Field>
            <div className="full">
              <strong>Selected citations ({list(eventIds).length})</strong>
              {list(eventIds).map((id) => (
                <div className="actions" key={id}>
                  <a className="table-title" href={`#citation-${id}`}>
                    Source event {detail.window.eventIds.indexOf(id) + 1} - {id}
                  </a>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setEventIds((previous) =>
                        list(previous)
                          .filter((value) => value !== id)
                          .join("\n"),
                      )
                    }
                  >
                    Remove citation
                  </Button>
                </div>
              ))}
            </div>
            <Field label="Rationale / limitations" className="full" required>
              <Textarea
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
              />
            </Field>
            <div className="full actions">
              <Button
                disabled={
                  mutation.busy ||
                  ownLatest.loading ||
                  !!ownLatest.error ||
                  !reviewer.trim() ||
                  !rationale.trim() ||
                  !codeId ||
                  (scope === "event" && list(eventIds).length !== 1)
                }
                onClick={() => save()}
              >
                {latest ? "Append revised judgment" : "Save judgment"}
              </Button>
              {onNext && (
                <Button
                  variant="secondary"
                  disabled={
                    mutation.busy ||
                    ownLatest.loading ||
                    !!ownLatest.error ||
                    !reviewer.trim() ||
                    !rationale.trim() ||
                    !codeId ||
                    (scope === "event" && list(eventIds).length !== 1)
                  }
                  onClick={() => save(true)}
                >
                  Save and next
                </Button>
              )}
              {onReturn && (
                <Button variant="ghost" onClick={onReturn}>
                  Return to queue
                </Button>
              )}
              {onNext && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (
                      !rationale.trim() ||
                      window.confirm(
                        "Keep this item unreviewed and discard this unsaved draft?",
                      )
                    )
                      onNext();
                  }}
                >
                  Skip for now
                </Button>
              )}
              <Badge>
                {predictionsVisible
                  ? "Suggestions visible"
                  : "Suggestions hidden"}
              </Badge>
            </div>
          </div>
          <p className="helper">
            {!reviewer.trim() ? "Enter a claimed reviewer identity. " : ""}
            {!rationale.trim() ? "Add a rationale before saving. " : ""}
            {scope === "event" && list(eventIds).length !== 1
              ? "Select exactly one canonical event for event scope. "
              : ""}
            {ownLatest.error
              ? "Latest revision unavailable; retry loading before saving. "
              : ""}
            {onNext
              ? "Skip for now leaves the item unreviewed; it does not record a judgment."
              : ""}
          </p>
        </section>
      </div>
      <hr className="section-divider" />
      <h3>Review history</h3>
      {!predictionsVisible ? (
        <p className="helper">
          Prior judgments are hidden until your initial judgment is saved.
        </p>
      ) : reviews.error ? (
        <ErrorState error={reviews.error} retry={reviews.refresh} />
      ) : (
        reviews.data
          .filter((r) => r.windowId === detail.window.id)
          .map((review) => (
            <div
              key={review.id}
              style={{
                padding: "13px 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div className="actions">
                <strong>{review.reviewer}</strong>
                <Badge status={review.decision} />
                <span className="helper">
                  {review.scope} · r{review.revision} · {when(review.createdAt)}
                </span>
              </div>
              <p className="text-block">{review.rationale}</p>
              <p className="helper">
                {review.predictionsVisible
                  ? "Suggestions visible"
                  : "Initial judgment blinded"}
                {review.supersedesId
                  ? " · Revises " + short(review.supersedesId)
                  : ""}
              </p>
            </div>
          ))
      )}
      {predictionsVisible && (
        <Pager
          page={reviews.page}
          hasMore={reviews.hasMore}
          onChange={reviews.onChange}
        />
      )}
    </>
  );
}
