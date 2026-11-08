import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button, ErrorState, Field, Input, JsonView, Notice, Pager, Select, Textarea } from "../../components/ui";
import { useApi, useMutation, usePage } from "../../lib/api";
import { useClients } from "../../lib/clients/context";
import { useClaimedReviewer } from "../../components/claimed-reviewer";
import { ReviewHistoryRow } from "../../components/review-history";
import type { AnalysisJob, AnalysisWindow, Decision, HumanReview, Page, WindowDetail } from "../../lib/analysis-types";
import { list, short, when } from "../../lib/utils";
import type { HarnessEvent } from "@sidechannel/contracts/browser";
import { CanonicalEvent, eventKind } from "./canonical-event";
import { scoreOf } from "./analysis-view";
import { BehaviorGrid, BlindPanel, LeadFigure, RunStrip } from "./inspector-scores";
import "./window-inspector.css";

const decisions: { value: Decision; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "uncertain", label: "Uncertain" },
];
type Filter = "all" | "action" | "context";

export function WindowInspector({
  detail,
  job,
  blind,
  onSaved,
  onNext,
  onReturn,
  windows,
  threshold = 0.7,
  initialCodeId,
  onCodeChange,
}: {
  onSaved?: () => void;
  onNext?: () => void;
  onReturn?: () => void;
  detail: WindowDetail;
  job: AnalysisJob;
  blind: boolean;
  /** Every window of the run, for the run strip. */
  windows?: AnalysisWindow[];
  /** The shared 0–1 score threshold. */
  threshold?: number;
  /** The behaviour the reviewer clicked to get here. */
  initialCodeId?: string | null;
  /** Reports a behaviour picked inside the inspector so navigation can carry it. */
  onCodeChange?: (codeId: string) => void;
}) {
  const { reviewer, identifyReviewer } = useClaimedReviewer();
  const clients = useClients();
  const reviews = usePage<HumanReview>(
    clients.analyses.paths.reviews(job.id, { windowId: detail.window.id }),
    { interval: 4000, limit: 30 },
  );
  const allCodes = job.manifest.codebook.codes;
  const activeCodes = allCodes.filter((c) => c.enabled && !c.archived);
  const [scope, setScope] = useState<"window" | "event">("window");
  const [codeId, setCodeId] = useState(
    (initialCodeId && allCodes.some((c) => c.id === initialCodeId) ? initialCodeId : undefined) ||
      activeCodes[0]?.id ||
      "",
  );
  const [decision, setDecision] = useState<Decision>("uncertain");
  const [rationale, setRationale] = useState("");
  const [eventIds, setEventIds] = useState("");
  const [editingReviewer, setEditingReviewer] = useState(() => !reviewer.trim());
  const [filter, setFilter] = useState<Filter>("all");
  const [openEvents, setOpenEvents] = useState<ReadonlySet<string>>(new Set());
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

  const pickCode = (id: string) => {
    setCodeId(id);
    onCodeChange?.(id);
  };
  const selectedCode = allCodes.find((c) => c.id === codeId);
  const cited = list(eventIds);
  const supplied = useMemo(() => new Map((detail.events ?? []).map((e) => [e.id, e])), [detail.events]);
  // Events not supplied with the window are fetched row by row; each row reports back here.
  const [fetched, setFetched] = useState<ReadonlyMap<string, HarnessEvent>>(new Map());
  const remember = (event: HarnessEvent) =>
    setFetched((previous) => (previous.get(event.id) === event ? previous : new Map(previous).set(event.id, event)));
  const eventById = useMemo(() => new Map([...fetched, ...supplied]), [fetched, supplied]);
  const kindOf = (id: string) => {
    const event = eventById.get(id);
    return event ? eventKind(event.type) : "action";
  };
  const counts = useMemo(() => {
    const actions = detail.window.eventIds.filter((id) => {
      const event = eventById.get(id);
      return !event || eventKind(event.type) === "action";
    }).length;
    return { all: detail.window.eventIds.length, action: actions, context: detail.window.eventIds.length - actions };
  }, [detail.window.eventIds, eventById]);
  const shownIds = detail.window.eventIds.filter((id) => filter === "all" || kindOf(id) === filter);
  const allOpen = shownIds.length > 0 && shownIds.every((id) => openEvents.has(id));
  const setOpen = (id: string, open: boolean) =>
    setOpenEvents((previous) => {
      const next = new Set(previous);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  const seqOf = (id: string) => eventById.get(id)?.sequence ?? detail.window.eventIds.indexOf(id) + 1;
  const labelOf = (id: string) => {
    const type = eventById.get(id)?.type;
    if (!type) return "Source event";
    const spaced = type.replaceAll("_", " ");
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  };

  const blocked: string[] = [];
  if (!reviewer.trim()) blocked.push("Enter a claimed reviewer identity.");
  if (!rationale.trim()) blocked.push("Add a rationale before saving.");
  if (scope === "event" && cited.length !== 1) blocked.push("Select exactly one source event for event scope.");
  if (ownLatest.error) blocked.push("Latest revision unavailable; retry loading before saving.");
  const cannotSave =
    mutation.busy || ownLatest.loading || !!ownLatest.error || !reviewer.trim() || !rationale.trim() || !codeId ||
    (scope === "event" && cited.length !== 1);
  const question =
    scope === "window"
      ? `Is ${selectedCode?.code ?? "this behavior"} present in this window?`
      : cited[0]
        ? `Is ${selectedCode?.code ?? "this behavior"} present in event ${seqOf(cited[0])}?`
        : `Is ${selectedCode?.code ?? "this behavior"} present in the selected event?`;
  const saveLabel = latest ? "Append revised judgment" : "Save judgment";
  const priorReviews = reviews.data.filter((r) => r.windowId === detail.window.id);

  return (
    <div className="wi">
      {detail.window.error && <Notice kind="warning">{detail.window.error}</Notice>}
      {!predictionsVisible ? (
        <BlindPanel codes={activeCodes} />
      ) : (
        selectedCode && (
          <>
            <section className="wi-lead" aria-label="Selected behavior">
              <LeadFigure
                code={selectedCode}
                probability={scoreOf(detail.window, selectedCode.id)}
                threshold={threshold}
              />
              <RunStrip
                windows={windows ?? []}
                current={detail.window}
                code={selectedCode}
                threshold={threshold}
              />
            </section>
            <BehaviorGrid
              window={detail.window}
              codes={activeCodes}
              selected={codeId}
              threshold={threshold}
              onPick={pickCode}
            />
          </>
        )
      )}
      <div className="wi-split">
        <section id="analysis-evidence" aria-labelledby="wi-events-h" className="wi-events-col">
          <div className="wi-events-head">
            <h2 id="wi-events-h">Source events</h2>
            <div className="wi-seg" role="group" aria-label="Filter events">
              {(
                [
                  ["all", "All"],
                  ["action", "Actions"],
                  ["context", "Context"],
                ] as [Filter, string][]
              ).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
                  {label} <span className="wi-count">{counts[value]}</span>
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="wi-toggle-all"
              disabled={!shownIds.length}
              onClick={() => setOpenEvents(allOpen ? new Set() : new Set(shownIds))}
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </Button>
          </div>
          <p className="wi-helper">
            In source order. Tool requests are proposals until the harness admits them and records a result.
          </p>
          {!detail.window.eventIds.length && (
            <p>
              No source events in this window.
              {detail.window.incomplete ? " Source evidence is incomplete." : ""}
            </p>
          )}
          {!!detail.window.eventIds.length && !shownIds.length && (
            <p className="wi-helper">No {filter} events in this window.</p>
          )}
          <div className="wi-events">
            {shownIds.map((eventId) => (
              <CanonicalEvent
                key={eventId}
                eventId={eventId}
                runId={job.runId}
                supplied={supplied.get(eventId)}
                onLoaded={remember}
                selected={cited.includes(eventId)}
                onToggle={() =>
                  setEventIds((previous) =>
                    list(previous).includes(eventId)
                      ? list(previous).filter((id) => id !== eventId).join("\n")
                      : [...list(previous), eventId].join("\n"),
                  )
                }
                open={openEvents.has(eventId)}
                onOpenChange={(open) => setOpen(eventId, open)}
                onJudgeOnly={() => {
                  setScope("event");
                  setEventIds(eventId);
                }}
              />
            ))}
          </div>
          <JsonView value={detail.window.state} title="Normalized window state used for scoring" />
        </section>
        <aside id="analysis-judgment" aria-labelledby="wi-judgment-h" className="wi-rail">
          <div className="wi-card">
            <div>
              <h2 id="wi-judgment-h">Your judgment</h2>
              {editingReviewer ? (
                <div className="wi-reviewer-edit">
                  <Field label="Claimed reviewer identity" required>
                    <Input value={reviewer} onChange={(e) => identifyReviewer(e.target.value)} />
                  </Field>
                  {reviewer.trim() && (
                    <Button variant="ghost" size="sm" onClick={() => setEditingReviewer(false)}>
                      Done
                    </Button>
                  )}
                </div>
              ) : (
                <p className="wi-sub">
                  Reviewing as {reviewer.trim()} ·{" "}
                  <button type="button" className="wi-link" onClick={() => setEditingReviewer(true)}>
                    change
                  </button>
                </p>
              )}
            </div>
            {mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}
            {mutation.message && <Notice kind="success">{mutation.message}</Notice>}
            <Field label="Behavior">
              <Select value={codeId} onChange={(e) => pickCode(e.target.value)}>
                {allCodes.map((code) => (
                  <option key={code.id} value={code.id}>
                    {code.code}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="wi-group">
              <span id="wi-scope-l" className="wi-label">
                Scope
              </span>
              <div className="wi-seg wi-seg-fill" role="group" aria-labelledby="wi-scope-l">
                <button type="button" aria-pressed={scope === "window"} onClick={() => setScope("window")}>
                  Whole window
                </button>
                <button type="button" aria-pressed={scope === "event"} onClick={() => setScope("event")}>
                  One event
                </button>
              </div>
            </div>
            <div className="wi-group">
              <span id="wi-decision-l" className="wi-label">
                {question}
              </span>
              <div className="wi-decisions" role="group" aria-labelledby="wi-decision-l">
                {decisions.map((d) => (
                  <button key={d.value} type="button" aria-pressed={decision === d.value} onClick={() => setDecision(d.value)}>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="wi-group">
              <span className="wi-label">
                Citations <span className="wi-count">{cited.length}</span>
              </span>
              {!cited.length && <p className="wi-empty">None yet. Tick an event to cite it.</p>}
              {cited.map((id) => (
                <div className="wi-cite" key={id}>
                  <span className="wi-count">{seqOf(id)}</span>
                  <a href={`#citation-${id}`} title={id}>
                    {labelOf(id)}
                  </a>
                  <button
                    type="button"
                    aria-label={`Remove citation ${seqOf(id)}`}
                    onClick={() => setEventIds((previous) => list(previous).filter((value) => value !== id).join("\n"))}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
            {selectedCode && (
              <details className="wi-def">
                <summary>Definition and criteria</summary>
                <div>
                  <h3>{selectedCode.name || selectedCode.code}</h3>
                  <p>{selectedCode.definition}</p>
                  {(
                    [
                      ["Include", selectedCode.inclusionCriteria],
                      ["Exclude", selectedCode.exclusionCriteria],
                      ["Examples", selectedCode.examples],
                      ["Counterexamples", selectedCode.counterexamples],
                    ] as const
                  ).map(
                    ([label, values]) =>
                      Array.isArray(values) &&
                      values.length > 0 && (
                        <div key={label}>
                          <strong>{label}</strong>
                          <ul>
                            {values.map((value) => (
                              <li key={value}>{value}</li>
                            ))}
                          </ul>
                        </div>
                      ),
                  )}
                </div>
              </details>
            )}
            <Field label="Rationale and limitations" required>
              <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} />
            </Field>
            <div className="wi-actions">
              {onNext ? (
                <>
                  <Button className="wi-wide" disabled={cannotSave} onClick={() => save(true)}>
                    Save and next window
                  </Button>
                  <div className="wi-pair">
                    <Button variant="secondary" disabled={cannotSave} onClick={() => save()}>
                      {latest ? "Append revision" : "Save"}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (
                          !rationale.trim() ||
                          window.confirm("Keep this item unreviewed and discard this unsaved draft?")
                        )
                          onNext();
                      }}
                    >
                      Skip window
                    </Button>
                  </div>
                  {onReturn && (
                    <Button variant="ghost" onClick={onReturn}>
                      Return to queue
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <Button className="wi-wide" disabled={cannotSave} onClick={() => save()}>
                    {saveLabel}
                  </Button>
                  {onReturn && (
                    <Button variant="ghost" onClick={onReturn}>
                      Return to queue
                    </Button>
                  )}
                </>
              )}
              <p className={"wi-helper-line" + (blocked.length ? " blocked" : "")}>
                {blocked.length
                  ? blocked.join(" ")
                  : predictionsVisible
                    ? "Recorded with suggestions visible."
                    : "Recorded as suggestions hidden."}
                {onNext ? " Skip window leaves the item unreviewed; it does not record a judgment." : ""}
              </p>
            </div>
          </div>
          <div className="wi-history">
            <div className="wi-history-head">
              <h3>Earlier judgments</h3>
              {predictionsVisible && !reviews.error && (
                <span>
                  {priorReviews.length} on this window
                </span>
              )}
            </div>
            {!predictionsVisible ? (
              <p className="wi-helper">Prior judgments are hidden until your initial judgment is saved.</p>
            ) : reviews.error ? (
              <ErrorState error={reviews.error} retry={reviews.refresh} />
            ) : (
              priorReviews.map((review) => (
                <ReviewHistoryRow
                  key={review.id}
                  reviewer={review.reviewer}
                  decision={review.decision}
                  meta={
                    <>
                      {review.scope} · r{review.revision} · {when(review.createdAt)}
                    </>
                  }
                  rationale={review.rationale}
                  note={
                    <>
                      {review.predictionsVisible ? "Suggestions visible" : "Initial judgment blinded"}
                      {review.supersedesId ? " · Revises " + short(review.supersedesId) : ""}
                    </>
                  }
                />
              ))
            )}
            {predictionsVisible && (
              <Pager page={reviews.page} hasMore={reviews.hasMore} onChange={reviews.onChange} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
