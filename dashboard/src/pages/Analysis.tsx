import { useEffect, useRef, useState } from "react";
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
  Play,
  RefreshCw,
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
import {
  useApi,
  useMutation,
  useOffsetPage,
  usePage,
  usePageRequest,
} from "../lib/api";
import { useClients } from "../lib/clients/context";
import { NEW_ANALYSIS_DEFAULTS } from "../lib/adapters/defaults";
import { list, pretty, short, when } from "../lib/utils";
import "./analysis/analysis.css";
import { RecordedEventContent } from "./analysis/RecordedEventContent";
import { AnalysisDetail } from "./analysis/analysis-detail";
import type { HarnessEvent } from "@sidechannel/contracts/browser";
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
      <Route index element={<AnalysisEntry />} />
      <Route path="new" element={<AnalysisSetup />} />
      <Route path=":id" element={<AnalysisDetail />} />
    </Routes>
  );
}
function AnalysisEntry() {
  const [params] = useSearchParams();
  return params.has("run") || params.has("clone") ? (
    <AnalysisSetup />
  ) : (
    <AnalysisCollection />
  );
}
function AnalysisCollection() {
  const clients = useClients();
  const [params] = useSearchParams();
  const jobs = usePage<AnalysisJob>(clients.analyses.paths.list(), {
    interval: 5000,
    cursorKey: "cursor",
    limit: 30,
  });
  const returnTo = "/analysis" + (params.size ? "?" + params.toString() : "");
  return (
    <>
      <PageHeader
        title="Analyses"
        description="Open saved screening results or prepare a new analysis."
        actions={
          <Button asChild>
            <Link to="/analysis/new">New analysis</Link>
          </Button>
        }
      />
      <Card>
        <CardHeading title="Saved analyses" />
        {jobs.loading ? (
          <Loading />
        ) : jobs.error ? (
          <ErrorState error={jobs.error} retry={jobs.refresh} />
        ) : !jobs.data.length ? (
          <Empty
            title="No analyses yet"
            description="Choose New analysis to select a source run and frozen definitions."
          />
        ) : (
          <Table
            label="Saved analyses"
            headers={["Source and settings", "State", "Created", ""]}
          >
            {jobs.data.map((job) => (
              <AnalysisCollectionRow
                key={job.id}
                job={job}
                returnTo={returnTo}
              />
            ))}
          </Table>
        )}
        <Pager
          page={jobs.page}
          hasMore={jobs.hasMore}
          onChange={jobs.onChange}
        />
      </Card>
    </>
  );
}
function AnalysisCollectionRow({
  job,
  returnTo,
}: {
  job: AnalysisJob;
  returnTo: string;
}) {
  const clients = useClients();
  const source = useApi<Run>(clients.runs.paths.get(job.runId));
  const target = `/analysis/${job.id}?return=${encodeURIComponent(returnTo)}`;
  return (
    <tr>
      <td>
        <Link className="table-title" to={target}>
          {source.data?.config?.label || "Source run"} -{" "}
          {source.data?.config?.condition?.id || "Condition unavailable"}
        </Link>
        <small className="analysis-id">
          {job.manifest.settings.model} - {job.manifest.settings.windowSize}
          -step windows - revision {job.manifest.codebook.revision}
        </small>
        <details>
          <summary>Canonical identifiers</summary>
          <p className="mono">
            Analysis: {job.id}
            <br />
            Source: {job.runId}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigator.clipboard.writeText(job.id)}
          >
            Copy analysis ID
          </Button>
        </details>
      </td>
      <td>
        <Badge status={job.status} />
      </td>
      <td>{when(job.createdAt)}</td>
      <td>
        <Button asChild variant="ghost" size="sm">
          <Link to={target}>Open results</Link>
        </Button>
      </td>
    </tr>
  );
}
function AnalysisSetup() {
  const [params, setParams] = useSearchParams();
  const runId = params.get("run") || "";
  const clone = params.get("clone");
  const clients = useClients();
  const runs = useOffsetPage<Run>(clients.runs.paths.list({ summary: true }), { pageSize: 50 });
  const source = useApi<Run>(runId ? clients.runs.paths.get(runId) : null);
  const books = usePage<Codebook>(clients.codebooks.paths.list(), { limit: 30 });
  const cloned = useApi<AnalysisJob>(clone ? clients.analyses.paths.job(clone) : null);
  const jobs = usePage<AnalysisJob>(
    runId ? clients.analyses.paths.runJobs(runId) : null,
    { interval: 5000, limit: 30 },
  );
  const [settings, setSettings] = useState<AnalysisSettings>({
    codebookId: "",
    codebookRevisionId: "",
    model: NEW_ANALYSIS_DEFAULTS.model,
    windowSize: NEW_ANALYSIS_DEFAULTS.windowSize,
    stride: NEW_ANALYSIS_DEFAULTS.stride,
    phases: ["action", "report"],
    evidence: [...categories],
    headroom: NEW_ANALYSIS_DEFAULTS.headroom,
    timeoutMs: NEW_ANALYSIS_DEFAULTS.timeoutMs,
    maxAttempts: NEW_ANALYSIS_DEFAULTS.maxAttempts,
    creator: localStorage.getItem("sidechannel-reviewer") || "",
  });
  const revision = useApi<{ codebook: Codebook; revision: CodebookRevision }>(
    settings.codebookId ? clients.codebooks.paths.get(settings.codebookId) : null,
  );
  const revisionHistory = usePage<CodebookRevision>(
    settings.codebookId
      ? clients.codebooks.paths.revisions(settings.codebookId)
      : null,
    { limit: 30 },
  );
  const [preview, setPreview] = useState<AnalysisPreview>();
  const [previewWindow, setPreviewWindow] = useState<
    AnalysisPreview["windows"][number] & { state?: string }
  >();
  const mutation = useMutation();
  const settingsGeneration = useRef(0);
  const navigate = useNavigate();
  useEffect(() => {
    settingsGeneration.current++;
    setPreview(undefined);
  }, [runId]);
  useEffect(() => {
    if (!settings.codebookId && books.data[0])
      setSettings((old) => ({
        ...old,
        codebookId: books.data[0].id,
        codebookRevisionId: books.data[0].currentRevisionId,
      }));
  }, [books.data, settings.codebookId]);
  useEffect(() => {
    if (cloned.data) {
      settingsGeneration.current++;
      setPreview(undefined);
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
    settingsGeneration.current++;
    setSettings((previous) => ({ ...previous, ...patch }));
    setPreview(undefined);
  };
  const launch = async () => {
    if (!preview) return;
    const result = await mutation.run(() =>
      clients.analyses.launch(runId, settings, preview.previewToken),
    );
    if (result) navigate("/analysis/" + result.id);
  };
  const doPreview = async () => {
    const generation = settingsGeneration.current;
    const result = await mutation.run(() =>
      clients.analyses.preview(runId, settings),
    );
    if (result && generation === settingsGeneration.current) setPreview(result);
  };
  const currentRevision =
    revisionHistory.data.find(
      (r) => r.id === settings.codebookRevisionId,
    ) ?? revision.data?.revision;
  const prerequisites = [
    !runId && "Select a source run.",
    source.data &&
      !["completed", "failed", "cancelled"].includes(source.data.status) &&
      "Wait for the source run to finish before previewing.",
    !settings.codebookRevisionId && "Select a codebook revision.",
    !settings.creator.trim() && "Enter a researcher / creator identity.",
    (!Number.isFinite(settings.windowSize) || settings.windowSize < 1) &&
      "Enter a positive window size.",
    (!Number.isFinite(settings.stride) || settings.stride < 1) &&
      "Enter a positive step interval.",
    !settings.evidence.length && "Select at least one evidence category.",
    !settings.phases.length && "Select at least one phase.",
  ].filter(Boolean);
  const scoreable =
    preview?.windows.filter(
      (w) => !w.budget.oversized && !w.empty && w.budget.batches.length > 0,
    ).length ?? 0;
  return (
    <>
      <Button asChild variant="ghost">
        <Link to="/analysis">All analyses</Link>
      </Button>
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
                  required
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
                      !runs.data.some((run) => run.id === runId) && (
                        <option value={runId}>
                          {source.data?.config.label || runId} · selected source
                        </option>
                      )}
                    {runs.data.map((run) => (
                      <option key={run.id} value={run.id}>
                        {run.config.label} · {run.status} · {short(run.id)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Pager page={runs.page} hasMore={runs.hasMore} onChange={runs.onChange} />
              </div>
              <div>
                <Field label="Codebook" required>
                  <Select
                    value={settings.codebookId}
                    onChange={(e) => {
                      const book = books.data.find(
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
                      !books.data.some(
                        (book) => book.id === settings.codebookId,
                      ) && (
                        <option value={settings.codebookId}>
                          {revision.data?.codebook.name || "Selected codebook"}
                        </option>
                      )}
                    {books.data.map((book) => (
                      <option key={book.id} value={book.id}>
                        {book.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Pager page={books.page} hasMore={books.hasMore} onChange={books.onChange} />
              </div>
              <div>
                <Field
                  required
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
                      !revisionHistory.data.some(
                        (item) => item.id === revision.data?.revision.id,
                      ) && (
                        <option value={revision.data.revision.id}>
                          Current revision {revision.data.revision.revision}
                        </option>
                      )}
                    {revisionHistory.data.map((item) => (
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
                <Pager page={revisionHistory.page} hasMore={revisionHistory.hasMore} onChange={revisionHistory.onChange} />
              </div>
              <Field
                required
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
              <Field label="Window size (classification steps)" required>
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
                required
                label="Window advance (classification steps)"
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
              <Field
                label="Reserved input space (tokens)"
                hint="Tokens reserved for provider overhead; reduces the evidence budget."
              >
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
              <Field
                label="Request timeout (seconds)"
                hint="Maximum wait per request; stored exactly in milliseconds."
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
              ) : jobs.data.length ? (
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
                  {jobs.data.map((job) => (
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
              <Pager page={jobs.page} hasMore={jobs.hasMore} onChange={jobs.onChange} />
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
              {prerequisites.length > 0 && (
                <div className="helper" id="analysis-prerequisites">
                  <strong>Before previewing:</strong>
                  <ul>
                    {prerequisites.map((item) => (
                      <li key={String(item)}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {preview && (
                <div role="status" className="analysis-preflight">
                  <strong>{scoreable} scoreable windows</strong>
                  <p>
                    {preview.windows.filter((w) => w.budget.oversized).length}{" "}
                    oversized -{" "}
                    {preview.windows.filter((w) => w.partial).length} partial -{" "}
                    {preview.windows.length - scoreable} unscored
                  </p>
                  {scoreable === 0 ? (
                    <p>
                      No scores will be produced. Adjust Windowing &amp;
                      evidence, or explicitly save an unscored record.
                    </p>
                  ) : (
                    <p>
                      {scoreable} windows will be scored;{" "}
                      {preview.windows.length - scoreable} remain unscored.
                    </p>
                  )}
                </div>
              )}
              <Button
                aria-describedby={
                  prerequisites.length ? "analysis-prerequisites" : undefined
                }
                onClick={doPreview}
                disabled={mutation.busy || prerequisites.length > 0}
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
                  {scoreable
                    ? "Launch analysis job"
                    : "Save unscored analysis record"}
                </Button>
              )}
              <p className="helper" style={{ marginTop: 12 }}>
                Estimates are not a guaranteed bill. No automatic truncation,
                shrinking, or splitting. You can leave after launch; the worker
                continues.
              </p>
            </div>
          </Card>
          {!books.data.length && !books.loading && (
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
  const clients = useClients();
  const state = usePageRequest<{ state: string }>(
    token ? () => clients.analyses.previewWindow(token, windowId) : null,
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
