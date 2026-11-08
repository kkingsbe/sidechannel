import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge, Button, Card, CardHeading, Empty, ErrorState, Field, Input, Loading, Notice, Pager, Select, Table } from "../../components/ui";
import { useApi, useMutation, usePage } from "../../lib/api";
import { useClients } from "../../lib/clients/context";
import { useClaimedReviewer } from "../../components/claimed-reviewer";
import type { AnalysisJob, Page, ReviewBatch, ReviewSelection } from "../../lib/analysis-types";
import { when } from "../../lib/utils";
import { ValidationStatusBadge } from "../../components/validation-status-badge";
import { ReviewQueueRow } from "./review-queue-row";
import { batchFormProblem, batchRequest, DEFAULT_BINS, describeStrategy, type StrategyChoice } from "./batch-request";
import { useCodeValidation } from "./use-code-validation";

export function ReviewWorkspace({
  job,
  onSelect,
  onQueue,
  reviewVersion = 0,
}: {
  reviewVersion?: number;
  job: AnalysisJob;
  onSelect: (windowId: string) => void;
  onQueue?: (ids: string[]) => void;
}) {
  const [params, setParams] = useSearchParams();
  const batchId = params.get("batch") || "";
  const { reviewer, identifyReviewer } = useClaimedReviewer();
  const [mode, setMode] = useState<"assisted" | "blind">(
    params.get("blind") === "true" ? "blind" : "assisted",
  );
  const [threshold, setThreshold] = useState(0.7);
  const [randomCount, setRandomCount] = useState(10);
  const [seed, setSeed] = useState("pilot-42");
  const [strategy, setStrategy] = useState<StrategyChoice>("flagged-plus-random");
  const [bins, setBins] = useState(DEFAULT_BINS);
  const [perBin, setPerBin] = useState(10);
  const [minGap, setMinGap] = useState(0.5);
  const validation = useCodeValidation(job);
  const form = { mode, threshold, randomSize: randomCount, seed, strategy, bins, perBin, minGap };
  const formProblem = batchFormProblem(form);
  const [queueFilter, setQueueFilter] = useState("all");
  const [batchCursor, setBatchCursor] = useState<string | null>(null);
  const clients = useClients();
  const batches = usePage<ReviewBatch>(
    clients.analyses.paths.batches(job.id),
    { limit: 30 },
  );
  const batch = useApi<{
    batch: ReviewBatch;
    selections: Page<ReviewSelection>;
  }>(
    batchId
      ? clients.analyses.paths.batch(job.id, batchId, {
          limit: 30,
          reviewer,
          filter: queueFilter,
          after: batchCursor ?? undefined,
        })
      : null,
  );
  const refreshBatch = useRef(batch.refresh);
  refreshBatch.current = batch.refresh;
  useEffect(() => {
    if (reviewVersion > 0) void refreshBatch.current();
  }, [reviewVersion]);
  useEffect(() => {
    if (batch.data?.batch.id === batchId) setMode(batch.data.batch.mode);
  }, [batch.data, batchId]);
  useEffect(() => {
    setBatchCursor(null);
  }, [queueFilter, reviewer, batchId]);
  const mutation = useMutation();
  const blind = batchId
    ? batch.data?.batch.id !== batchId || batch.data?.batch.mode === "blind"
    : mode === "blind";
  const create = async () => {
    const result = await mutation.run(() =>
      clients.analyses.createBatch(job.id, { ...batchRequest(form), creator: reviewer }),
    );
    if (result) {
      setParams((prev) => {
        prev.set("batch", result.id);
        prev.set("blind", String(mode === "blind"));
        return prev;
      });
      setBatchCursor(null);
      void batches.refresh();
    }
  };
  const filtered = batch.data?.selections.items ?? [];
  const queueIds = JSON.stringify(filtered.map((item) => item.windowId));
  useEffect(() => {
    onQueue?.(JSON.parse(queueIds) as string[]);
  }, [queueIds, onQueue]);
  const [changingIdentity, setChangingIdentity] = useState(false);
  return (
    <>
      <div className="g12 an-equal">
        <Card className="c8 an-card">
          <CardHeading
            ruled
            title="Durable review selection"
            description="Flagged candidates and random samples share one queue without duplicate tasks."
          />
          <div className="actions" aria-label="Code validation status">
            {job.manifest.codebook.codes
              .filter((code) => code.enabled && !code.archived)
              .map((code) => {
                const status = validation.byCode.get(code.id);
                return (
                  <span key={code.id} className="code-chip">
                    <strong>{code.code}</strong>{" "}
                    {status ? <ValidationStatusBadge validation={status} /> : <Badge>{validation.loading ? "Checking" : "No validation data"}</Badge>}
                  </span>
                );
              })}
          </div>
          <details open={!batchId} className="an-disclosure">
            <summary>Create a new review selection</summary>
            <div className="card-body an-body">
              <div className="well">
                <div className="two">
                  <Field label="Initial review mode">
                    <Select
                      value={mode}
                      onChange={(e) => {
                        const value = e.target.value as "blind" | "assisted";
                        setMode(value);
                        setParams((prev) => {
                          prev.set("blind", String(value === "blind"));
                          return prev;
                        });
                      }}
                    >
                      <option value="assisted">Assisted · predictions visible</option>
                      <option value="blind">Blind · hide predictions until judgment</option>
                    </Select>
                  </Field>
                  {reviewer.trim() && !changingIdentity ? (
                    <div className="field">
                      <div>
                        <label>Reviewer identity</label>
                      </div>
                      <p className="an-identity">
                        Saving as <strong>{reviewer}</strong> ·{" "}
                        <button type="button" className="an-linkbtn" onClick={() => setChangingIdentity(true)}>
                          change
                        </button>
                      </p>
                    </div>
                  ) : (
                    <Field
                      label="Reviewer identity"
                      hint="Self-entered and unverified in this open workspace."
                    >
                      <Input value={reviewer} onChange={(e) => identifyReviewer(e.target.value)} />
                    </Field>
                  )}
                </div>
                <div className="two">
                  <Field
                    label="Selection strategy"
                    hint="Stratified draws labels across the score range; disagreement re-queues windows where a label and the score differ."
                  >
                    <Select value={strategy} onChange={(e) => setStrategy(e.target.value as StrategyChoice)}>
                      <option value="flagged-plus-random">Flagged + random</option>
                      <option value="stratified">Stratified by predicted probability</option>
                      <option value="disagreement">Disagreement between label and score</option>
                    </Select>
                  </Field>
                  <Field label="Sampling seed">
                    <Input value={seed} onChange={(e) => setSeed(e.target.value)} />
                  </Field>
                </div>
                {strategy === "flagged-plus-random" && (
                  <div className="two">
                    <Field label="Flag threshold">
                      <Input
                        type="number"
                        min="0"
                        max="1"
                        step=".05"
                        value={threshold}
                        onChange={(e) => setThreshold(e.target.valueAsNumber)}
                      />
                    </Field>
                    <Field label="Random windows">
                      <Input
                        type="number"
                        min="0"
                        max="1000"
                        value={randomCount}
                        onChange={(e) => setRandomCount(e.target.valueAsNumber)}
                      />
                    </Field>
                  </div>
                )}
                {strategy === "stratified" && (
                  <div className="two">
                    <Field label="Bin edges" hint="Comma-separated, increasing, from 0 to 1.">
                      <Input value={bins} onChange={(e) => setBins(e.target.value)} />
                    </Field>
                    <Field label="Windows per bin" hint="Per code. Short bins are reported after creation.">
                      <Input
                        type="number"
                        min="1"
                        max="1000"
                        value={perBin}
                        onChange={(e) => setPerBin(e.target.valueAsNumber)}
                      />
                    </Field>
                  </div>
                )}
                {strategy === "disagreement" && (
                  <div className="two">
                    <Field label="Minimum gap" hint="Label (present 1, absent 0) against the latest score.">
                      <Input
                        type="number"
                        min="0.05"
                        max="1"
                        step=".05"
                        value={minGap}
                        onChange={(e) => setMinGap(e.target.valueAsNumber)}
                      />
                    </Field>
                  </div>
                )}
                {formProblem && <p className="why">{formProblem}</p>}
                <div className="actions">
                  <Button onClick={create} disabled={mutation.busy || !reviewer.trim() || formProblem !== null}>
                    Create selection batch
                  </Button>
                  {!reviewer.trim() && (
                    <span className="why">Enter a reviewer identity to create a selection batch.</span>
                  )}
                </div>
                {mutation.error && <ErrorState error={mutation.error} />}
              </div>
            </div>
          </details>
          {batchId && (
            <>
              <div className="filter-bar">
                <Field label="Queue filter">
                  <Select
                    value={queueFilter}
                    onChange={(e) => setQueueFilter(e.target.value)}
                  >
                    <option value="all">All selected</option>
                    <option value="unreviewed">Unreviewed</option>
                    <option value="uncertain">Uncertainty</option>
                    <option value="disagreement">Disagreement</option>
                  </Select>
                </Field>
                {batch.data && (
                  <Badge>
                    {batch.data.batch.mode === "blind"
                      ? "Blind batch"
                      : `Threshold ${batch.data.batch.threshold}`}{" "}
                    · {batch.data.batch.populationCount} eligible ·{" "}
                    {batch.data.batch.selectionCount} selected
                  </Badge>
                )}
                {batch.data?.batch.strategy && batch.data.batch.strategy.kind !== "flagged-plus-random" && (
                  <Badge tone="info">{describeStrategy(batch.data.batch.strategy)}</Badge>
                )}
              </div>
              {batch.data?.batch.shortfalls?.length ? (
                <Notice kind="warning">
                  Short bins: {batch.data.batch.shortfalls.map((s) => `${s.codeId} bin ${s.bin + 1} drew ${s.drawn} of ${s.requested}`).join("; ")}.
                </Notice>
              ) : null}
              {batch.loading ? (
                <Loading />
              ) : batch.error ? (
                <ErrorState error={batch.error} retry={batch.refresh} />
              ) : (
                <Table
                  label="Persisted review queue"
                  headers={[
                    "Window and source range",
                    "Review progress",
                    "Sampling provenance",
                    "",
                  ]}
                >
                  {filtered.map((selection, index) => (
                    <ReviewQueueRow
                      key={`${selection.id}-${reviewVersion}`}
                      job={job}
                      selection={selection}
                      index={index}
                      reviewer={reviewer}
                      blind={blind}
                      onSelect={onSelect}
                    />
                  ))}
                </Table>
              )}
              {batch.data?.selections.nextCursor && (
                <div className="card-body">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setBatchCursor(batch.data!.selections.nextCursor)
                    }
                  >
                    Next selections
                  </Button>
                </div>
              )}
            </>
          )}
          <div className="card-foot">
            <span>
              Window and event annotations are provisional research notes. Run-level reference outcomes need
              agreement by two distinct claimed reviewers and are recorded in Oversight.
            </span>
          </div>
        </Card>
        <Card className="c4 an-card">
          <CardHeading title="Saved selection batches" count={batches.data.length || undefined} />
          {!batches.data.length && !batches.loading && (
            <Empty
              title="No selection batches yet"
              description="Create one on the left to queue flagged and randomly sampled windows for review."
            />
          )}
          {batches.data.map((item) => (
            <button
              key={item.id}
              className="list-button"
              onClick={() => {
                setMode(item.mode);
                setParams((prev) => {
                  prev.set("batch", item.id);
                  prev.set("blind", String(item.mode === "blind"));
                  return prev;
                });
                setBatchCursor(null);
              }}
            >
              <div>
                <strong>{when(item.createdAt)}</strong>
                <small>
                  {item.mode} · {item.selectionCount} selected
                </small>
              </div>
            </button>
          ))}
          {(batches.page > 0 || batches.hasMore) && (
            <Pager page={batches.page} hasMore={batches.hasMore} onChange={batches.onChange} />
          )}
        </Card>
      </div>
    </>
  );
}
