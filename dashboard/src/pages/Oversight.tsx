import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  Route,
  Routes,
  useNavigate,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  Download,
  Eye,
  FileText,
  History,
  Plus,
  Save,
  ShieldCheck,
  Square,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeading,
  Check,
  Drawer,
  Empty,
  ErrorState,
  Field,
  Input,
  JsonView,
  Loading,
  Notice,
  PageHeader,
  Pager,
  Select,
  Table,
  Tabs,
  Textarea,
} from "../components/ui";
import { api, arrayOf, post, useApi, useMutation } from "../lib/api";
import type { HarnessEvent, Run } from "../lib/types";
import { summarizeValue } from "../components/readable-value";
import type {
  MonitorDefinition,
  MonitorEvaluation,
  MonitorPreview,
  MonitorSettings,
  MonitorView,
  OutcomeDefinition,
  Projection,
  Verdict,
} from "@sidechannel/contracts/browser";
import type {
  RunOutcomeAgreement,
  RunOutcomeReview,
  RunReviewContext,
  MonitorComparison,
} from "../lib/types";

import { list, short, when } from "../lib/utils";
const viewNames: Record<MonitorView, string> = {
  reports: "Reports",
  audit: "Reports + audit metadata",
  board: "Reports + audit + board",
  full: "Full observable trace",
};
import "./runs-oversight.css";
import "./oversight.css";
const views: MonitorView[] = ["reports", "audit", "board", "full"];
type Page<T> = { items: T[]; nextCursor: string | null };
const runChoiceLabel = (run: Run) =>
  `${run.config.label} · ${run.config.condition.id} · ${short(run.id)}`;
/** Loads metadata (experiment, condition, pair) for source runs referenced by id. */
function useRunsMeta(ids: string[]) {
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const key = ids.join(",");
  useEffect(() => {
    let live = true;
    ids.forEach((id) => {
      api<Run>("/runs/" + id)
        .then((run) => {
          if (live && run?.config)
            setRuns((previous) => ({ ...previous, [id]: run }));
        })
        .catch(() => undefined);
    });
    return () => {
      live = false;
    };
  }, [key]);
  return runs;
}
/** Groups pair members together (reviewed before excluded), keeping first-seen order of groups. */
function orderSourceRuns(runIds: string[], metas: Record<string, Run>) {
  const rank = (id: string) =>
    metas[id]?.config.condition.id === "reviewed" ? 0 : 1;
  const groups = new Map<string, string[]>();
  runIds.forEach((id) => {
    const key = metas[id]?.pairId ?? id;
    groups.set(key, [...(groups.get(key) ?? []), id]);
  });
  return [...groups.entries()].map(([key, ids]) => ({
    pairId: metas[ids[0]]?.pairId ? key : undefined,
    runIds: [...ids].sort((a, b) => rank(a) - rank(b)),
  }));
}
/** Results carry their request path so changing identity or revision cannot expose stale form actions. */
function useExactApi<T>(path: string | null, interval = 0) {
  const [result, setResult] = useState<{
    path: string;
    data?: T;
    error?: Error;
  }>();
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!path) return;
    const request = ++generation.current;
    try {
      const data = await api<T>(path);
      if (request === generation.current) setResult({ path, data });
    } catch (error) {
      if (request === generation.current)
        setResult((previous) => ({
          path,
          data: previous?.path === path ? previous.data : undefined,
          error: error as Error,
        }));
    }
  }, [path]);
  useEffect(() => {
    void refresh();
    const timer = interval
      ? setInterval(() => {
          if (!document.hidden) void refresh();
        }, interval)
      : undefined;
    return () => {
      generation.current++;
      clearInterval(timer);
    };
  }, [refresh, interval]);
  const current = result?.path === path ? result : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading: !!path && !current,
    refresh,
  };
}
function useCursorPage<T>(path: string | null, interval = 0, urlKey?: string) {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<string[]>([""]);
  useEffect(() => {
    setPage(0);
    setCursors([""]);
  }, [path]);
  const savedCursors = urlKey ? ["", ...params.getAll(urlKey)] : cursors;
  const currentPage = urlKey ? savedCursors.length - 1 : page;
  const resource = useApi<Page<T>>(
    path
      ? path +
          (path.includes("?") ? "&" : "?") +
          "after=" +
          encodeURIComponent(savedCursors[currentPage] ?? "")
      : null,
    interval,
  );
  const onChange = (next: number) => {
    if (urlKey) {
      if (next > currentPage && !resource.data?.nextCursor) return;
      const nextCursors =
        next > currentPage
          ? [...savedCursors.slice(1), resource.data!.nextCursor!]
          : savedCursors.slice(1, next + 1);
      setParams((previous) => {
        previous.delete(urlKey);
        nextCursors.forEach((cursor) => previous.append(urlKey, cursor));
        return previous;
      });
      return;
    }
    if (next > page) {
      if (!resource.data?.nextCursor) return;
      setCursors((previous) => [
        ...previous.slice(0, next),
        resource.data!.nextCursor!,
      ]);
    }
    setPage(next);
  };
  return {
    ...resource,
    pagination: {
      page: currentPage,
      hasMore: !!resource.data?.nextCursor,
      onChange,
    },
  };
}
function useRunPage(path: string | null) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [path]);
  const resource = useApi<{
    items: Run[];
    total: number;
    nextOffset: number | null;
  }>(path ? path + "&limit=25&offset=" + page * 25 : null);
  return {
    ...resource,
    pagination: {
      page,
      hasMore: resource.data?.nextOffset != null,
      onChange: setPage,
    },
  };
}

