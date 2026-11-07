import { useEffect, useState } from "react";
import {
  Link,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  Copy,
  Download,
  Eye,
  EyeOff,
  GitCompare,
  Play,
  RefreshCw,
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
import { useCursorApi, useOffsetApi } from "../lib/paging";
import { list, pretty, short, when } from "../lib/utils";
import type { Run } from "../lib/types";
import type {
  AnalysisJob,
  AnalysisPreview,
  AnalysisSettings,
  AnalysisWindow,
  BehaviorCode,
  Codebook,
  CodebookRevision,
  Decision,
  EvidenceCategory,
  HumanReview,
  Page,
  ReviewBatch,
  ReviewSelection,
  WindowDetail,
} from "../lib/analysis-types";
const categories: EvidenceCategory[] = [
  "assistant",
  "tools",
  "board",
  "artifacts",
  "memory",
  "reasoning",
  "reports",
];
const decisions: Decision[] = ["present", "absent", "uncertain"];
export default function Analysis() {
  return (
    <Routes>
      <Route index element={<AnalysisSetup />} />
      <Route path=":id" element={<AnalysisDetail />} />
    </Routes>
  );
}
function AnalysisSetup() {
  const [params, setParams] = useSearchParams();
  const runId = params.get("run") || "";
  const clone = params.get("clone");
  const runs = useOffsetApi<Run>("/runs?summary=true", 50);
  const source = useApi<Run>(runId ? "/runs/" + runId : null);
  const books = useCursorApi<Codebook>("/codebooks");
  const cloned = useApi<AnalysisJob>(clone ? "/analyses/" + clone : null);
  const jobs = useCursorApi<AnalysisJob>(
    runId ? "/runs/" + runId + "/analyses" : null,
    30,
    5000,
  );
  const [settings, setSettings] = useState<AnalysisSettings>({
    codebookId: "",
    codebookRevisionId: "",
    model: "jev-1.14.0",
    windowSize: 12,
    stride: 4,
    phases: ["action", "report"],
    evidence: [...categories],
    headroom: 2000,
    timeoutMs: 60000,
    maxAttempts: 2,
    creator: localStorage.getItem("sidechannel-reviewer") || "",
  });
  const revision = useApi<{ codebook: Codebook; revision: CodebookRevision }>(
    settings.codebookId ? "/codebooks/" + settings.codebookId : null,
  );
  const revisionHistory = useCursorApi<CodebookRevision>(
    settings.codebookId
      ? "/codebooks/" + settings.codebookId + "/revisions"
      : null,
  );
  const [preview, setPreview] = useState<AnalysisPreview>();
  const [previewWindow, setPreviewWindow] = useState<
    AnalysisPreview["windows"][number] & { state?: string }
  >();
  const mutation = useMutation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!settings.codebookId && books.data?.items[0])
      setSettings((old) => ({
        ...old,
        codebookId: books.data!.items[0].id,
        codebookRevisionId: books.data!.items[0].currentRevisionId,
      }));
  }, [books.data, settings.codebookId]);
  useEffect(() => {
    if (cloned.data) {
      setSettings({
        ...cloned.data.manifest.settings,
        parentAnalysisId: cloned.data.id,
      });
      if (!runId)
        setParams((prev) => {
          prev.set("run", cloned.data!.runId);
          return prev;
        });
    }
  }, [cloned.data]);
  const change = (patch: Partial<AnalysisSettings>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
    setPreview(undefined);
  };
  const launch = async () => {
    if (!preview) return;
    const result = await mutation.run(() =>
      post<AnalysisJob>("/runs/" + runId + "/analyses", {
        ...settings,
        previewToken: preview.previewToken,
      }),
    );
    if (result) navigate("/analysis/" + result.id);
  };
  const doPreview = async () => {
    const result = await mutation.run(() =>
      post<AnalysisPreview>("/runs/" + runId + "/analyses/preview", settings),
    );
    if (result) setPreview(result);
  };
  const currentRevision =
    revisionHistory.data?.items.find(
      (r) => r.id === settings.codebookRevisionId,
    ) ?? revision.data?.revision;
  return (
    <>
      <PageHeader
        eyebrow="JEV · WINDOW-LEVEL SCREENING"
        title="Trace analysis"
        description="Estimate behaviors in overlapping source windows, then inspect the actual evidence."
      />
      {mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}
      <Notice>
        Jev estimates support researcher exploration. They are never delivered
        to agents or oversight monitors, and do not establish run-level
        outcomes.
      </Notice>
      <div className="editor-layout">
        <div>
          <Card className="form-section">
            <CardHeading title="Source & frozen definitions" />
            <div className="card-body form-grid">
              <div>
                <Field
                  label="Source run"
                  hint="Only terminal runs can be analyzed."
                >
                  <Select
                    value={runId}
                    onChange={(e) => {
                      setParams((prev) => {
                        prev.set("run", e.target.value);
                        return prev;
                      });
                      setPreview(undefined);
                    }}
                  >
                    <option value="">Select a source run</option>
                    {runId &&
                      !runs.data?.items.some((run) => run.id === runId) && (
                        <option value={runId}>
                          {source.data?.config.label || runId} · selected source
                        </option>
                      )}
                    {arrayOf(runs.data).map((run) => (
                      <option key={run.id} value={run.id}>
                        {run.config.label} · {run.status} · {short(run.id)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Pager {...runs.pagination} />
              </div>
              <div>
                <Field label="Codebook">
                  <Select
                    value={settings.codebookId}
                    onChange={(e) => {
                      const book = books.data?.items.find(
                        (b) => b.id === e.target.value,
                      );
                      change({
                        codebookId: e.target.value,
                        codebookRevisionId: book?.currentRevisionId || "",
                      });
                    }}
                  >
                    <option value="">Select codebook</option>
                    {settings.codebookId &&
                      !books.data?.items.some(
                        (book) => book.id === settings.codebookId,
                      ) && (
                        <option value={settings.codebookId}>
                          {revision.data?.codebook.name || "Selected codebook"}
                        </option>
                      )}
                    {books.data?.items.map((book) => (
                      <option key={book.id} value={book.id}>
                        {book.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Pager {...books.pagination} />
              </div>
              <div>
                <Field
                  label="Codebook revision"
                  hint="Historical definitions remain read-only. New analyses use the current codebook revision."
                >
                  <Select
                    value={settings.codebookRevisionId}
                    onChange={(e) =>
                      change({ codebookRevisionId: e.target.value })
                    }
                  >
                    {revision.data &&
                      !revisionHistory.data?.items.some(
                        (item) => item.id === revision.data?.revision.id,
                      ) && (
                        <option value={revision.data.revision.id}>
                          Current revision {revision.data.revision.revision}
                        </option>
                      )}
                    {revisionHistory.data?.items.map((item) => (
                      <option
                        key={item.id}
                        value={item.id}
                        disabled={item.id !== revision.data?.revision.id}
                      >
                        Revision {item.revision} · {when(item.createdAt)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Pager {...revisionHistory.pagination} />
              </div>
              <Field
                label="Researcher / creator"
                hint="Claimed identity in the open workspace."
              >
                <Input
                  value={settings.creator}
                  onChange={(e) => change({ creator: e.target.value })}
                />
              </Field>
              {currentRevision && (
                <div className="full actions">
                  {currentRevision.codes
                    .filter((c) => c.enabled && !c.archived)
                    .map((code) => (
                      <Badge key={code.id}>{code.code}</Badge>
                    ))}
                </div>
              )}
              {source.data && (
                <div className="helper full">
                  Source {source.data.status} ·{" "}
                  {source.data.config.model.provider}/
                  {source.data.config.model.id} · config{" "}
                  {short(source.data.configHash)}. Missing evidence is recorded
                  separately from excluded categories.
                </div>
              )}
              {(runs.error || books.error || source.error) && (
                <div className="full">
                  <ErrorState
                    error={runs.error || books.error || source.error}
                  />
                </div>
              )}
            </div>
          </Card>
          <Card className="form-section">
            <CardHeading
              title="Windowing & evidence"
              description="Boundaries stay fixed. Oversized windows remain visible with missing scores."
            />
            <div className="card-body form-grid three">
              <Field label="Window size (classification steps)">
                <Input
                  type="number"
                  min="1"
                  max="1000"
                  value={settings.windowSize}
                  onChange={(e) =>
                    change({ windowSize: e.target.valueAsNumber })
                  }
                />
              </Field>
              <Field
                label="Stride (classification steps)"
                hint={`Derived overlap: ${Math.max(0, settings.windowSize - settings.stride)} steps`}
              >
                <Input
                  type="number"
                  min="1"
                  value={settings.stride}
                  onChange={(e) => change({ stride: e.target.valueAsNumber })}
                />
              </Field>
              <Field
                label="Jev model"
                hint="Pinned default; change explicitly for a new analysis."
              >
                <Input
                  value={settings.model}
                  onChange={(e) => change({ model: e.target.value })}
                />
              </Field>
              <Field label="First source step (optional)">
                <Input
                  type="number"
                  min="1"
                  value={settings.startStep ?? ""}
                  onChange={(e) =>
                    change({
                      startStep: e.target.value
                        ? e.target.valueAsNumber
                        : undefined,
                    })
                  }
                />
              </Field>
              <Field label="Last source step (optional)">
                <Input
                  type="number"
                  min="1"
                  value={settings.endStep ?? ""}
                  onChange={(e) =>
                    change({
                      endStep: e.target.value
                        ? e.target.valueAsNumber
                        : undefined,
                    })
                  }
                />
              </Field>
              <Field label="Provider input headroom">
                <Input
                  type="number"
                  min="0"
                  value={settings.headroom}
                  onChange={(e) => change({ headroom: e.target.valueAsNumber })}
                />
              </Field>
              <div className="full actions">
                {(["action", "report"] as const).map((phase) => (
                  <Check
                    key={phase}
                    label={phase === "action" ? "Action phase" : "Report phase"}
                    checked={settings.phases.includes(phase)}
                    onChange={(e) =>
                      change({
                        phases: e.target.checked
                          ? [...settings.phases, phase]
                          : settings.phases.filter((p) => p !== phase),
                      })
                    }
                  />
                ))}
              </div>
              <div className="full">
                <h3>Provider-visible evidence</h3>
                <p className="helper" style={{ margin: "4px 0 12px" }}>
                  These switches select inference inputs. Timeline visibility
                  filters have no effect on this selection.
                </p>
                <div className="form-grid three">
                  {categories.map((category) => (
                    <Check
                      key={category}
                      label={
                        {
                          assistant: "Assistant outputs",
                          tools: "Tool arguments & results",
                          board: "Board & exact deliveries",
                          artifacts: "Artifact history",
                          memory: "Private working memory",
                          reasoning: "Available provider reasoning",
                          reports: "Individual final reports",
                        }[category]
                      }
                      checked={settings.evidence.includes(category)}
                      onChange={(e) =>
                        change({
                          evidence: e.target.checked
                            ? [...settings.evidence, category]
                            : settings.evidence.filter((c) => c !== category),
                        })
                      }
                    />
                  ))}
                </div>
              </div>
              <div className="full">
                <div
                  className="window-preview"
                  aria-label="Illustration of source steps and stride"
                >
                  {Array.from(
                    {
                      length: Math.min(
                        24,
                        Math.max(1, settings.windowSize + settings.stride * 2),
                      ),
                    },
                    (_, i) => (
                      <span key={i}>{i + 1}</span>
                    ),
                  )}
                </div>
                <p className="helper" style={{ marginTop: 8 }}>
                  Illustration: windows of {settings.windowSize} steps advance{" "}
                  {settings.stride} steps. A classification step is different
                  from an admitted tool-call budget unit.
                </p>
              </div>
              <Field label="Request timeout (ms)">
                <Input
                  type="number"
                  min="1"
                  value={settings.timeoutMs}
                  onChange={(e) =>
                    change({ timeoutMs: e.target.valueAsNumber })
                  }
                />
              </Field>
              <Field label="Maximum attempts">
                <Input
                  type="number"
                  min="1"
                  max="5"
                  value={settings.maxAttempts}
                  onChange={(e) =>
                    change({ maxAttempts: e.target.valueAsNumber })
                  }
                />
              </Field>
            </div>
          </Card>
          {preview && (
            <Card className="form-section">
              <CardHeading
                title="Prepared windows"
                description="Inspect the unchanged boundaries and request budget before launching."
              />
              <div className="card-body">
                <div className="data-grid">
                  <div className="data-point">
                    <span>Source steps</span>
                    <strong>{preview.manifest.selectedStepCount}</strong>
                  </div>
                  <div className="data-point">
                    <span>Windows</span>
                    <strong>{preview.manifest.windowCount}</strong>
                  </div>
                  <div className="data-point">
                    <span>Partial windows</span>
                    <strong>{preview.manifest.partialWindowCount}</strong>
                  </div>
                  <div className="data-point">
                    <span>Enabled behaviors</span>
                    <strong>{preview.manifest.scoredCodeCount}</strong>
                  </div>
                </div>
                <div className="actions" style={{ margin: "16px 0" }}>
                  {categories.map((c) => (
                    <Badge key={c}>
                      {c}: {preview.manifest.availability[c] ?? "unavailable"}
                    </Badge>
                  ))}
                </div>
                {preview.manifest.diagnostics.map((d) => (
                  <Notice kind="warning" key={d}>
                    {d}
                  </Notice>
                ))}
              </div>
              <Table
                label="Prepared analysis windows"
                headers={["Window", "Range", "Coverage", "Input budget", ""]}
              >
                {preview.windows.map((window) => (
                  <tr key={window.id}>
                    <td>W{window.index + 1}</td>
                    <td>
                      {window.startStep}–{window.endStep}
                    </td>
                    <td>
                      <Badge>
                        {window.partial
                          ? "Partial"
                          : window.incomplete
                            ? "Incomplete"
                            : "Complete boundaries"}
                      </Badge>
                    </td>
                    <td>
                      {window.budget.estimatedTokens.toLocaleString()} estimated
                      tokens
                      <br />
                      <Badge status={window.budget.oversized ? "failed" : ""}>
                        {window.budget.oversized
                          ? "Oversized · no score"
                          : window.budget.batches.length + " tag batches"}
                      </Badge>
                    </td>
                    <td>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setPreviewWindow(window)}
                      >
                        Exact input
                      </Button>
                    </td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
          {runId && (
            <Card>
              <CardHeading
                title="Saved analyses of this run"
                description="Each settings change creates a separate reproducible result."
              />
              {jobs.loading ? (
                <Loading />
              ) : jobs.error ? (
                <ErrorState error={jobs.error} retry={jobs.refresh} />
              ) : jobs.data?.items.length ? (
                <Table
                  label="Source analysis jobs"
                  headers={[
                    "Analysis",
                    "Model / windows",
                    "State",
                    "Created",
                    "",
                  ]}
                >
                  {jobs.data.items.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <Link
                          className="table-title"
                          to={"/analysis/" + job.id}
                        >
                          {short(job.id)}
                        </Link>
                      </td>
                      <td>
                        {job.manifest.settings.model} ·{" "}
                        {job.manifest.settings.windowSize}/
                        {job.manifest.settings.stride}
                      </td>
                      <td>
                        <Badge status={job.status} />
                      </td>
                      <td>{when(job.createdAt)}</td>
                      <td>
                        <Button asChild variant="ghost" size="sm">
                          <Link to={"/analysis/" + job.id}>Open</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty title="No analyses of this source run yet" />
              )}
              <Pager {...jobs.pagination} />
            </Card>
          )}
        </div>
        <aside className="stack sticky">
          <Card>
            <CardHeading title="Preview & launch" />
            <div className="card-body">
              <dl className="definition-list">
                <dt>Worker</dt>
                <dd>Independent analysis worker</dd>
                <dt>Code revision</dt>
                <dd>{currentRevision?.revision ?? "Not selected"}</dd>
                <dt>Model</dt>
                <dd>{settings.model}</dd>
                <dt>Overlap</dt>
                <dd>
                  {Math.max(0, settings.windowSize - settings.stride)} steps
                </dd>
                <dt>Request volume</dt>
                <dd>
                  {preview
                    ? preview.windows.reduce(
                        (n, w) =>
                          n +
                          (w.budget.oversized ? 0 : w.budget.batches.length),
                        0,
                      ) + " estimated requests"
                    : "Preview required"}
                </dd>
              </dl>
              <hr className="section-divider" />
              <Button
                onClick={doPreview}
                disabled={
                  mutation.busy ||
                  !runId ||
                  !settings.codebookRevisionId ||
                  !settings.creator.trim() ||
                  settings.windowSize < 1 ||
                  settings.stride < 1 ||
                  !settings.evidence.length ||
                  !settings.phases.length
                }
                style={{ width: "100%" }}
              >
                <Eye size={15} />
                {mutation.busy ? "Preparing…" : "Preview analysis"}
              </Button>
              {preview && (
                <Button
                  onClick={launch}
                  disabled={mutation.busy}
                  style={{ width: "100%", marginTop: 10 }}
                >
                  <Play size={14} />
                  Launch analysis job
                </Button>
              )}
              <p className="helper" style={{ marginTop: 12 }}>
                Estimates are not a guaranteed bill. No automatic truncation,
                shrinking, or splitting. You can leave after launch; the worker
                continues.
              </p>
            </div>
          </Card>
          {!books.data?.items.length && !books.loading && (
            <Notice>
              Start by creating a{" "}
              <Link className="table-title" to="/codebook">
                research codebook
              </Link>
              .
            </Notice>
          )}
        </aside>
      </div>
      <Drawer
        open={!!previewWindow}
        onOpenChange={(open) => {
          if (!open) setPreviewWindow(undefined);
        }}
        title={
          previewWindow
            ? `Preview window ${previewWindow.index + 1}`
            : "Preview window"
        }
      >
        {previewWindow && (
          <>
            <dl className="definition-list">
              <dt>Source range</dt>
              <dd>
                {previewWindow.startStep}–{previewWindow.endStep}
              </dd>
              <dt>Input hash / budget</dt>
              <dd>
                {previewWindow.budget.bytes.toLocaleString()} bytes ·{" "}
                {previewWindow.budget.estimatedTokens.toLocaleString()}{" "}
                estimated tokens
              </dd>
            </dl>
            {previewWindow.budget.oversized && (
              <Notice kind="warning">
                {previewWindow.budget.reason ||
                  "This fixed window exceeds the provider budget and will have missing scores."}
              </Notice>
            )}
            {previewWindow.state ? (
              <JsonView
                value={previewWindow.state}
                title="Exact serialized evidence"
              />
            ) : (
              <PreviewWindowInput
                token={preview?.previewToken}
                windowId={previewWindow.id}
              />
            )}
          </>
        )}
      </Drawer>
    </>
  );
}
function PreviewWindowInput({
  token,
  windowId,
}: {
  token?: string;
  windowId: string;
}) {
  const state = useApi<{ state: string }>(
    token
      ? "/analysis-previews/" +
          encodeURIComponent(token) +
          "/windows/" +
          windowId
      : null,
  );
  return state.loading ? (
    <Loading />
  ) : state.data ? (
    <JsonView value={state.data.state} title="Exact serialized evidence" />
  ) : (
    <Notice kind="warning">
      Exact preview evidence is unavailable from this API version. The window
      boundaries and budgeting are shown above. {state.error?.message}
    </Notice>
  );
}
function AnalysisDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get("view") || "probability";
  const windowId = params.get("window");
  const job = useApi<AnalysisJob>("/analyses/" + id, 4000);
  const [page, setPage] = useState(0),
    [cursors, setCursors] = useState<(string | null)[]>([null]);
  const windows = useApi<Page<AnalysisWindow>>(
    "/analyses/" +
      id +
      "/windows?limit=30" +
      (cursors[page] ? "&after=" + encodeURIComponent(cursors[page]!) : ""),
    6000,
  );
  const detail = useApi<WindowDetail>(
    windowId ? "/analyses/" + id + "/windows/" + windowId : null,
  );
  const persistedBatch = useApi<{ batch: ReviewBatch }>(
    params.get("batch")
      ? `/analyses/${id}/review-batches/${params.get("batch")}?limit=1`
      : null,
  );
  const [threshold, setThreshold] = useState(0.7);
  const [visible, setVisible] = useState<string[]>();
  const mutation = useMutation();
  const [compareId, setCompareId] = useState(params.get("compare") || "");
  const comparison = useApi<AnalysisJob>(
    compareId ? "/analyses/" + compareId : null,
  );
  const otherWindows = useApi<Page<AnalysisWindow>>(
    compareId ? "/analyses/" + compareId + "/windows?limit=30" : null,
  );
  const sourceJobs = useCursorApi<AnalysisJob>(
    job.data ? "/runs/" + job.data.runId + "/analyses" : null,
  );
  if (job.loading) return <Loading />;
  if (!job.data) return <ErrorState error={job.error} retry={job.refresh} />;
  const data = job.data;
  const codes = data.manifest.codebook.codes.filter(
    (c) => c.enabled && !c.archived,
  );
  const shown = codes.filter((c) => !visible || visible.includes(c.id));
  const current = windows.data?.items ?? [];
  const openWindow = (window: AnalysisWindow) =>
    setParams((prev) => {
      prev.set("window", window.id);
      return prev;
    });
  const setTab = (view: string) =>
    setParams((prev) => {
      prev.set("view", view);
      return prev;
    });
  const active = ["queued", "preparing", "running"].includes(data.status);
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link to={"/analysis?run=" + data.runId}>
          <ArrowLeft size={14} />
          Source analysis workspace
        </Link>
      </Button>
      <PageHeader
        eyebrow="FROZEN ANALYSIS JOB"
        title={"Analysis " + short(data.id)}
        description={`Source run ${data.runId} · ${data.manifest.settings.model}`}
        actions={
          <>
            <Badge status={data.status} />
            <Button asChild variant="secondary">
              <Link to={"/analysis?run=" + data.runId + "&clone=" + data.id}>
                <Copy size={14} />
                Duplicate settings
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <a href={"/api/jev/analyses/" + id + "/export"} download>
                <Download size={14} />
                Full analysis export
              </a>
            </Button>
            {active && (
              <Button
                variant="destructive"
                disabled={mutation.busy || data.cancelRequested}
                onClick={async () => {
                  if (
                    window.confirm(
                      "Cancel remaining analysis work? Successful scores and their evidence remain saved.",
                    )
                  ) {
                    await mutation.run(() =>
                      post("/analyses/" + id + "/cancel", {}),
                    );
                    void job.refresh();
                  }
                }}
              >
                <Square size={13} />
                {data.cancelRequested ? "Cancellation requested" : "Cancel"}
              </Button>
            )}
            {["partial", "failed", "cancelled"].includes(data.status) && (
              <Button
                variant="secondary"
                disabled={mutation.busy}
                onClick={async () => {
                  await mutation.run(
                    () => post("/analyses/" + id + "/retry", {}),
                    "Retry requested for missing results.",
                  );
                  void job.refresh();
                }}
              >
                <RefreshCw size={14} />
                Retry missing
              </Button>
            )}
          </>
        }
      />
      <div className="run-metadata">
        <Link className="table-title" to={"/runs/" + data.runId}>
          Open source run
        </Link>
        <span>
          Codebook <strong>revision {data.manifest.codebook.revision}</strong>
        </span>
        <span>
          Window / stride{" "}
          <strong>
            {data.manifest.settings.windowSize} /{" "}
            {data.manifest.settings.stride}
          </strong>
        </span>
        <span>
          Source boundary <strong>#{data.manifest.sequenceBoundary}</strong>
        </span>
        <span>
          Prepared <strong>{data.counters.prepared}</strong> · finished{" "}
          <strong>{data.counters.finished}</strong> · failed{" "}
          <strong>{data.counters.failed}</strong>
        </span>
      </div>
      {(job.error || windows.error) && (
        <Notice kind="warning">
          Connection stale: {(job.error || windows.error)?.message}. Saved
          results stay available.
        </Notice>
      )}
      {data.error && <Notice kind="error">{data.error}</Notice>}
      {mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}
      {mutation.message && <Notice kind="success">{mutation.message}</Notice>}
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: "probability", label: "Probability timeline" },
          { id: "heatmap", label: "Heatmap" },
          { id: "table", label: "Accessible scores" },
          { id: "review", label: "Human review" },
          { id: "compare", label: "Compare analyses" },
          { id: "provenance", label: "Provenance & exports" },
        ]}
      />
      {["probability", "heatmap", "table"].includes(tab) ? (
        <>
          <Notice>
            Estimated probability the behavior occurs in this window. Values are
            exploratory estimates, not calibrated accuracy or run-level
            reference labels. Missing results are gaps, never zero.
          </Notice>
          <Card>
            <div className="filter-bar">
              <Field label="Highlight threshold (display only)">
                <Input
                  type="number"
                  min="0"
                  max="1"
                  step=".05"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.valueAsNumber)}
                />
              </Field>
              <div className="actions" style={{ flex: 1 }}>
                {codes.map((code) => (
                  <Check
                    key={code.id}
                    label={code.code}
                    checked={!visible || visible.includes(code.id)}
                    onChange={(e) =>
                      setVisible(
                        e.target.checked
                          ? [...(visible ?? codes.map((c) => c.id)), code.id]
                          : (visible ?? codes.map((c) => c.id)).filter(
                              (id) => id !== code.id,
                            ),
                      )
                    }
                  />
                ))}
              </div>
            </div>
            {windows.loading ? (
              <Loading />
            ) : !current.length ? (
              <Empty
                title="Windows are being prepared"
                description="The worker persists progress; this page can be closed safely."
              />
            ) : tab === "probability" ? (
              <div className="card-body" style={{ paddingTop: 20 }}>
                <p className="helper" style={{ marginBottom: 14 }}>
                  Points sit at window ends. Segments connect overlapping-window
                  estimates; they do not measure an instantaneous signal.
                </p>
                {shown.map((code) => (
                  <ProbabilityPlot
                    key={code.id}
                    code={code}
                    windows={current}
                    onSelect={openWindow}
                  />
                ))}
              </div>
            ) : tab === "heatmap" ? (
              <div className="card-body" style={{ paddingTop: 20 }}>
                <div className="heatmap">
                  <table aria-label="Behavior probability heatmap">
                    <thead>
                      <tr>
                        <th>Behavior</th>
                        {current.map((w) => (
                          <th key={w.id}>
                            {w.startStep}–{w.endStep}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((code) => (
                        <tr key={code.id}>
                          <th scope="row">{code.code}</th>
                          {current.map((w) => {
                            const score = w.results?.find(
                              (r) => r.codeId === code.id,
                            )?.probability;
                            return (
                              <td key={w.id}>
                                <button
                                  className={
                                    "heat-cell " +
                                    (score == null
                                      ? "missing"
                                      : score >= threshold
                                        ? "high"
                                        : "medium")
                                  }
                                  title={`${code.code}, steps ${w.startStep}–${w.endStep}: ${score == null ? w.error || w.status : (score * 100).toFixed(1) + "%"}`}
                                  onClick={() => openWindow(w)}
                                >
                                  {score == null
                                    ? "—"
                                    : Math.round(score * 100) + "%"}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <ScoreTable
                windows={current}
                codes={shown}
                onSelect={openWindow}
              />
            )}
            <Pager
              page={page}
              hasMore={!!windows.data?.nextCursor}
              onChange={(next) => {
                if (next > page)
                  setCursors((prev) => [
                    ...prev.slice(0, next),
                    windows.data?.nextCursor ?? null,
                  ]);
                setPage(next);
              }}
            />
          </Card>
        </>
      ) : tab === "review" ? (
        <ReviewWorkspace
          job={data}
          onSelect={(window) =>
            setParams((prev) => {
              prev.set("window", window);
              return prev;
            })
          }
        />
      ) : tab === "compare" ? (
        <Card>
          <CardHeading
            title="Compare two analyses of the same source"
            description="Actual source-step grids remain separate. Values are never interpolated."
          />
          <div className="card-body">
            <Field label="Comparison analysis">
              <Select
                value={compareId}
                onChange={(e) => {
                  setCompareId(e.target.value);
                  setParams((prev) => {
                    prev.set("compare", e.target.value);
                    return prev;
                  });
                }}
              >
                <option value="">Choose another saved analysis</option>
                {sourceJobs.data?.items
                  .filter((j) => j.id !== data.id)
                  .map((j) => (
                    <option key={j.id} value={j.id}>
                      {short(j.id)} · {j.manifest.settings.model} ·{" "}
                      {j.manifest.settings.windowSize}/
                      {j.manifest.settings.stride}
                    </option>
                  ))}
              </Select>
            </Field>
            <Pager {...sourceJobs.pagination} />
            {comparison.data && (
              <>
                <hr className="section-divider" />
                {comparison.data.runId !== data.runId ||
                comparison.data.manifest.evidenceHash !==
                  data.manifest.evidenceHash ||
                comparison.data.manifest.configHash !==
                  data.manifest.configHash ? (
                  <Notice kind="error">
                    These analyses have different source runs, configurations,
                    or recorded evidence snapshots. Direct score comparison is
                    unsupported.
                  </Notice>
                ) : (
                  <>
                    {comparison.data.manifest.codebook.id !==
                      data.manifest.codebook.id && (
                      <Notice kind="warning">
                        Codebook definitions differ. Shared display names do not
                        imply semantic equivalence.
                      </Notice>
                    )}
                    <Table
                      label="Analysis configuration differences"
                      headers={["Setting", "This analysis", "Comparison"]}
                    >
                      {(
                        [
                          "model",
                          "windowSize",
                          "stride",
                          "codebookRevisionId",
                          "evidence",
                          "phases",
                        ] as const
                      ).map((key) => (
                        <tr key={key}>
                          <th scope="row">{key}</th>
                          <td>{pretty(data.manifest.settings[key])}</td>
                          <td>
                            {pretty(comparison.data!.manifest.settings[key])}
                          </td>
                        </tr>
                      ))}
                    </Table>
                    <div className="form-grid" style={{ marginTop: 20 }}>
                      <div>
                        <h3>This analysis · actual windows</h3>
                        <ScoreTable
                          windows={current}
                          codes={shown}
                          onSelect={openWindow}
                        />
                      </div>
                      <div>
                        <h3>Comparison · actual windows</h3>
                        <ScoreTable
                          windows={otherWindows.data?.items ?? []}
                          codes={comparison.data.manifest.codebook.codes.filter(
                            (c) => c.enabled && !c.archived,
                          )}
                          onSelect={(w) => {
                            window.location.href =
                              "/analysis/" +
                              comparison.data!.id +
                              "?window=" +
                              w.id;
                          }}
                        />
                      </div>
                    </div>
                    <p className="helper">
                      Each side shows its current first page. Open the
                      comparison analysis for pagination and complete evidence.
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        </Card>
      ) : (
        <Card>
          <CardHeading
            title="Reproducible provenance"
            description="Frozen configuration, evidence boundaries, definitions, and missingness."
          />
          <div className="card-body">
            <dl className="definition-list">
              <dt>Source completeness</dt>
              <dd>{data.manifest.sourceStatus}</dd>
              <dt>Evidence hash</dt>
              <dd className="mono">{data.manifest.evidenceHash}</dd>
              <dt>Normalizer</dt>
              <dd>{data.manifest.normalizerVersion}</dd>
              <dt>SDK / adapter</dt>
              <dd>
                {data.manifest.sdkVersion} / {data.manifest.adapterVersion}
              </dd>
            </dl>
            <hr className="section-divider" />
            <div className="actions">
              {["analysis"].map((dataset) => (
                <Button key={dataset} asChild variant="secondary" size="sm">
                  <a
                    href={`/api/analyses/${id}/export?dataset=${dataset}&limit=100`}
                    download
                  >
                    Complete linked datasets
                  </a>
                </Button>
              ))}
            </div>
            <p className="helper" style={{ margin: "12px 0" }}>
              The NDJSON export streams the complete frozen source, inputs,
              scores, attempts, and review provenance as separate linked record
              types.
            </p>
            <JsonView
              value={data.manifest}
              title="Complete frozen analysis manifest"
            />
          </div>
        </Card>
      )}
      <Drawer
        open={!!windowId}
        onOpenChange={(open) => {
          if (!open)
            setParams((prev) => {
              prev.delete("window");
              return prev;
            });
        }}
        title={
          detail.data
            ? `Window ${detail.data.window.index + 1} · steps ${detail.data.window.startStep}–${detail.data.window.endStep}`
            : "Analysis window"
        }
        description="Exact normalized evidence and canonical source links."
      >
        {detail.loading ? (
          <Loading />
        ) : detail.error ? (
          <ErrorState error={detail.error} retry={detail.refresh} />
        ) : (
          detail.data && (
            <WindowInspector
              key={detail.data.window.id}
              detail={detail.data}
              job={data}
              blind={
                tab === "review" &&
                (params.get("batch")
                  ? persistedBatch.data?.batch.id !== params.get("batch") ||
                    persistedBatch.data?.batch.mode === "blind"
                  : params.get("blind") === "true")
              }
            />
          )
        )}
      </Drawer>
    </>
  );
}
function ProbabilityPlot({
  code,
  windows,
  onSelect,
}: {
  code: BehaviorCode;
  windows: AnalysisWindow[];
  onSelect: (w: AnalysisWindow) => void;
}) {
  const min = Math.min(...windows.map((w) => w.startStep)),
    max = Math.max(...windows.map((w) => w.endStep));
  const x = (end: number) => 36 + ((end - min) / Math.max(1, max - min)) * 624;
  const y = (p: number) => 91 - p * 75;
  let path = "";
  let connected = false;
  for (const w of windows) {
    const score = w.results?.find((r) => r.codeId === code.id)?.probability;
    if (score == null) {
      connected = false;
      continue;
    }
    path += (connected ? " L" : " M") + x(w.endStep) + "," + y(score);
    connected = true;
  }
  return (
    <section style={{ marginBottom: 20 }}>
      <div className="actions" style={{ justifyContent: "space-between" }}>
        <h3 style={{ fontSize: 12 }}>
          <span
            className="color-dot"
            style={{ background: code.color, marginRight: 8 }}
          />
          {code.code}
        </h3>
        <span className="helper">
          {min}–{max} source steps
        </span>
      </div>
      <p className="helper">{code.definition}</p>
      <svg
        className="chart"
        viewBox="0 0 700 112"
        role="img"
        aria-label={`${code.code} probability plot; the accessible score table contains the same values.`}
      >
        <line x1="36" x2="670" y1="16" y2="16" className="chart-grid" />
        <line x1="36" x2="670" y1="91" y2="91" className="chart-grid" />
        <text x="2" y="20" className="chart-label">
          100%
        </text>
        <text x="13" y="94" className="chart-label">
          0%
        </text>
        <path d={path} className="chart-line" />
        {windows.map((w) => {
          const score = w.results?.find(
            (r) => r.codeId === code.id,
          )?.probability;
          return score == null ? (
            <text
              key={w.id}
              x={x(w.endStep)}
              y="56"
              className="chart-label"
              textAnchor="middle"
            >
              —
            </text>
          ) : (
            <circle
              key={w.id}
              cx={x(w.endStep)}
              cy={y(score)}
              r="4"
              className="chart-point"
              role="button"
              tabIndex={0}
              aria-label={`${code.code}: ${(score * 100).toFixed(1)}%, steps ${w.startStep} to ${w.endStep}. Inspect window.`}
              onClick={() => onSelect(w)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(w);
                }
              }}
            >
              <title>{`${code.code} · ${w.startStep}–${w.endStep} · ${(score * 100).toFixed(1)}% · ${w.partial ? "partial window" : w.incomplete ? "incomplete evidence" : "recorded evidence"}`}</title>
            </circle>
          );
        })}
        <text x="36" y="109" className="chart-label">
          {min}
        </text>
        <text x="657" y="109" className="chart-label">
          {max}
        </text>
      </svg>
    </section>
  );
}
function ScoreTable({
  windows,
  codes,
  onSelect,
}: {
  windows: AnalysisWindow[];
  codes: BehaviorCode[];
  onSelect: (w: AnalysisWindow) => void;
}) {
  return (
    <Table
      label="Window probability scores"
      headers={["Source window", ...codes.map((c) => c.code), "State"]}
    >
      {windows.map((w) => (
        <tr key={w.id}>
          <td>
            <button
              className="table-title"
              style={{
                border: 0,
                background: "none",
                padding: 0,
                cursor: "pointer",
              }}
              onClick={() => onSelect(w)}
            >
              Steps {w.startStep}–{w.endStep}
            </button>
            <small>
              {w.partial
                ? "Partial window"
                : w.incomplete
                  ? "Incomplete evidence"
                  : "Fixed window"}
            </small>
          </td>
          {codes.map((code) => {
            const score = w.results?.find(
              (r) => r.codeId === code.id,
            )?.probability;
            return (
              <td key={code.id}>
                {score == null ? (
                  <span title={w.error || w.status}>— missing</span>
                ) : (
                  (score * 100).toFixed(1) + "%"
                )}
              </td>
            );
          })}
          <td>
            <Badge status={w.status} />
            {w.error && <small>{w.error}</small>}
          </td>
        </tr>
      ))}
    </Table>
  );
}
function ReviewWorkspace({
  job,
  onSelect,
}: {
  job: AnalysisJob;
  onSelect: (windowId: string) => void;
}) {
  const [params, setParams] = useSearchParams();
  const batchId = params.get("batch") || "";
  const [reviewer, setReviewer] = useState(
    () => localStorage.getItem("sidechannel-reviewer") || "",
  );
  const [mode, setMode] = useState<"assisted" | "blind">(
    params.get("blind") === "true" ? "blind" : "assisted",
  );
  const [threshold, setThreshold] = useState(0.7);
  const [randomCount, setRandomCount] = useState(10);
  const [seed, setSeed] = useState("pilot-42");
  const [queueFilter, setQueueFilter] = useState("all");
  const [batchCursor, setBatchCursor] = useState<string | null>(null);
  const batches = useCursorApi<ReviewBatch>(
    "/analyses/" + job.id + "/review-batches",
  );
  const batch = useApi<{
    batch: ReviewBatch;
    selections: Page<ReviewSelection>;
  }>(
    batchId
      ? "/analyses/" +
          job.id +
          "/review-batches/" +
          batchId +
          "?limit=30&reviewer=" +
          encodeURIComponent(reviewer) +
          "&filter=" +
          encodeURIComponent(queueFilter) +
          (batchCursor ? "&after=" + encodeURIComponent(batchCursor) : "")
      : null,
  );
  useEffect(() => {
    if (batch.data?.batch.id === batchId) setMode(batch.data.batch.mode);
  }, [batch.data, batchId]);
  useEffect(() => {
    setBatchCursor(null);
  }, [queueFilter, reviewer, batchId]);
  const mutation = useMutation();
  const blind = mode === "blind";
  const create = async () => {
    const result = await mutation.run(() =>
      post<ReviewBatch>("/analyses/" + job.id + "/review-batches", {
        mode,
        threshold,
        randomCount,
        seed,
        creator: reviewer,
      }),
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
  return (
    <>
      <Notice>
        Window and event annotations are provisional research notes. Run-level
        reference outcomes require agreement by two distinct claimed reviewers
        and are recorded separately in Oversight.
      </Notice>
      <div className="editor-layout">
        <Card>
          <CardHeading
            title="Durable review selection"
            description="Flagged candidates and random samples share one queue without duplicate tasks."
          />
          <div className="card-body form-grid">
            <Field
              label="Reviewer identity"
              hint="Self-entered and unverified in this open workspace."
            >
              <Input
                value={reviewer}
                onChange={(e) => {
                  setReviewer(e.target.value);
                  localStorage.setItem("sidechannel-reviewer", e.target.value);
                }}
              />
            </Field>
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
                <option value="blind">
                  Blind · hide predictions until judgment
                </option>
              </Select>
            </Field>
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
            <Field label="Random sampling seed">
              <Input value={seed} onChange={(e) => setSeed(e.target.value)} />
            </Field>
            <div className="actions">
              <Button
                onClick={create}
                disabled={mutation.busy || !reviewer.trim()}
              >
                Create selection batch
              </Button>
            </div>
            <p className="helper full">
              Refresh retrieves the same stored batch. Selection reasons,
              settings, population hash, seed, and eligible count are preserved
              for export. Random windows within a run are correlated
              observations.
            </p>
          </div>
          {mutation.error && <ErrorState error={mutation.error} />}
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
              </div>
              {batch.loading ? (
                <Loading />
              ) : batch.error ? (
                <ErrorState error={batch.error} retry={batch.refresh} />
              ) : (
                <Table
                  label="Persisted review queue"
                  headers={["Selected window", "Sampling provenance", ""]}
                >
                  {filtered.map((selection, index) => (
                    <tr key={selection.id}>
                      <td>
                        {blind
                          ? "Review item " + (index + 1)
                          : short(selection.windowId)}
                      </td>
                      <td>
                        {selection.reasons?.length
                          ? selection.reasons.join(" + ")
                          : "Hidden until initial judgment"}
                      </td>
                      <td>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onSelect(selection.windowId)}
                        >
                          Review evidence
                        </Button>
                      </td>
                    </tr>
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
        </Card>
        <Card>
          <CardHeading title="Saved selection batches" />
          {batches.data?.items.map((item) => (
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
          <Pager {...batches.pagination} />
        </Card>
      </div>
    </>
  );
}
export function WindowInspector({
  detail,
  job,
  blind,
}: {
  detail: WindowDetail;
  job: AnalysisJob;
  blind: boolean;
}) {
  const [reviewer, setReviewer] = useState(
    () => localStorage.getItem("sidechannel-reviewer") || "",
  );
  const [historyPage, setHistoryPage] = useState(0),
    [historyCursors, setHistoryCursors] = useState<(string | null)[]>([null]);
  const reviews = useApi<Page<HumanReview>>(
    "/analyses/" +
      job.id +
      "/reviews?windowId=" +
      detail.window.id +
      "&limit=30" +
      (historyCursors[historyPage]
        ? "&after=" + encodeURIComponent(historyCursors[historyPage]!)
        : ""),
    4000,
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
      ? `/analyses/${job.id}/reviews?windowId=${detail.window.id}&reviewer=${encodeURIComponent(reviewer)}&latest=true&limit=1`
      : null,
  );
  const subjectId = scope === "window" ? detail.window.id : list(eventIds)[0];
  const ownLatest = useApi<Page<HumanReview>>(
    reviewer.trim() && subjectId
      ? `/analyses/${job.id}/reviews?windowId=${detail.window.id}&subjectId=${encodeURIComponent(subjectId)}&scope=${scope}&codeId=${encodeURIComponent(codeId)}&reviewer=${encodeURIComponent(reviewer)}&latest=true&limit=1`
      : null,
  );
  const mutation = useMutation();
  const ownReviews =
    ownPresence.data?.items.filter(
      (r) => r.reviewer === reviewer.trim() && r.windowId === detail.window.id,
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
  const save = async () => {
    const result = await mutation.run(
      () =>
        post<HumanReview>("/analyses/" + job.id + "/reviews", {
          reviewer,
          scope,
          windowId: detail.window.id,
          codeId,
          decision,
          rationale,
          eventIds: list(eventIds),
          stepIds: scope === "window" ? detail.window.stepIds : [],
          predictionsVisible,
          supersedesId: latest?.id,
        }),
      "Judgment appended to the review history.",
    );
    if (result) {
      void reviews.refresh();
      void ownPresence.refresh();
      void ownLatest.refresh();
      setRationale("");
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
      <JsonView
        value={detail.window.state}
        title="Exact normalized evidence used for this window"
      />
      <details>
        <summary className="helper">
          Canonical source events ({detail.window.eventIds.length})
        </summary>
        {detail.window.eventIds.map((eventId) => (
          <div key={eventId} style={{ marginTop: 10 }}>
            <Link
              className="table-title mono"
              to={
                "/runs/" +
                job.runId +
                "?view=timeline&evidence=" +
                encodeURIComponent(eventId)
              }
            >
              {eventId}
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setScope("event");
                setEventIds(eventId);
              }}
            >
              Annotate this event
            </Button>
          </div>
        ))}
      </details>
      <hr className="section-divider" />
      <h3 style={{ marginBottom: 15 }}>Record a human judgment</h3>
      {mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}
      {mutation.message && <Notice kind="success">{mutation.message}</Notice>}
      <div className="form-grid">
        <Field label="Claimed reviewer identity">
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
          <Select value={codeId} onChange={(e) => setCodeId(e.target.value)}>
            {job.manifest.codebook.codes.map((code) => (
              <option key={code.id} value={code.id}>
                {code.code}
              </option>
            ))}
          </Select>
        </Field>
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
        <Field
          label="Linked evidence event IDs"
          hint="Window scope: supporting event IDs, one per line. Event scope: exactly one canonical event ID."
          className="full"
        >
          <Textarea
            value={eventIds}
            onChange={(e) => setEventIds(e.target.value)}
          />
        </Field>
        <Field label="Rationale / limitations" className="full">
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
            onClick={save}
          >
            {latest ? "Append revised judgment" : "Save judgment"}
          </Button>
          <Badge>
            {predictionsVisible ? "Suggestions visible" : "Suggestions hidden"}
          </Badge>
        </div>
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
        reviews.data?.items
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
          page={historyPage}
          hasMore={!!reviews.data?.nextCursor}
          onChange={(next) => {
            if (next > historyPage)
              setHistoryCursors((previous) => [
                ...previous.slice(0, next),
                reviews.data?.nextCursor ?? null,
              ]);
            setHistoryPage(next);
          }}
        />
      )}
    </>
  );
}
