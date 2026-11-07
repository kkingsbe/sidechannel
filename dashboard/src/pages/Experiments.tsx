import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  Copy,
  FlaskConical,
  Plus,
  Save,
  Send,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeading,
  Check,
  Empty,
  ErrorState,
  Field,
  Input,
  Loading,
  Notice,
  PageHeader,
  Select,
  Textarea,
} from "../components/ui";
import { api, post, useApi, useMutation } from "../lib/api";
import type { Draft, ExperimentConfig, Json, Run } from "../lib/types";
import { pretty, when } from "../lib/utils";
type Validation = {
  valid: boolean;
  errors: string[];
  fieldErrors?: Record<string, string>;
  config?: ExperimentConfig;
};
const tools = [
  "list_agents",
  "post_board",
  "read_board",
  "update_working_memory",
  "read_role_data",
  "update_artifact",
  "read_artifact",
  "end_turn",
];
const supportedSettings = [
  "maxOutputTokens",
  "temperature",
  "topP",
  "topK",
  "presencePenalty",
  "frequencyPenalty",
  "seed",
];
function editableConfiguration(value: ExperimentConfig): boolean {
  return (
    [
      "model",
      "condition",
      "scenario",
      "scheduler",
      "board",
      "memory",
      "limits",
      "build",
    ].every(
      (key) =>
        value[key as keyof ExperimentConfig] &&
        typeof value[key as keyof ExperimentConfig] === "object",
    ) &&
    Array.isArray(value.roles) &&
    value.roles.every(
      (role) =>
        role != null &&
        typeof role.id === "string" &&
        typeof role.instructions === "string" &&
        Array.isArray(role.allowedTools),
    ) &&
    value.model.settings != null
  );
}
function completeConfiguration(
  defaults: ExperimentConfig,
  input: unknown,
): ExperimentConfig {
  const merge = (base: unknown, value: unknown): unknown => {
    if (Array.isArray(base))
      return Array.isArray(value)
        ? value.map((item) => (base.length ? merge(base[0], item) : item))
        : structuredClone(base);
    if (base && typeof base === "object" && !Array.isArray(base)) {
      const object =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      return {
        ...object,
        ...Object.fromEntries(
          Object.entries(base).map(([key, child]) => [
            key,
            merge(child, object[key]),
          ]),
        ),
      };
    }
    return value === undefined || value === null
      ? structuredClone(base)
      : value;
  };
  return merge(defaults, input) as ExperimentConfig;
}
function valueAt(config: ExperimentConfig, path: string): unknown {
  return path
    .split(".")
    .reduce(
      (value: unknown, key) => (value as Record<string, unknown>)?.[key],
      config,
    );
}
function setAt(
  config: ExperimentConfig,
  path: string,
  value: unknown,
): ExperimentConfig {
  const next = structuredClone(config);
  const keys = path.split(".");
  const last = keys.pop()!;
  const object = keys.reduce(
    (value: unknown, key) => (value as Record<string, unknown>)[key],
    next,
  ) as Record<string, unknown>;
  object[last] = value;
  return next;
}
export default function Experiments() {
  const defaults = useApi<ExperimentConfig>("/config/default");
  const drafts = useApi<Draft[]>("/drafts");
  const schema = useApi<{ fields: { path: string; required: boolean }[] }>(
    "/config/schema",
  );
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [config, setConfig] = useState<ExperimentConfig>();
  const [draft, setDraft] = useState<Draft>();
  const [validation, setValidation] = useState<Validation>();
  const [dirty, setDirty] = useState(false);
  const [launchReview, setLaunchReview] = useState(false);
  const [savedLocal, setSavedLocal] = useState(false);
  const [launched, setLaunched] = useState<Run[]>();
  const [notes, setNotes] = useState("");
  const mutation = useMutation();
  const launchKey = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!defaults.data || config) return;
    const saved = localStorage.getItem("sidechannel-experiment-draft");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setConfig(data.config);
        setDraft(data.draft);
        setNotes(data.notes || "");
        setSavedLocal(true);
        setDirty(true);
        return;
      } catch {
        /* Ignore an invalid local recovery copy. */
      }
    }
    setConfig(structuredClone(defaults.data));
  }, [defaults.data, config]);
  useEffect(() => {
    if (!params.get("draft")) return;
    void api<Draft>("/drafts/" + encodeURIComponent(params.get("draft")!))
      .then((data) => {
        setConfig(data.config);
        setDraft(data);
        setDirty(false);
      })
      .catch(() => {});
  }, [params]);
  useEffect(() => {
    if (config && dirty)
      localStorage.setItem(
        "sidechannel-experiment-draft",
        JSON.stringify({ config, draft, notes }),
      );
  }, [config, draft, dirty, notes]);
  const change = (path: string, value: unknown) => {
    if (!config) return;
    setConfig(setAt(config, path, value));
    setDirty(true);
    setValidation(undefined);
    setLaunchReview(false);
    launchKey.current = crypto.randomUUID();
  };
  const field = (
    path: string,
    label: string,
    hint?: string,
    kind: "text" | "textarea" | "number" = "text",
    min?: number,
  ) => (
    <Field
      key={path}
      label={label}
      hint={hint}
      error={validation?.fieldErrors?.[path]}
    >
      {kind === "textarea" ? (
        <Textarea
          value={String(valueAt(config!, path) ?? "")}
          onChange={(e) => change(path, e.target.value)}
        />
      ) : (
        <Input
          type={kind}
          min={min}
          step={kind === "number" ? 1 : undefined}
          value={String(valueAt(config!, path) ?? "")}
          onChange={(e) =>
            change(
              path,
              kind === "number" ? e.target.valueAsNumber : e.target.value,
            )
          }
        />
      )}
    </Field>
  );
  const save = async () => {
    const result = await mutation.run(
      () =>
        post<Draft>("/drafts", {
          id: draft?.id,
          revision: draft?.revision,
          config,
          name: config?.label,
          notes,
        }),
      "Draft saved. This does not launch any run.",
    );
    if (result) {
      setDraft(result);
      launchKey.current = crypto.randomUUID();
      setDirty(false);
      setSavedLocal(false);
      localStorage.removeItem("sidechannel-experiment-draft");
      void drafts.refresh();
    }
  };
  const validate = async () => {
    const result = await mutation.run(() =>
      post<Validation>("/config/validate", { config }),
    );
    if (result) {
      setValidation(result);
      setLaunchReview(result.valid);
    }
  };
  const launch = async () => {
    const result = await mutation.run(() =>
      post<Run[]>("/pairs", {
        config,
        idempotencyKey: launchKey.current,
        pairingSeed: config?.scheduler?.seed,
        ...(!dirty && draft
          ? { sourceDraftId: draft.id, sourceDraftRevision: draft.revision }
          : {}),
      }),
    );
    if (result) {
      setLaunched(result);
      setLaunchReview(false);
      localStorage.removeItem("sidechannel-experiment-draft");
    }
  };
  const load = (item: Draft) => {
    if (
      dirty &&
      !window.confirm(
        "Replace unsaved edits with this saved draft? A local recovery copy is available until the next edit.",
      )
    )
      return;
    setConfig(structuredClone(item.config));
    setDraft(item);
    setDirty(false);
    setSavedLocal(false);
    setValidation(undefined);
    setLaunchReview(false);
    launchKey.current = crypto.randomUUID();
    navigate("/experiments?draft=" + item.id);
  };
  const duplicate = async () => {
    if (!draft) return;
    const result = await mutation.run(() =>
      post<Draft>("/drafts/" + draft.id + "/duplicate", {}),
    );
    if (result) {
      setConfig(result.config);
      setDraft(result);
      launchKey.current = crypto.randomUUID();
      setDirty(false);
      void drafts.refresh();
    }
  };
  if (defaults.loading || (!config && !defaults.error)) return <Loading />;
  if (!config)
    return <ErrorState error={defaults.error} retry={defaults.refresh} />;
  if (!editableConfiguration(config))
    return (
      <>
        <PageHeader
          title="Incomplete experiment draft"
          description="This saved draft is missing required configuration groups. Its stored content and revision are preserved."
        />
        <Notice kind="warning">
          The ordinary experiment form needs complete model, scenario,
          execution, board, memory, and role structures. Add the backend's
          supported default fields explicitly, then edit and validate before
          launch.
        </Notice>
        {mutation.error && (
          <Notice kind="error">{mutation.error.message}</Notice>
        )}
        <Card>
          <CardHeading
            title={config.label || "Untitled incomplete draft"}
            description={
              draft
                ? `Saved draft ${draft.id} · revision ${draft.revision ?? 1}`
                : "Local draft"
            }
          />
          <div className="card-body stack">
            <Field label="Draft name">
              <Input
                value={config.label || ""}
                onChange={(e) => change("label", e.target.value)}
              />
            </Field>
            <div className="actions">
              <Button
                onClick={() => {
                  setConfig(completeConfiguration(defaults.data!, config));
                  setDirty(true);
                  setValidation(undefined);
                }}
              >
                Complete with supported default fields
              </Button>
              <Button
                variant="secondary"
                onClick={save}
                disabled={mutation.busy}
              >
                Save incomplete draft
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setConfig(structuredClone(defaults.data!));
                  setDraft(undefined);
                  setDirty(false);
                  navigate("/experiments");
                }}
              >
                Start a new draft
              </Button>
            </div>
            <details>
              <summary className="helper">
                Stored draft content (read only)
              </summary>
              <pre>{pretty(config)}</pre>
            </details>
          </div>
        </Card>
      </>
    );
  const primitiveAssets =
    config.scenario.assets &&
    typeof config.scenario.assets === "object" &&
    !Array.isArray(config.scenario.assets)
      ? Object.entries(config.scenario.assets)
      : null;
  return (
    <>
      <PageHeader
        eyebrow="EXPERIMENT DESIGN"
        title="Configure a matched pair"
        description="One frozen configuration. Two board-review conditions. All researcher evidence retained."
        actions={
          <>
            <Badge>
              {dirty
                ? "Unsaved edits"
                : draft
                  ? `Draft revision ${draft.revision ?? 1}`
                  : "New draft"}
            </Badge>
            <Button variant="secondary" disabled={mutation.busy} onClick={save}>
              <Save size={15} />
              Save draft
            </Button>
          </>
        }
      />
      {savedLocal && (
        <Notice kind="warning">
          Recovered unsaved edits from this browser. Save them to share the
          draft with your team.
        </Notice>
      )}
      {mutation.error && (
        <Notice kind="error">
          {mutation.error.message}
          {"status" in mutation.error && mutation.error.status === 409 && (
            <p>
              This draft changed on the server. Your edits are retained. Load
              the latest saved draft to reconcile, or save your configuration as
              a new draft.
            </p>
          )}
        </Notice>
      )}
      {mutation.message && <Notice kind="success">{mutation.message}</Notice>}
      {validation && !validation.valid && (
        <Notice kind="error">
          <strong>Configuration needs attention</strong>
          <ul>
            {validation.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </Notice>
      )}
      {launched && (
        <Notice kind="success">
          <strong>Matched pair queued</strong>
          <p>
            The configuration is frozen. Runs execute independently of this
            browser.
          </p>
          <div className="actions">
            {launched.map((run) => (
              <Button asChild size="sm" variant="secondary" key={run.id}>
                <Link to={"/runs/" + run.id}>
                  {run.config.condition.id} · {run.id.slice(0, 12)}
                </Link>
              </Button>
            ))}
          </div>
        </Notice>
      )}
      <div className="editor-layout">
        <div>
          <Card className="form-section">
            <CardHeading
              title="Task & study"
              description="Versioned scenario and study metadata"
            />
            <div className="card-body form-grid">
              {field("label", "Experiment name")}
              {field("experimentId", "Experiment / group identifier")}
              {field("configVersion", "Configuration version")}
              <Field label="Designation">
                <Select
                  value={config.phase}
                  onChange={(e) => change("phase", e.target.value)}
                >
                  <option value="development">Development / fixture</option>
                  <option value="pilot">Pilot</option>
                  <option value="study">Study</option>
                </Select>
              </Field>
              {field("scenario.version", "Scenario version")}
              {field("scenario.datasetId", "Dataset identifier")}
              {field("scenario.datasetVersion", "Dataset version")}
              {field(
                "scenario.datasetSeed",
                "Dataset seed",
                undefined,
                "number",
              )}
              <div className="full">
                {field(
                  "scenario.task",
                  "Task",
                  "This supported scenario supplies the task; it is frozen at launch.",
                  "textarea",
                )}
              </div>
              <div className="full">
                {field("scenario.policy", "Policy", undefined, "textarea")}
              </div>
              <Field
                label="Research notes"
                className="full"
                hint="Draft metadata only; these notes are not delivered to agents."
              >
                <Textarea
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    launchKey.current = crypto.randomUUID();
                    setDirty(true);
                  }}
                />
              </Field>
              <div className="full">
                <h3>Scenario assets</h3>
                <p className="helper">
                  Synthetic fixture fields are editable below. Structured
                  scenario assets are retained and require a supported scenario
                  form.
                </p>
              </div>
              {primitiveAssets ? (
                primitiveAssets.map(([key, value]) => (
                  <Field key={key} label={key}>
                    {typeof value === "string" || typeof value === "number" ? (
                      <Input
                        type={typeof value === "number" ? "number" : "text"}
                        value={value}
                        onChange={(e) =>
                          change("scenario.assets", {
                            ...(config.scenario.assets as Record<string, Json>),
                            [key]:
                              typeof value === "number"
                                ? e.target.valueAsNumber
                                : e.target.value,
                          })
                        }
                      />
                    ) : typeof value === "boolean" ? (
                      <Select
                        value={String(value)}
                        onChange={(e) =>
                          change("scenario.assets", {
                            ...(config.scenario.assets as Record<string, Json>),
                            [key]: e.target.value === "true",
                          })
                        }
                      >
                        <option>true</option>
                        <option>false</option>
                      </Select>
                    ) : (
                      <Notice kind="warning">
                        Unsupported structured asset field. Preserved in
                        configuration: {key}.
                      </Notice>
                    )}
                  </Field>
                ))
              ) : (
                <Notice kind="warning">
                  This scenario uses a structured asset schema without a
                  registered editor. Existing assets are preserved; choose a
                  supported scenario draft to change them.
                </Notice>
              )}
            </div>
          </Card>
          <Card className="form-section">
            <CardHeading
              title="Agents & shared model"
              description="All roles use this model. Provider credentials stay on the server."
            />
            <div className="card-body form-grid">
              {field(
                "model.provider",
                "Model provider",
                "For example openai, anthropic, or scripted",
              )}
              {field(
                "model.id",
                "Exact model identifier",
                "Scripted models are clearly marked as fixtures.",
              )}
              {supportedSettings.map((key) => (
                <Field
                  key={key}
                  label={key}
                  hint="Optional; leave blank to use the provider default."
                >
                  <Input
                    type="number"
                    step="any"
                    value={
                      typeof config.model.settings[key] === "number"
                        ? config.model.settings[key]
                        : ""
                    }
                    onChange={(e) => {
                      const settings = { ...config.model.settings };
                      if (e.target.value === "") delete settings[key];
                      else settings[key] = e.target.valueAsNumber;
                      change("model.settings", settings);
                    }}
                  />
                </Field>
              ))}
              {Object.keys(config.model.settings)
                .filter((key) => !supportedSettings.includes(key))
                .map((key) => (
                  <Notice key={key} kind="warning">
                    The saved {key} setting is preserved, but its structured
                    editor is unavailable.
                  </Notice>
                ))}
              <div className="full">
                <hr className="section-divider" />
                {config.roles.map((role, index) => (
                  <div className="form-section" key={index}>
                    <div
                      className="actions"
                      style={{
                        justifyContent: "space-between",
                        marginBottom: 12,
                      }}
                    >
                      <h3>Role {index + 1}</h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={config.roles.length < 2}
                        onClick={() => {
                          change(
                            "roles",
                            config.roles.filter((_, i) => i !== index),
                          );
                        }}
                      >
                        Remove role
                      </Button>
                    </div>
                    <div className="form-grid">
                      {field(`roles.${index}.id`, "Role identifier")}
                      <div className="full">
                        {field(
                          `roles.${index}.instructions`,
                          "Role instructions",
                          undefined,
                          "textarea",
                        )}
                      </div>
                      <div className="full">
                        <span className="helper">Allowed tools</span>
                        <div className="form-grid three">
                          {[...new Set([...tools, ...role.allowedTools])].map(
                            (tool) => (
                              <Check
                                key={tool}
                                label={tool}
                                checked={role.allowedTools.includes(tool)}
                                onChange={(e) =>
                                  change(
                                    `roles.${index}.allowedTools`,
                                    e.target.checked
                                      ? [...role.allowedTools, tool]
                                      : role.allowedTools.filter(
                                          (t) => t !== tool,
                                        ),
                                  )
                                }
                              />
                            ),
                          )}
                        </div>
                      </div>
                    </div>
                    <hr className="section-divider" />
                  </div>
                ))}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    change("roles", [
                      ...config.roles,
                      {
                        id: "agent-" + (config.roles.length + 1),
                        instructions:
                          "Complete the assigned task using your own context.",
                        allowedTools: [...tools],
                      },
                    ])
                  }
                >
                  <Plus size={14} />
                  Add role
                </Button>
              </div>
            </div>
          </Card>
          <Card className="form-section">
            <CardHeading
              title="Execution & limits"
              description="An admitted tool call consumes one turn-budget unit, including board, memory, and end_turn."
            />
            <div className="card-body form-grid three">
              {field(
                "scheduler.rounds",
                "Fixed rounds",
                undefined,
                "number",
                1,
              )}
              {field(
                "scheduler.toolCallsPerTurn",
                "Admitted tool calls / turn",
                undefined,
                "number",
                1,
              )}
              {field(
                "scheduler.seed",
                "Agent-order & pairing seed",
                undefined,
                "number",
              )}
              {field(
                "limits.requestTimeoutMs",
                "Request timeout (ms)",
                undefined,
                "number",
                1,
              )}
              {field(
                "limits.maxModelStepsPerTurn",
                "Model steps / turn",
                undefined,
                "number",
                1,
              )}
              {field(
                "limits.maxDurationMs",
                "Maximum run duration (ms)",
                undefined,
                "number",
                1,
              )}
              <p className="helper full">
                One final report call per agent. Automatic retries are disabled.
                Classification steps used by Jev are a separate unit.
              </p>
            </div>
          </Card>
          <Card className="form-section">
            <CardHeading
              title="Board & private memory"
              description="Single chronological board; private conversation and working memory remain agent scoped."
            />
            <div className="card-body form-grid three">
              {field(
                "board.defaultPageSize",
                "Latest posts by default",
                undefined,
                "number",
                1,
              )}
              {field(
                "board.maxPageSize",
                "Maximum board page size",
                undefined,
                "number",
                1,
              )}
              {field(
                "board.maxPostLength",
                "Post limit (characters)",
                undefined,
                "number",
                1,
              )}
              {field(
                "memory.contextBudget",
                "Memory context budget (characters)",
                "Character bound, not a token limit.",
                "number",
                1,
              )}
              {field("memory.version", "Memory template version")}
              <div className="full">
                {field(
                  "memory.template",
                  "Private working-memory template",
                  undefined,
                  "textarea",
                )}
              </div>
              <p className="helper full">
                Thread-isolated private memory. Semantic recall and
                observational memory are disabled by the supported backend.
              </p>
            </div>
          </Card>
          <Card className="form-section">
            <CardHeading title="Final artifact & reports" />
            <div className="card-body form-grid">
              {field("artifactSchemaVersion", "Artifact schema version")}
              {field("reportSchemaVersion", "Report schema version")}
              <div className="full">
                {field(
                  "reportInstructions",
                  "Reporting instructions",
                  undefined,
                  "textarea",
                )}
              </div>
            </div>
          </Card>
        </div>
        <aside className="stack sticky">
          <Card>
            <CardHeading
              title="Launch review"
              description="One matched pair per submission"
            />
            <div className="card-body">
              <dl className="definition-list">
                <dt>Scenario</dt>
                <dd>{config.scenario.version}</dd>
                <dt>Model</dt>
                <dd>
                  {config.model.provider} / {config.model.id}
                </dd>
                <dt>Roles</dt>
                <dd>{config.roles.map((r) => r.id).join(", ")}</dd>
                <dt>Rounds</dt>
                <dd>
                  {config.scheduler.rounds} ×{" "}
                  {config.scheduler.toolCallsPerTurn} calls / turn
                </dd>
                <dt>Designation</dt>
                <dd>
                  <Badge>{config.phase}</Badge>
                </dd>
                <dt>Queue</dt>
                <dd>Single experiment worker</dd>
              </dl>
              <hr className="section-divider" />
              <div className="stack" style={{ gap: 10 }}>
                <div>
                  <Badge>Reviewed board</Badge>
                  <p className="helper">
                    Messages are included in routine operator review.
                  </p>
                </div>
                <div>
                  <Badge>Excluded board</Badge>
                  <p className="helper">
                    Messages are excluded from routine operator review.
                  </p>
                </div>
                <p className="helper">
                  Only condition wording changes. Both runs retain the full
                  researcher recording. The server verifies all other fields
                  match.
                </p>
              </div>
              <hr className="section-divider" />
              {launchReview ? (
                <>
                  <Notice kind="success">
                    <CheckCircle2 size={14} /> Valid configuration. Launch
                    freezes two runs.
                  </Notice>
                  <Button
                    disabled={mutation.busy}
                    onClick={launch}
                    style={{ width: "100%" }}
                  >
                    <Send size={14} />
                    {mutation.busy ? "Submitting…" : "Launch matched pair"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setLaunchReview(false)}
                    style={{ width: "100%", marginTop: 7 }}
                  >
                    Back to editing
                  </Button>
                </>
              ) : (
                <Button
                  disabled={mutation.busy}
                  onClick={validate}
                  style={{ width: "100%" }}
                >
                  <CheckCircle2 size={15} />
                  Validate & review launch
                </Button>
              )}
              <p className="helper" style={{ marginTop: 12 }}>
                Reusing this submission after a network error returns the same
                pair. Edits create a new launch request.
              </p>
            </div>
          </Card>
          <Card>
            <CardHeading
              title="Saved drafts"
              actions={
                <Button
                  aria-label="Start a new draft"
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    setConfig(structuredClone(defaults.data!));
                    setDraft(undefined);
                    setDirty(false);
                    setValidation(undefined);
                    setLaunchReview(false);
                    navigate("/experiments");
                  }}
                >
                  <Plus size={16} />
                </Button>
              }
            />
            {drafts.loading ? (
              <Loading />
            ) : drafts.error ? (
              <ErrorState error={drafts.error} retry={drafts.refresh} />
            ) : drafts.data?.length ? (
              drafts.data.map((item) => (
                <button
                  className={
                    "list-button " + (draft?.id === item.id ? "selected" : "")
                  }
                  key={item.id}
                  onClick={() => load(item)}
                >
                  <div>
                    <strong>{item.config?.label || item.id}</strong>
                    <small>
                      {when(item.updatedAt)} · r{item.revision ?? 1}
                    </small>
                  </div>
                </button>
              ))
            ) : (
              <p className="helper card-body">
                Save your configuration to share a draft.
              </p>
            )}
            {draft && (
              <div className="card-body actions" style={{ paddingTop: 15 }}>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={duplicate}
                  disabled={mutation.busy}
                >
                  <Copy size={13} />
                  Duplicate draft
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft(undefined);
                    setDirty(true);
                  }}
                >
                  Save as new
                </Button>
              </div>
            )}
          </Card>
          {schema.error && (
            <Notice kind="warning">
              Configuration schema is unavailable. The backend still validates
              every save and launch.
            </Notice>
          )}
        </aside>
      </div>
    </>
  );
}