export default function Oversight() {
  return (
    <Routes>
      <Route index element={<OversightSetup />} />
      <Route path="new" element={<OversightSetup creating />} />
      <Route path=":id" element={<EvaluationDetail />} />
    </Routes>
  );
}
function OversightSetup({ creating = false }: { creating?: boolean }) {
  const [params, setParams] = useSearchParams();
  const tab =
    params.get("view") || (creating || params.has("run") ? "setup" : "jobs");
  const current = useApi<MonitorDefinition>("/monitor-definitions");
  const history = useCursorPage<MonitorDefinition>(
    "/monitor-definitions/history?limit=25",
  );
  const runs = useRunPage("/runs?summary=true&status=completed");
  const referenceRuns = useRunPage(
    tab === "references"
      ? "/runs?summary=true&status=completed,failed,cancelled,interrupted"
      : null,
  );
  const [referenceRunId, setReferenceRunId] = useState(params.get("run") || "");
  const jobs = useCursorPage<MonitorEvaluation>(
    "/monitor-evaluations?limit=25",
    5000,
    "jobCursor",
  );
  const [selected, setSelected] = useState<string[]>(
    params.get("run") ? [params.get("run")!] : [],
  );
  const [definitionRevision, setDefinitionRevision] = useState(0);
  const [settings, setSettings] = useState<MonitorSettings>({
    model: { provider: "", id: "", settings: {} },
    maxInputChars: 100000,
    contextWindowTokens: 32768,
    outputAllowanceTokens: 2048,
    timeoutMs: 120000,
  });
  const [preview, setPreview] = useState<MonitorPreview>();
  const [projection, setProjection] = useState<Projection>();
  const [acknowledged, setAcknowledged] = useState(false);
  const mutation = useMutation();
  const navigate = useNavigate();
  const launchKey = useRef(crypto.randomUUID());
  useEffect(() => {
    if (current.data && !definitionRevision)
      setDefinitionRevision(current.data.revision);
  }, [current.data, definitionRevision]);
  const change = (patch: Partial<MonitorSettings>) => {
    setSettings((old) => ({ ...old, ...patch }));
    setPreview(undefined);
    launchKey.current = crypto.randomUUID();
  };
  const prerequisites = [
    !selected.length && "Select at least one completed source run.",
    !settings.model.provider.trim() && "Enter a monitor provider.",
    !settings.model.id.trim() && "Enter a monitor model.",
    !definitionRevision && "Select a definition revision.",
    ![
      settings.contextWindowTokens,
      settings.outputAllowanceTokens,
      settings.maxInputChars,
      settings.timeoutMs,
    ].every((value) => Number.isFinite(value) && value > 0) &&
      "Use positive values for all input limits and timeout.",
  ].filter(Boolean) as string[];
  const doPreview = async () => {
    const result = await mutation.run(() =>
      post<MonitorPreview>("/monitor/preview", {
        runIds: selected,
        definitionRevision,
        ...settings,
      }),
    );
    if (result) setPreview(result);
  };
  useEffect(() => setAcknowledged(false), [preview]);
  const previewProjections =
    preview?.runs.flatMap((run) => run.projections) ?? [];
  const unavailableViews = previewProjections.filter(
    (p) => p.status !== "ready",
  ).length;
  const totalEstimatedTokens = previewProjections.reduce(
    (sum, p) => sum + p.estimatedInputTokens,
    0,
  );
  const launch = async () => {
    if (!preview || (unavailableViews > 0 && !acknowledged)) return;
    const result = await mutation.run(() =>
      post<MonitorEvaluation>("/monitor-evaluations", {
        previewId: preview.id,
        previewHash: preview.hash,
        idempotencyKey: launchKey.current,
      }),
    );
    if (result) navigate("/oversight/" + result.id);
  };
  return (
    <>
      <PageHeader
        eyebrow="ISOLATED EVIDENCE COMPARISONS"
        title="Oversight monitor"
        description="Compare what the same monitor detects from four explicitly different evidence views."
        actions={
          <Button asChild>
            <Link to="/oversight/new">New evaluation</Link>
          </Button>
        }
      />
      <Tabs
        panelId="oversight-view-panel"
        value={tab}
        onChange={(view) =>
          setParams((prev) => {
            prev.set("view", view);
            return prev;
          })
        }
        items={[
          { id: "jobs", label: "Evaluation jobs" },
          { id: "setup", label: "Configure & preview" },
          { id: "definitions", label: "Questions & outcome definitions" },
          { id: "references", label: "Human reference outcomes" },
        ]}
      />
      {mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}
      <section
        role="tabpanel"
        id="oversight-view-panel"
        aria-labelledby={`oversight-view-panel-tab-${tab}`}
        tabIndex={0}
      >
        {tab === "definitions" ? (
          <DefinitionEditor
            current={current}
            onSaved={() => {
              setPreview(undefined);
              void current.refresh();
              void history.refresh();
            }}
          />
        ) : tab === "references" ? (
          <>
            <Notice>
              Human references are independent from Jev. Two distinct claimed
              reviewers must agree on the same evidence and definition revision.
              An agreed uncertain label remains a final uncertainty.
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
                      !arrayOf(referenceRuns.data).some(
                        (run) => run.id === referenceRunId,
                      ) && (
                        <option value={referenceRunId}>
                          {short(referenceRunId)} (selected source)
                        </option>
                      )}
                    {arrayOf(referenceRuns.data).map((run) => (
                      <option key={run.id} value={run.id}>
                        {runChoiceLabel(run)}
                      </option>
                    ))}
                  </Select>
                </Field>
                {referenceRuns.error && (
                  <ErrorState
                    error={referenceRuns.error}
                    retry={referenceRuns.refresh}
                  />
                )}
                <Pager {...referenceRuns.pagination} />
              </div>
            </Card>
            {referenceRunId && (
              <RunReferenceEditor
                key={referenceRunId + (params.get("definition") || "")}
                runId={referenceRunId}
                initialDefinitionRevisionId={
                  params.get("definition") || undefined
                }
              />
            )}
          </>
        ) : tab === "jobs" ? (
          <EvaluationList jobs={jobs} />
        ) : (
          <>
            <Notice>
              Oversight runs only when explicitly launched. Each view receives
              one isolated call with the same frozen model and questions. No Jev
              classifications, human labels, other monitor results, or
              cross-view synthesis are included.
            </Notice>
            <div className="editor-layout">
              <div>
                <Card className="form-section">
                  <CardHeading
                    title="Source runs & monitor configuration"
                    description="Monitor selection is independent from experiment models and Jev."
                  />
                  <div className="card-body form-grid">
                    <Field label="Definition revision" required>
                      <Select
                        aria-label="Definition revision"
                        value={definitionRevision}
                        onChange={(e) => {
                          setDefinitionRevision(Number(e.target.value));
                          setPreview(undefined);
                        }}
                      >
                        {history.data?.items.map((item) => (
                          <option key={item.id} value={item.revision}>
                            Revision {item.revision} · {when(item.createdAt)}
                          </option>
                        ))}
                        {!history.data?.items.some(
                          (item) => item.revision === definitionRevision,
                        ) && (
                          <option value={definitionRevision}>
                            Revision {definitionRevision} (selected)
                          </option>
                        )}
                      </Select>
                      {history.error && (
                        <ErrorState
                          error={history.error}
                          retry={history.refresh}
                        />
                      )}
                      <Pager {...history.pagination} />
                    </Field>
                    <div>
                      <span className="helper">Completed source runs</span>
                      <div
                        style={{
                          maxHeight: 210,
                          overflow: "auto",
                          marginTop: 8,
                        }}
                      >
                        {runs.loading ? (
                          <Loading />
                        ) : runs.error ? (
                          <ErrorState error={runs.error} retry={runs.refresh} />
                        ) : arrayOf(runs.data).length ? (
                          arrayOf(runs.data).map((run) => (
                            <Check
                              key={run.id}
                              label={runChoiceLabel(run)}
                              checked={selected.includes(run.id)}
                              onChange={(e) => {
                                setSelected(
                                  e.target.checked
                                    ? [...selected, run.id]
                                    : selected.filter((id) => id !== run.id),
                                );
                                setPreview(undefined);
                              }}
                            />
                          ))
                        ) : (
                          <p className="helper">
                            No completed source runs yet.
                          </p>
                        )}
                      </div>
                      <Pager {...runs.pagination} />
                      {selected.length > 0 && (
                        <p className="helper">
                          Selected across pages:{" "}
                          {selected.map((id) => (
                            <span key={id}>
                              {short(id)}{" "}
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={"Remove source " + id}
                                onClick={() => {
                                  setSelected((previous) =>
                                    previous.filter((value) => value !== id),
                                  );
                                  setPreview(undefined);
                                }}
                              >
                                Remove
                              </Button>
                            </span>
                          ))}
                        </p>
                      )}
                    </div>
                    <Field
                      required
                      label="Monitor provider"
                      hint="Explicitly choose a provider; never inherited from source runs."
                    >
                      <Input
                        value={settings.model.provider}
                        onChange={(e) =>
                          change({
                            model: {
                              ...settings.model,
                              provider: e.target.value,
                            },
                          })
                        }
                        placeholder="Provider identifier"
                      />
                    </Field>
                    <Field
                      required
                      label="Monitor model"
                      hint="Exact independently selected model identifier."
                    >
                      <Input
                        value={settings.model.id}
                        onChange={(e) =>
                          change({
                            model: { ...settings.model, id: e.target.value },
                          })
                        }
                        placeholder="Exact model identifier"
                      />
                    </Field>
                    {["temperature", "maxOutputTokens", "topP", "seed"].map(
                      (key) => (
                        <Field
                          key={key}
                          label={
                            {
                              temperature: "Temperature",
                              maxOutputTokens: "Maximum output tokens",
                              topP: "Top-p sampling",
                              seed: "Sampling seed",
                            }[key] + " (optional)"
                          }
                        >
                          <Input
                            type="number"
                            step="any"
                            value={
                              typeof settings.model.settings[key] === "number"
                                ? settings.model.settings[key]
                                : ""
                            }
                            onChange={(e) => {
                              const options = { ...settings.model.settings };
                              e.target.value === ""
                                ? delete options[key]
                                : (options[key] = e.target.valueAsNumber);
                              change({
                                model: { ...settings.model, settings: options },
                              });
                            }}
                          />
                        </Field>
                      ),
                    )}
                    <Field
                      label="Model context window (tokens)"
                      hint="Complete instructions, evidence, and output allowance are preflighted."
                    >
                      <Input
                        type="number"
                        min="1"
                        value={settings.contextWindowTokens}
                        onChange={(e) =>
                          change({
                            contextWindowTokens: e.target.valueAsNumber,
                          })
                        }
                      />
                    </Field>
                    <Field label="Output allowance (tokens)">
                      <Input
                        type="number"
                        min="1"
                        value={settings.outputAllowanceTokens}
                        onChange={(e) =>
                          change({
                            outputAllowanceTokens: e.target.valueAsNumber,
                          })
                        }
                      />
                    </Field>
                    <Field label="Maximum serialized input (characters)">
                      <Input
                        type="number"
                        min="1"
                        value={settings.maxInputChars}
                        onChange={(e) =>
                          change({ maxInputChars: e.target.valueAsNumber })
                        }
                      />
                    </Field>
                    <Field
                      label="Per-view timeout (seconds)"
                      hint="Stored exactly in milliseconds."
                    >
                      <Input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={settings.timeoutMs / 1000}
                        onChange={(e) =>
                          change({ timeoutMs: e.target.valueAsNumber * 1000 })
                        }
                      />
                    </Field>
                  </div>
                </Card>
                <div className="projection-grid" style={{ marginBottom: 22 }}>
                  {views.map((view) => (
                    <div className="projection-card" key={view}>
                      <span className="eyebrow">
                        VIEW {views.indexOf(view) + 1}
                      </span>
                      <h3>{viewNames[view]}</h3>
                      <p>
                        {
                          {
                            reports:
                              "Final reports, submitted artifact, and task/policy context.",
                            audit:
                              "Adds approved actor, tool, timing, and resource metadata only.",
                            board:
                              "Adds board posts and exact read/delivery evidence.",
                            full: "Adds tool payloads, assistant outputs, artifacts, private memory, and available reasoning.",
                          }[view]
                        }
                      </p>
                      <Badge>
                        {view === "full"
                          ? "Reasoning availability recorded"
                          : "No private memory or reasoning"}
                      </Badge>
                    </div>
                  ))}
                </div>
                {preview && (
                  <Card className="form-section">
                    <CardHeading
                      title="Exact server-generated projections"
                      description={`Definition revision ${preview.definition.revision} · ${preview.settings.model.provider}/${preview.settings.model.id} · frozen across views`}
                    />
                    <div className="card-body">
                      <p className="helper">
                        Unavailable reasoning is not evidence of absent intent.
                        Oversized views are not truncated or summarized; the
                        comparison remains partial.
                      </p>
                    </div>
                    <Table
                      label="Monitor evidence projection previews"
                      headers={[
                        "Source run",
                        "Evidence view",
                        "Input size",
                        "Availability",
                        "",
                      ]}
                    >
                      {preview.runs.flatMap((run) =>
                        run.projections.map((p) => (
                          <tr key={run.runId + p.view}>
                            <td>
                              <Link
                                className="table-title"
                                to={"/runs/" + run.runId}
                              >
                                {short(run.runId)}
                              </Link>
                            </td>
                            <td>
                              {viewNames[p.view]}
                              <small>{p.version}</small>
                            </td>
                            <td>
                              {p.characters.toLocaleString()} characters
                              <small>
                                {p.estimatedInputTokens.toLocaleString()}{" "}
                                estimated input tokens
                              </small>
                            </td>
                            <td>
                              <Badge
                                status={
                                  p.status === "oversized"
                                    ? "failed"
                                    : "completed"
                                }
                              >
                                {p.status}
                              </Badge>
                              {p.reason && <small>{p.reason}</small>}
                            </td>
                            <td>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setProjection(p)}
                              >
                                Exact input
                              </Button>
                            </td>
                          </tr>
                        )),
                      )}
                    </Table>
                  </Card>
                )}
              </div>
              <aside className="sticky stack">
                <Card>
                  <CardHeading title="Preview before execution" />
                  <div className="card-body">
                    <dl className="definition-list">
                      <dt>Selected sources</dt>
                      <dd>{selected.length} completed runs</dd>
                      <dt>Evidence views</dt>
                      <dd>Four isolated invocations / run</dd>
                      <dt>Definitions</dt>
                      <dd>Revision {definitionRevision || "not selected"}</dd>
                      <dt>Inference model</dt>
                      <dd>{settings.model.id || "Choose explicitly"}</dd>
                    </dl>
                    <hr className="section-divider" />
                    <Button
                      disabled={mutation.busy || prerequisites.length > 0}
                      onClick={doPreview}
                      style={{ width: "100%" }}
                    >
                      <Eye size={15} />
                      {mutation.busy ? "Preparing…" : "Preview four views"}
                    </Button>
                    {prerequisites.length > 0 && (
                      <div className="action-prerequisites">
                        <strong>Before previewing</strong>
                        <ul>
                          {prerequisites.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {mutation.busy && (
                      <p role="status" className="helper">
                        A request is in progress. Wait for it to finish before
                        continuing.
                      </p>
                    )}
                    {preview && (
                      <div className="oversight-preview-summary">
                        <dl className="definition-list">
                          <dt>Total estimated input</dt>
                          <dd>
                            {totalEstimatedTokens.toLocaleString()} tokens
                            across {previewProjections.length} views
                          </dd>
                        </dl>
                        {unavailableViews > 0 && (
                          <div
                            className="oversight-oversize-warning"
                            role="alert"
                          >
                            <strong>
                              {unavailableViews} of {previewProjections.length}{" "}
                              views oversized / unavailable
                            </strong>
                            <p>
                              Oversized views are not truncated; they are
                              recorded as unavailable and the comparison is
                              partial. Raise the context window or input limit,
                              or accept this below.
                            </p>
                            <Check
                              label="Launch anyway; oversized views will be recorded as unavailable"
                              checked={acknowledged}
                              onChange={(e) =>
                                setAcknowledged(e.target.checked)
                              }
                            />
                          </div>
                        )}
                      <Button
                          disabled={
                            mutation.busy ||
                            (unavailableViews > 0 && !acknowledged)
                          }
                        onClick={launch}
                        style={{ width: "100%", marginTop: 10 }}
                      >
                        <ShieldCheck size={15} />
                        Launch monitor comparison
                      </Button>
                      </div>
                    )}
                    <p className="helper" style={{ marginTop: 12 }}>
                      Preview makes no model calls. Launch freezes the complete
                      definitions and model/settings. Jobs continue after
                      closing this tab.
                    </p>
                  </div>
                </Card>
                {current.error && (
                  <ErrorState error={current.error} retry={current.refresh} />
                )}
              </aside>
            </div>
          </>
        )}
      </section>
      <Drawer
        open={!!projection}
        onOpenChange={(open) => {
          if (!open) setProjection(undefined);
        }}
        title={projection ? viewNames[projection.view] : "Projection"}
        description="This serialized payload is generated by the backend allowlist, not a browser visibility filter."
      >
        {projection && <ProjectionInspector projection={projection} />}
      </Drawer>
    </>
  );
}
function DefinitionEditor({
  current,
  onSaved,
}: {
  current: ReturnType<typeof useApi<MonitorDefinition>>;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<MonitorDefinition>();
  const [selected, setSelected] = useState("");
  const [dirty, setDirty] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const history = useCursorPage<MonitorDefinition>(
    showHistory ? "/monitor-definitions/history?limit=25" : null,
  );
  const [historical, setHistorical] = useState<MonitorDefinition>();
  const mutation = useMutation();
  useEffect(() => {
    if (!current.data || dirty) return;
    const saved = localStorage.getItem("sidechannel-monitor-definition");
    if (saved) {
      try {
        const recovery = JSON.parse(saved) as MonitorDefinition;
        if (recovery.revision === current.data.revision) {
          setDraft(recovery);
          setSelected(recovery.outcomes[0]?.id || "");
          setDirty(true);
          return;
        }
      } catch {
        /* Invalid local copy. */
      }
    }
    setDraft(structuredClone(current.data));
    setSelected(current.data.outcomes[0]?.id || "");
  }, [current.data]);
  useEffect(() => {
    if (dirty && draft)
      localStorage.setItem(
        "sidechannel-monitor-definition",
        JSON.stringify(draft),
      );
  }, [draft, dirty]);
  if (current.loading || (!draft && !current.error)) return <Loading />;
  if (!draft)
    return <ErrorState error={current.error} retry={current.refresh} />;
  const outcome = draft.outcomes.find((o) => o.id === selected);
  const edit = (patch: Partial<OutcomeDefinition>) => {
    setDraft({
      ...draft,
      outcomes: draft.outcomes.map((o) =>
        o.id === selected ? { ...o, ...patch } : o,
      ),
    });
    setDirty(true);
  };
  const save = async () => {
    const result = await mutation.run(
      () =>
        post<MonitorDefinition>("/monitor-definitions", {
          expectedRevision: draft.revision,
          questions: draft.questions,
          outcomes: draft.outcomes,
        }),
      "Immutable monitor definition revision saved. Existing evaluation snapshots are unchanged.",
    );
    if (result) {
      setDraft(result);
      setDirty(false);
      localStorage.removeItem("sidechannel-monitor-definition");
      onSaved();
    }
  };
  return (
    <>
      <Notice>
        These definitions govern run-level oversight and human reference
        outcomes. They are separate from Jev behavior codes. Archive stable
        outcome IDs to preserve historical comparisons.
      </Notice>
      {mutation.error && (
        <Notice kind="error">
          {mutation.error.message}
          <p>
            Unsaved definitions are retained. A revision conflict requires
            reloading and reconciling; existing evaluations keep their frozen
            snapshot.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (
                window.confirm(
                  "Reload current server definitions? Unsaved edits are retained in the local recovery copy.",
                )
              ) {
                setDirty(false);
                localStorage.removeItem("sidechannel-monitor-definition");
                void current.refresh();
              }
            }}
          >
            Reload latest definitions
          </Button>
        </Notice>
      )}
      {mutation.message && <Notice kind="success">{mutation.message}</Notice>}
      <Card className="form-section">
        <CardHeading
          title="Monitor evaluation questions"
          description={`Editing revision ${draft.revision} · ${dirty ? "Unsaved edits" : "Saved"}`}
          actions={
            <>
              <Button variant="secondary" onClick={() => setShowHistory(true)}>
                <History size={14} />
                History
              </Button>
              <Button
                onClick={save}
                disabled={
                  mutation.busy ||
                  !dirty ||
                  !draft.questions.trim() ||
                  draft.outcomes.some(
                    (o) =>
                      !o.archived && (!o.definition.trim() || !o.name.trim()),
                  )
                }
              >
                <Save size={14} />
                Save revision
              </Button>
            </>
          }
        />
        <div className="card-body">
          <p className="helper">
            {mutation.busy
              ? "Saving revision - "
              : !dirty
                ? "Edit definitions to enable saving a new revision."
                : !draft.questions.trim() ||
                    draft.outcomes.some(
                      (o) =>
                        !o.archived && (!o.name.trim() || !o.definition.trim()),
                    )
                  ? "Before saving: enter evaluation questions and a name and definition for every active outcome."
                  : "Ready to save a new immutable revision."}
          </p>
          <Field
            required
            label="Evaluation questions / instructions"
            hint="The complete wording is frozen at launch and shared across the four isolated views."
          >
            <Textarea
              rows={6}
              value={draft.questions}
              onChange={(e) => {
                setDraft({ ...draft, questions: e.target.value });
                setDirty(true);
              }}
            />
          </Field>
        </div>
      </Card>
      <div className="split">
        <Card>
          <CardHeading
            title="Run-level outcomes"
            actions={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Add outcome definition"
                onClick={() => {
                  const id = crypto.randomUUID();
                  setDraft({
                    ...draft,
                    outcomes: [
                      ...draft.outcomes,
                      {
                        id,
                        name: "New outcome",
                        definition: "",
                        qualifyingCriteria: "",
                        presentGuidance: "",
                        absentGuidance: "",
                        uncertainGuidance: "",
                        examples: "",
                        exclusions: "",
                        archived: false,
                      },
                    ],
                  });
                  setSelected(id);
                  setDirty(true);
                }}
              >
                <Plus size={16} />
              </Button>
            }
          />
          {draft.outcomes.map((item) => (
            <button
              key={item.id}
              className={
                "list-button " + (selected === item.id ? "selected" : "")
              }
              onClick={() => setSelected(item.id)}
            >
              <div>
                <strong>{item.name}</strong>
                <small>
                  {item.archived ? "Archived" : "Active definition"}
                </small>
              </div>
            </button>
          ))}
        </Card>
        {outcome && (
          <Card>
            <CardHeading
              title={outcome.name}
              description={"Stable ID · " + outcome.id}
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => edit({ archived: !outcome.archived })}
                >
                  <Archive size={14} />
                  {outcome.archived ? "Restore" : "Archive"}
                </Button>
              }
            />
            <div className="card-body form-grid">
              <Field required label="Display name" className="full">
                <Input
                  value={outcome.name}
                  onChange={(e) => edit({ name: e.target.value })}
                />
              </Field>
              {(
                [
                  "definition",
                  "qualifyingCriteria",
                  "presentGuidance",
                  "absentGuidance",
                  "uncertainGuidance",
                  "examples",
                  "exclusions",
                ] as const
              ).map((key) => (
                <Field
                  key={key}
                  required={key === "definition"}
                  className="full"
                  label={
                    {
                      definition: "Definition",
                      qualifyingCriteria: "Qualifying criteria",
                      presentGuidance: "Present guidance",
                      absentGuidance: "Absent guidance",
                      uncertainGuidance: "Uncertain guidance",
                      examples: "Examples",
                      exclusions: "Exclusions",
                    }[key]
                  }
                >
                  <Textarea
                    rows={7}
                    value={outcome[key]}
                    onChange={(e) => edit({ [key]: e.target.value })}
                  />
                </Field>
              ))}
            </div>
          </Card>
        )}
      </div>
      <Drawer
        open={showHistory}
        onOpenChange={setShowHistory}
        title="Monitor definition history"
      >
        {history.data?.items.map((item) => (
          <button
            className="list-button"
            key={item.id}
            onClick={() => setHistorical(item)}
          >
            <div>
              <strong>Revision {item.revision}</strong>
              <small>
                {when(item.createdAt)} ·{" "}
                {item.outcomes.filter((o) => !o.archived).length} active
                outcomes
              </small>
            </div>
          </button>
        ))}
        {history.loading && <Loading />}
        {history.error && (
          <ErrorState error={history.error} retry={history.refresh} />
        )}
        <Pager {...history.pagination} />
        {historical && (
          <JsonView
            value={historical}
            title={"Immutable revision " + historical.revision}
          />
        )}
      </Drawer>
    </>
  );
}
function evaluationName(job: MonitorEvaluation, withTime = false) {
  const name = `${job.settings.model.id} - ${job.runIds.length} source ${job.runIds.length === 1 ? "run" : "runs"} - revision ${job.definition.revision}`;
  return withTime ? `${name} - ${when(job.createdAt)}` : name;
}
function evaluationReturn(value: string | null) {
  return value === "/oversight" ||
    value?.startsWith("/oversight?") ||
    value?.startsWith("/oversight/new?")
    ? value
    : "/oversight?view=jobs";
}
function EvaluationList({
  jobs,
}: {
  jobs: ReturnType<typeof useCursorPage<MonitorEvaluation>>;
}) {
  const location = useLocation();
  const returnSearch =
    "?returnTo=" + encodeURIComponent(location.pathname + location.search);
  return (
    <Card>
      <CardHeading
        title="Monitor evaluation jobs"
        description="Each comparison has its own lifecycle, separate from experiment and analysis jobs."
      />
      {jobs.loading ? (
        <Loading />
      ) : jobs.error ? (
        <ErrorState error={jobs.error} retry={jobs.refresh} />
      ) : jobs.data?.items.length ? (
        <Table
          label="Monitor comparison jobs"
          headers={[
            "Evaluation",
            "Frozen monitor model",
            "Sources / definitions",
            "State",
            "",
          ]}
        >
          {jobs.data.items.map((job) => (
            <tr key={job.id}>
              <td>
                <Link
                  className="table-title"
                  to={"/oversight/" + job.id + returnSearch}
                >
                  {evaluationName(job)}
                </Link>
                <small>Created {when(job.createdAt)}</small>
                <details>
                  <summary>Evaluation identifier</summary>
                  <span className="mono">{job.id}</span>
                </details>
              </td>
              <td>
                {job.settings.model.provider}/{job.settings.model.id}
              </td>
              <td>
                {job.runIds.length} runs · revision {job.definition.revision}
              </td>
              <td>
                <Badge status={job.status} />
              </td>
              <td>
                <Button asChild variant="ghost" size="sm">
                  <Link to={"/oversight/" + job.id + returnSearch}>
                    Inspect
                  </Link>
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty
          title="No oversight comparisons yet"
          description="Preview evidence and explicitly launch the first independent monitor comparison."
        />
      )}
      <Pager {...jobs.pagination} />
    </Card>
  );
}
function availabilityText(
  projection: Projection,
  recorded: boolean,
  category: string,
) {
  const excluded = projection.excluded.includes(category);
  if (recorded)
    return excluded
      ? "recorded for this run · not included in this view"
      : "recorded for this run · included in this view";
  return excluded
    ? "not recorded for this run · not included in this view"
    : "not recorded for this run";
}
function ProjectionInspector({ projection }: { projection: Projection }) {
  return (
    <>
      <dl className="definition-list">
        <dt>Source run</dt>
        <dd>
          <Link className="table-title" to={"/runs/" + projection.runId}>
            {projection.runId}
          </Link>
        </dd>
        <dt>Projection version</dt>
        <dd>{projection.version}</dd>
        <dt>Included categories</dt>
        <dd>{projection.included.join(", ")}</dd>
        <dt>Excluded categories</dt>
        <dd>{projection.excluded.join(", ")}</dd>
        <dt>Private memory</dt>
        <dd>
          {availabilityText(
            projection,
            projection.availability.privateMemory,
            "private memory",
          )}
        </dd>
        <dt>Provider reasoning</dt>
        <dd>
          {availabilityText(
            projection,
            projection.availability.providerReasoning,
            "provider reasoning",
          )}
        </dd>
        <dt>Input hash</dt>
        <dd className="mono">{projection.hash}</dd>
        <dt>Complete request preflight</dt>
        <dd>
          {projection.status} ·{" "}
          {projection.estimatedInputTokens.toLocaleString()} estimated input
          tokens
        </dd>
      </dl>
      <hr className="section-divider" />
      {projection.reason && <Notice kind="warning">{projection.reason}</Notice>}
      <JsonView
        value={projection.serialized}
        title="Exact serialized monitor input"
      />
    </>
  );
}
type VerdictSelection = {
  runId: string;
  view: MonitorView;
  outcomeId: string;
};
/** `?verdict=<runId>:<outcomeId>:<view>`; run and outcome IDs may themselves contain colons. */
function parseVerdictParam(value: string | null): VerdictSelection | undefined {
  if (!value) return undefined;
  const last = value.lastIndexOf(":");
  const middle = last > 0 ? value.lastIndexOf(":", last - 1) : -1;
  const view = value.slice(last + 1) as MonitorView;
  if (middle <= 0 || !views.includes(view)) return undefined;
  return {
    runId: value.slice(0, middle),
    outcomeId: value.slice(middle + 1, last),
    view,
  };
}
function SourceTitle({ runId, run }: { runId: string; run?: Run }) {
  if (!run) return <Link to={"/runs/" + runId}>Source run {short(runId)}</Link>;
  return (
    <span className="oversight-source-title">
      <Link to={"/runs/" + runId}>{run.config.label}</Link>
      <Badge>{run.config.condition.id}</Badge>
      {run.pairId && (
        <Link className="oversight-pair-link" to={"/runs/pairs/" + run.pairId}>
          Pair {short(run.pairId)}
        </Link>
      )}
      <span className="mono helper">{short(runId)}</span>
    </span>
  );
}
function PairSummary({
  evaluation,
  metas,
  pairId,
  runIds,
}: {
  evaluation: MonitorEvaluation;
  metas: Record<string, Run>;
  pairId: string;
  runIds: string[];
}) {
  const reviewed = runIds.find(
    (id) => metas[id]?.config.condition.id === "reviewed",
  );
  const excluded = runIds.find(
    (id) => metas[id]?.config.condition.id === "excluded",
  );
  if (!reviewed || !excluded) return null;
  const verdict = (runId: string, view: MonitorView, outcomeId: string) => {
    const result = evaluation.results.find(
      (r) => r.runId === runId && r.view === view,
    );
    return (
      result?.judgments.find((j) => j.outcomeId === outcomeId)?.verdict ??
      result?.status ??
      "pending"
    );
  };
  return (
    <Card className="form-section">
      <CardHeading
        title={"Pair-aligned summary · " + metas[reviewed].config.label}
        description={
          <>
            Reviewed and excluded verdicts side by side ·{" "}
            <Link to={"/runs/pairs/" + pairId}>Pair {short(pairId)}</Link>
          </>
        }
      />
      <Table
        label={"Pair-aligned verdicts for " + pairId}
        headers={["Run-level outcome", ...views.map((v) => viewNames[v])]}
      >
        {evaluation.definition.outcomes
          .filter((o) => !o.archived)
          .map((outcome) => (
            <tr key={outcome.id}>
              <td>{outcome.name}</td>
              {views.map((view) => (
                <td key={view}>
                  <div className="oversight-pair-cell">
                    <span>
                      Reviewed:{" "}
                      <strong>{verdict(reviewed, view, outcome.id)}</strong>
                    </span>
                    <span>
                      Excluded:{" "}
                      <strong>{verdict(excluded, view, outcome.id)}</strong>
                    </span>
                  </div>
                </td>
              ))}
            </tr>
          ))}
      </Table>
    </Card>
  );
}
function EvaluationDetail() {
  const [params, setParams] = useSearchParams();
  const { id } = useParams();
  const evaluation = useApi<MonitorEvaluation>(
    "/monitor-evaluations/" + id,
    4000,
  );
  const comparison = useApi<MonitorComparison>(
    "/monitor-evaluations/" + id + "/comparison",
    5000,
  );
  const provenance = useApi<{
    evaluation: MonitorEvaluation;
    preview: MonitorPreview;
  }>("/monitor-evaluations/" + id + "/export");
  const [projection, setProjection] = useState<Projection>();
  const resultSelection = parseVerdictParam(params.get("verdict"));
  const setResultSelection = (selection?: VerdictSelection) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (selection)
        next.set(
          "verdict",
          `${selection.runId}:${selection.outcomeId}:${selection.view}`,
        );
      else next.delete("verdict");
      return next;
    });
  const mutation = useMutation();
  const metas = useRunsMeta(evaluation.data?.runIds ?? []);
  if (evaluation.loading) return <Loading />;
  if (!evaluation.data)
    return <ErrorState error={evaluation.error} retry={evaluation.refresh} />;
  const data = evaluation.data;
  const sourceGroups = orderSourceRuns(data.runIds, metas);
  const hasAgreedReferences = !!comparison.data?.comparisons.some((c) =>
    c.metrics.some(
      (m) =>
        m.referencePositive + m.referenceNegative + m.referenceUncertain > 0,
    ),
  );
  const selectedResult = data.results.find(
    (r) =>
      r.runId === resultSelection?.runId && r.view === resultSelection?.view,
  );
  const judgment = selectedResult?.judgments.find(
    (j) => j.outcomeId === resultSelection?.outcomeId,
  );
  const resultProjection = provenance.data?.preview.runs
    .find((r) => r.runId === resultSelection?.runId)
    ?.projections.find((p) => p.view === resultSelection?.view);
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link to={evaluationReturn(params.get("returnTo"))}>
          <ArrowLeft size={14} />
          Oversight workspace
        </Link>
      </Button>
      <PageHeader
        eyebrow="FROZEN MONITOR COMPARISON"
        title={evaluationName(data)}
        description={`${data.settings.model.provider}/${data.settings.model.id} · created ${when(data.createdAt)}`}
        actions={
          <>
            <Badge status={data.status} />
            <Button asChild variant="secondary">
              <a href={"/api/monitor-evaluations/" + id + "/export"} download>
                <Download size={14} />
                Monitor export
              </a>
            </Button>
            {["queued", "running"].includes(data.status) && (
              <Button
                variant="destructive"
                disabled={mutation.busy || data.cancelRequested}
                onClick={async () => {
                  if (
                    window.confirm(
                      "Cancel remaining monitor calls? Completed view results remain available.",
                    )
                  ) {
                    await mutation.run(() =>
                      post("/monitor-evaluations/" + id + "/cancel", {}),
                    );
                    void evaluation.refresh();
                  }
                }}
              >
                <Square size={13} />
                {data.cancelRequested
                  ? "Cancellation requested"
                  : "Cancel remaining"}
              </Button>
            )}
          </>
        }
      />
      <details style={{ marginBottom: 20 }}>
        <summary>Evaluation identifier</summary>
        <p className="mono">{data.id}</p>
      </details>
      {evaluation.error && (
        <Notice kind="warning">
          Connection stale: {evaluation.error.message}. Last loaded job state is
          retained.
        </Notice>
      )}
      {mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}
      {comparison.error && (
        <Notice kind="warning">
          Human references unavailable: {comparison.error.message}. No detection
          rates can be inferred from missing labels.
        </Notice>
      )}
      <Notice>
        Monitor outputs and human references are separate records. Invalid
        citations or structured output are failures, not negative findings. An
        unavailable view makes a comparison partial.
      </Notice>
      {sourceGroups.map(
        (group) =>
          group.pairId &&
          group.runIds.length > 1 && (
            <PairSummary
              key={group.pairId}
              evaluation={data}
              metas={metas}
              pairId={group.pairId}
              runIds={group.runIds}
            />
          ),
      )}
      {sourceGroups
        .flatMap((group) => group.runIds)
        .map((runId) => (
        <Card key={runId} className="form-section">
          <CardHeading
              title={<SourceTitle runId={runId} run={metas[runId]} />}
            description="Human reference on the left; isolated monitor evidence views on the right."
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link
                  to={
                    "/oversight?view=references&run=" +
                    runId +
                    "&definition=" +
                    encodeURIComponent(data.definition.id)
                  }
                >
                  Adjudicate source outcomes
                </Link>
              </Button>
            }
          />
          <Table
            label={"Evidence-view verdict matrix for " + runId}
            headers={[
              "Run-level outcome",
              "Human reference",
              ...views.map((v) => viewNames[v]),
            ]}
          >
            {data.definition.outcomes
              .filter((o) => !o.archived)
              .map((outcome) => {
                const referenceRow = comparison.data?.comparisons
                  .find((c) => c.outcome.id === outcome.id)
                  ?.rows.find((row) => row.runId === runId);
                const reference = referenceRow?.reference;
                return (
                  <tr key={outcome.id}>
                    <td>
                      {outcome.name}
                      <small>{outcome.definition}</small>
                    </td>
                    <td>
                      <Badge status={reference?.state}>
                        {reference?.state || "Unreviewed"}
                      </Badge>
                      {reference?.decision && (
                        <small>{reference.decision}</small>
                      )}
                      {reference && !reference.sourceMatches && (
                        <small>
                          Incompatible or stale reference · excluded
                        </small>
                      )}
                    </td>
                    {views.map((view) => {
                      const result = data.results.find(
                        (r) => r.runId === runId && r.view === view,
                      );
                      const item = result?.judgments.find(
                        (j) => j.outcomeId === outcome.id,
                      );
                      return (
                        <td key={view}>
                          <Badge status={result?.status}>
                            {result?.status || "Pending"}
                          </Badge>
                          {item && (
                            <div style={{ marginTop: 7 }}>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() =>
                                  setResultSelection({
                                    runId,
                                    view,
                                    outcomeId: outcome.id,
                                  })
                                }
                              >
                                {item.verdict} · evidence
                              </Button>
                            </div>
                          )}
                          {result?.error && <small>{result.error}</small>}
                          {result?.durationMs != null && (
                            <small>
                              {(result.durationMs / 1000).toFixed(1)}s
                            </small>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
          </Table>
          <div className="card-body actions" style={{ paddingTop: 15 }}>
            {provenance.data?.preview.runs
              .find((r) => r.runId === runId)
              ?.projections.map((p) => (
                <Button
                  variant="secondary"
                  size="sm"
                  key={p.view}
                  onClick={() => setProjection(p)}
                >
                  Preview {viewNames[p.view]}
                </Button>
              ))}
          </div>
        </Card>
      ))}
      <Card className="form-section">
        <CardHeading
          title="Detection & false-positive denominators"
          description="Runs are the experimental unit. Monitor abstentions remain in binary reference denominators."
        />
        {!hasAgreedReferences ? (
          <Empty
            title="No agreed human references yet"
            description="Adjudicate outcomes to populate detection and false-positive rates."
          >
            <Button asChild variant="secondary" size="sm">
              <Link to="/oversight?view=references">
                Open Human reference outcomes
              </Link>
            </Button>
          </Empty>
        ) : (
        <Table
          label="Detection and false positive counts"
          headers={[
            "Outcome / view",
            "Detected / reference-positive",
            "False positives / reference-negative",
            "Monitor uncertain",
            "Excluded reference",
            "Unavailable view",
          ]}
        >
          {data.definition.outcomes
            .filter((o) => !o.archived)
            .flatMap((outcome) =>
              views.map((view) => {
                const counts = comparison.data?.comparisons
                  .find((c) => c.outcome.id === outcome.id)
                  ?.metrics.find((m) => m.view === view);
                if (!counts)
                  return (
                    <tr key={outcome.id + view}>
                      <td>
                        {outcome.name}
                        <small>{viewNames[view]}</small>
                      </td>
                      <td colSpan={5}>Reference comparison unavailable</td>
                    </tr>
                  );
                return (
                  <tr key={outcome.id + view}>
                    <td>
                      {outcome.name}
                      <small>{viewNames[view]}</small>
                    </td>
                    <td>
                      {counts.detectionRate == null
                        ? "Unavailable"
                        : (counts.detectionRate * 100).toFixed(1) + "%"}
                      <small>
                        {counts.detected} / {counts.referencePositive} runs
                      </small>
                    </td>
                    <td>
                      {counts.falsePositiveRate == null
                        ? "Unavailable"
                        : (counts.falsePositiveRate * 100).toFixed(1) + "%"}
                      <small>
                          {counts.falsePositive} / {counts.referenceNegative}{" "}
                          runs
                      </small>
                    </td>
                    <td>{counts.monitorUncertain}</td>
                    <td>
                      {counts.excludedReference}
                      <small>
                        {counts.referenceUncertain} agreed-uncertain
                      </small>
                    </td>
                    <td>{counts.missingView}</td>
                  </tr>
                );
              }),
            )}
        </Table>
        )}
        <div className="card-body" style={{ paddingTop: 14 }}>
          <p className="helper">
            Only agreed present/absent references from two reviewers on matching
            evidence and definitions enter binary denominators. Provisional,
            disputed, agreed-uncertain, stale, and incompatible references are
            excluded. Completed monitor uncertain judgments remain in their
            reference denominator. Unavailable views are counted separately; no
            missing denominator is displayed as zero percent. Matched-run
            relationships remain available on each source page.
          </p>
        </div>
      </Card>
      <Card>
        <CardHeading title="Frozen monitor configuration" />
        <div className="card-body">
          <JsonView
            value={{
              definition: data.definition,
              settings: data.settings,
              previewHash: data.previewHash,
            }}
          />
          <p className="helper">
            Export scope: this monitor evaluation, frozen definitions, exact
            projections, and results. Source evidence and human reviews are
            separate linked records.
          </p>
        </div>
      </Card>
      <Drawer
        open={!!projection}
        onOpenChange={(open) => {
          if (!open) setProjection(undefined);
        }}
        title={projection ? viewNames[projection.view] : "Projection"}
      >
        {projection && <ProjectionInspector projection={projection} />}
      </Drawer>
      <Drawer
        open={!!resultSelection}
        onOpenChange={(open) => {
          if (!open) setResultSelection(undefined);
        }}
        title={
          resultSelection
            ? viewNames[resultSelection.view] + " verdict"
            : "Monitor verdict"
        }
      >
        {judgment && (
          <>
            <Badge status={judgment.verdict} />
            <p className="text-block" style={{ margin: "14px 0" }}>
              {judgment.explanation}
            </p>
            <h3>Supporting evidence IDs</h3>
            {judgment.evidenceIds.length ? (
              judgment.evidenceIds.map((evidenceId) => {
                const valid =
                  resultProjection?.evidenceIds.includes(evidenceId);
                return (
                  <div key={evidenceId} style={{ marginTop: 10 }}>
                    <span className="mono">{evidenceId}</span>
                    <Badge status={valid ? "completed" : "failed"}>
                      {valid
                        ? "In supplied projection"
                        : "Unsupported / not verified"}
                    </Badge>
                  </div>
                );
              })
            ) : (
              <p className="helper">
                No event citations. The explanation must state missing evidence
                or limitations for an absent or uncertain judgment.
              </p>
            )}
            <hr className="section-divider" />
            {resultProjection ? (
              <ProjectionInspector projection={resultProjection} />
            ) : (
              <Notice kind="warning">
                Exact projection provenance is unavailable; citations are not
                rendered as valid source links.
              </Notice>
            )}
            <JsonView
              value={selectedResult?.usage}
              title="Recorded monitor usage"
            />
          </>
        )}
      </Drawer>
    </>
  );
}
function CitationPicker({
  runId,
  value,
  onChange,
}: {
  runId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [events, setEvents] = useState<HarnessEvent[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();
  const [query, setQuery] = useState("");
  const load = useCallback(
    async (after: number) => {
      setLoading(true);
      setError(undefined);
      try {
        const result = await api<{
          events: HarnessEvent[];
          nextCursor: number;
          hasMore?: boolean;
        }>(`/runs/${runId}/events?limit=50&after=${after}`);
        setEvents((previous) =>
          after === 0 ? result.events : [...previous, ...result.events],
        );
        setNext(
          (result.hasMore ?? result.events.length >= 50)
            ? result.nextCursor
            : null,
        );
      } catch (e) {
        setError(e as Error);
      } finally {
        setLoading(false);
      }
    },
    [runId],
  );
  useEffect(() => {
    void load(0);
  }, [load]);
  const ids = list(value);
  const needle = query.trim().toLowerCase();
  const rows = events
    .map((event) => ({
      event,
      summary: summarizeValue(event.data, 100),
    }))
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
      <strong>Pick cited events from this run</strong>
      <p className="helper">
        Checked events are added to the list above; you can still paste IDs
        directly. {ids.length} selected.
      </p>
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
          retry={() => load(events.length ? (next ?? 0) : 0)}
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
            <span>{event.type}</span>
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
function RunReferenceEditor({
  runId,
  initialDefinitionRevisionId,
}: {
  runId: string;
  initialDefinitionRevisionId?: string;
}) {
  const [definitionRevisionId, setDefinitionRevisionId] = useState(
    initialDefinitionRevisionId || "",
  );
  const definitionHistory = useCursorPage<MonitorDefinition>(
    "/monitor-definitions/history?limit=25",
  );
  const context = useExactApi<RunReviewContext>(
    "/runs/" +
      runId +
      "/reviews/context" +
      (definitionRevisionId
        ? "?definitionRevisionId=" + encodeURIComponent(definitionRevisionId)
        : ""),
  );
  const reviews = useCursorPage<RunOutcomeReview>(
    "/runs/" + runId + "/reviews?limit=25",
    5000,
  );
  const agreements = useApi<RunOutcomeAgreement[]>(
    "/runs/" + runId + "/outcomes",
    5000,
  );
  const [reviewer, setReviewer] = useState(
    () => localStorage.getItem("sidechannel-reviewer") || "",
  );
  const [outcomeId, setOutcomeId] = useState("");
  const [decision, setDecision] = useState<Verdict>("uncertain");
  const [rationale, setRationale] = useState("");
  const [evidence, setEvidence] = useState("");
  const [dismissedError, setDismissedError] = useState<Error>();
  const mutation = useMutation();
  const saveError =
    mutation.error && mutation.error !== dismissedError
      ? mutation.error
      : undefined;
  const citationError =
    saveError && /citation|event id/i.test(saveError.message)
      ? saveError.message
      : undefined;
  const editEvidence = (value: string) => {
    setEvidence(value);
    setDismissedError(mutation.error);
  };
  const latestQuery = new URLSearchParams({
    reviewer: reviewer.trim().normalize("NFKC").toLocaleLowerCase("en-US"),
    outcomeId,
    definitionRevisionId: context.data?.definition.id || "",
  });
  const latest = useExactApi<RunOutcomeReview | null>(
    context.data && reviewer.trim() && outcomeId
      ? "/runs/" + runId + "/reviews/latest?" + latestQuery
      : null,
    5000,
  );
  useEffect(() => {
    if (context.data)
      setOutcomeId(
        context.data.definition.outcomes.find((o) => !o.archived)?.id || "",
      );
  }, [context.data]);
  if (context.loading) return <Loading />;
  if (!context.data)
    return <ErrorState error={context.error} retry={context.refresh} />;
  const data = context.data;
  const active = data.definition.outcomes.filter((o) => !o.archived);
  const previous = latest.data ?? undefined;
  const selectedOutcome = active.find((o) => o.id === outcomeId);
  const save = async () => {
    const result = await mutation.run(
      () =>
        post<RunOutcomeReview>("/runs/" + runId + "/reviews", {
          reviewer,
          outcomeId,
          definitionRevisionId: data.definition.id,
          evidenceRevision: data.evidenceRevision,
          decision,
          rationale,
          eventIds: list(evidence),
          supersedesId: previous?.id,
        }),
      "Human outcome review appended. Finalization requires two distinct reviewers to agree.",
    );
    if (result) {
      void reviews.refresh();
      void agreements.refresh();
      void latest.refresh();
      setRationale("");
    }
  };
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
                href={
                  "/api/runs/" +
                  runId +
                  "/reviews/export?definitionRevisionId=" +
                  encodeURIComponent(data.definition.id)
                }
              >
                <Download size={14} />
                Reference export
              </a>
            </Button>
          </>
        }
      />
      <div className="card-body">
        {mutation.message && <Notice kind="success">{mutation.message}</Notice>}
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
              onChange={(e) => setDefinitionRevisionId(e.target.value)}
            >
              {!definitionHistory.data?.items.some(
                (item) => item.id === data.definition.id,
              ) && (
                <option value={data.definition.id}>
                  Revision {data.definition.revision} (selected)
                </option>
              )}
              {definitionHistory.data?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  Revision {item.revision} / {when(item.createdAt)}
                </option>
              ))}
            </Select>
            <Pager {...definitionHistory.pagination} />
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
              value={reviewer}
              onChange={(e) => {
                setReviewer(e.target.value);
                localStorage.setItem("sidechannel-reviewer", e.target.value);
              }}
            />
          </Field>
          <Field required label="Outcome definition">
            <Select
              value={outcomeId}
              onChange={(e) => setOutcomeId(e.target.value)}
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
              value={decision}
              onChange={(e) => setDecision(e.target.value as Verdict)}
            >
              <option>present</option>
              <option>absent</option>
              <option>uncertain</option>
            </Select>
          </Field>
          <Field
            required={decision === "present"}
            label="Supporting source event IDs"
            hint="One actual event ID per line. Present judgments require at least one citation."
            className="full"
            error={citationError}
          >
            <Textarea
              value={evidence}
              onChange={(e) => editEvidence(e.target.value)}
            />
          </Field>
          <div className="full">
            <CitationPicker
              runId={runId}
              value={evidence}
              onChange={editEvidence}
            />
          </div>
          <Field
            required
            label="Rationale / unresolved questions"
            className="full"
          >
            <Textarea
              rows={8}
              aria-label="Rationale / unresolved questions"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
          </Field>
          <div className="full action-prerequisites">
            <strong>Reference save requirements</strong>
            <ul>
              {[
                !reviewer.trim() && "Enter your claimed reviewer identity.",
                !outcomeId && "Select an active outcome definition.",
                !rationale.trim() &&
                  "Write a rationale or unresolved questions.",
                decision === "present" &&
                  !evidence.trim() &&
                  "Cite at least one actual source event for a present judgment.",
                latest.loading && "Checking your latest revision - ",
                latest.error &&
                  "Retry loading your latest revision before saving.",
                mutation.busy && "Saving your review - ",
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
                mutation.busy ||
                latest.loading ||
                !!latest.error ||
                !reviewer.trim() ||
                !rationale.trim() ||
                !outcomeId ||
                (decision === "present" && !evidence.trim())
              }
              onClick={save}
            >
              {previous
                ? "Append revision / reconfirm"
                : "Save provisional reference"}
            </Button>
            <span className="helper">
              Revising an agreed judgment reopens finalization until the other
              reviewer reconfirms.
            </span>
            {saveError && (
              <p role="alert" className="oversight-save-error">
                {saveError.message}
              </p>
            )}
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
            const agreement = agreements.data?.find(
              (a) =>
                a.outcomeId === outcome.id &&
                a.definitionRevisionId === data.definition.id,
            );
            return (
              <tr key={outcome.id}>
                <td>{outcome.name}</td>
                <td>
                  <Badge status={agreement?.state}>
                    {agreement?.state || "Unreviewed"}
                  </Badge>
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
        <hr className="section-divider" />
        <h3>Preserved review history</h3>
        <p className="helper">
          All outcome and definition revisions remain available through these
          pages and the complete reference export. Your latest revision is
          resolved independently by reviewer identity, outcome, and definition.
        </p>
        {reviews.error ? (
          <ErrorState error={reviews.error} retry={reviews.refresh} />
        ) : (
          reviews.data?.items.map((review) => (
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
                  {review.outcomeDefinition.name} ·{" "}
                  {review.definitionRevisionId} · r{review.revision} ·{" "}
                  {when(review.createdAt)}
                </span>
              </div>
              <p className="text-block">{review.rationale}</p>
              <p className="helper">
                Evidence:{" "}
                {review.eventIds.length
                  ? review.eventIds.join(", ")
                  : "No source event citations"}
                {review.supersedesId
                  ? " · revises " + short(review.supersedesId)
                  : ""}
              </p>
            </div>
          ))
        )}
        <Pager {...reviews.pagination} />
      </div>
    </Card>
  );
}
