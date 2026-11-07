import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
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
import {
  DURATION_WARNING_MS,
  MAX_DURATION_MS,
  configFingerprint,
  humanDuration,
  humanizeError,
  localFieldErrors,
  readSessionLaunches,
  recordSessionLaunch,
  runBudget,
  type SessionLaunch,
} from "../lib/experiment-form";
import "./Experiments.css";
import { HealthcarePreset } from "../components/healthcare-preset";
import { ModelControls } from "../components/model-controls";
import { BudgetSummary } from "../components/budget-summary";
const readableName = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
const focusField = (path: string) => {
  const control = document.querySelector<HTMLElement>(
    `[data-config-path="${path}"]`,
  );
  let parent = control?.parentElement;
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
  control?.focus();
};
type DraftMeta = Draft & { name?: string; notes?: string; lineage?: unknown };
const blankConfig = (value: ExperimentConfig): ExperimentConfig => ({
  ...structuredClone(value),
  label: "",
});
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const normalize = (result: Validation): Validation => {
  const raw = result.fieldErrors ?? {};
  const rawMessages = new Set(Object.values(raw));
  const fieldErrors = Object.fromEntries(
    Object.entries(raw).map(([path, message]) => [
      path,
      humanizeError(message, path),
    ]),
  );
  const shown = new Set(Object.values(fieldErrors));
  const errors = [
    ...new Set(
      (result.errors || [])
        .filter((error) => !rawMessages.has(error))
        .map((error) => humanizeError(error)),
    ),
  ].filter((error) => !shown.has(error));
  return { ...result, fieldErrors, errors };
};
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
  const location = useLocation();
  const editing =
    location.pathname.endsWith("/new") ||
    params.has("draft") ||
    params.has("recover");
  const localRecovery = localStorage.getItem("sidechannel-experiment-draft");
  const [config, setConfig] = useState<ExperimentConfig>();
  const [draft, setDraft] = useState<Draft>();
  const [draftError, setDraftError] = useState<Error>();
  const [validation, setValidation] = useState<Validation>();
  const [dirty, setDirty] = useState(false);
  const [launchReview, setLaunchReview] = useState(false);
  const [savedLocal, setSavedLocal] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [touched, setTouched] = useState<string[]>([]);
  const [launchedNow, setLaunchedNow] = useState<SessionLaunch>();
  const [sessionLaunches, setSessionLaunches] = useState(readSessionLaunches);
  const [pendingLeave, setPendingLeave] = useState<string>();
  const [notes, setNotes] = useState("");
  const mutation = useMutation();
  const launchKey = useRef(crypto.randomUUID());
  const initializedRoute = useRef("");
  const draftId = useRef<string | undefined>(undefined);
  const live = useMemo(
    () => (config ? localFieldErrors(config) : {}),
    [config],
  );
  const guardActive = dirty && !launchedNow;
  const resetReview = () => {
    setLaunchReview(false);
    setConfirming(false);
  };
  const touch = (path: string) =>
    setTouched((items) => (items.includes(path) ? items : [...items, path]));
  const fieldError = (path: string) =>
    validation?.fieldErrors?.[path] ??
    (touched.includes(path) ? live[path] : undefined);
  useEffect(() => {
    const routeKey = location.pathname + location.search;
    if (!defaults.data || !editing || initializedRoute.current === routeKey)
      return;
    initializedRoute.current = routeKey;
    if (params.has("draft")) return;
    setDraft(undefined);
    draftId.current = undefined;
    setNotes("");
    setDirty(false);
    setSavedLocal(false);
    setValidation(undefined);
    resetReview();
    setTouched([]);
    setLaunchedNow(undefined);
    launchKey.current = crypto.randomUUID();
    const saved = localStorage.getItem("sidechannel-experiment-draft");
    if (saved && params.has("recover") && !params.has("draft")) {
      try {
        const data = JSON.parse(saved);
        setConfig(data.config);
        setDraft(data.draft);
        setNotes((data as Draft & { notes?: string }).notes || "");
        setSavedLocal(true);
        setDirty(true);
        return;
      } catch {
        /* Ignore an invalid local recovery copy. */
      }
    }
    setConfig(blankConfig(defaults.data));
  }, [defaults.data, editing, location.pathname, location.search, params]);
  useEffect(() => {
    const id = params.get("draft");
    if (!id || draftId.current === id) return;
    setDraftError(undefined);
    void api<DraftMeta>("/drafts/" + encodeURIComponent(id))
      .then((data) => {
        // A copy that has never been edited opens as an unsaved "Copy of <name>".
        const copied =
          !!data.lineage &&
          (data.revision ?? 1) <= 1 &&
          !!data.config?.label &&
          !/^Copy of /.test(data.config.label);
        draftId.current = data.id;
        setConfig(
          copied
            ? { ...data.config, label: `Copy of ${data.config.label}` }
            : data.config,
        );
        setDraft(data);
        setNotes(data.notes || "");
        setSavedLocal(false);
        setDirty(copied);
        setTouched([]);
      })
      .catch((error: Error) => setDraftError(error));
  }, [params]);
  useEffect(() => {
    if (config && dirty)
      localStorage.setItem(
        "sidechannel-experiment-draft",
        JSON.stringify({ config, draft, notes }),
      );
  }, [config, draft, dirty, notes]);
  useEffect(() => {
    if (!guardActive) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    // BrowserRouter has no navigation blocker, so in-app links are intercepted here.
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (event.target as Element | null)?.closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== "_self")) return;
      const href = anchor.getAttribute("href") || "";
      if (!href.startsWith("/") || href.startsWith("//")) return;
      if (href === location.pathname + location.search) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingLeave(href);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [guardActive, location.pathname, location.search]);
  const change = (path: string, value: unknown) => {
    if (!config) return;
    setConfig(setAt(config, path, value));
    setDirty(true);
    setValidation(undefined);
    resetReview();
    launchKey.current = crypto.randomUUID();
  };
  const replace = (value: ExperimentConfig) => {
    setConfig(value);
    setDirty(true);
    setValidation(undefined);
    resetReview();
    launchKey.current = crypto.randomUUID();
  };
  const field = (
    path: string,
    label: string,
    hint?: string,
    kind: "text" | "textarea" | "number" = "text",
    min?: number,
    placeholder?: string,
  ) => (
    <Field
      key={path}
      label={label}
      hint={hint}
      error={fieldError(path)}
      required={schema.data?.fields.some(
        (item) => item.path === path && item.required,
      )}
    >
      {kind === "textarea" ? (
        <Textarea
          data-config-path={path}
          value={String(valueAt(config!, path) ?? "")}
          onChange={(e) => change(path, e.target.value)}
          onBlur={() => touch(path)}
        />
      ) : (
        <Input
          data-config-path={path}
          type={kind}
          min={min}
          placeholder={placeholder}
          onBlur={() => touch(path)}
          step={kind === "number" ? 1 : undefined}
          value={
            Number.isNaN(valueAt(config!, path))
              ? ""
              : String(valueAt(config!, path) ?? "")
          }
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
    if (!config) return;
    // A draft always has a name so it is recognisable in the shared list.
    const named = config.label?.trim()
      ? config
      : {
          ...config,
          label: `Untitled draft · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`,
        };
    const result = await mutation.run(
      () =>
        post<Draft>("/drafts", {
          id: draft?.id,
          revision: draft?.revision,
          config: named,
          name: named.label,
          notes,
        }),
      "Draft saved. This does not launch any run.",
    );
    if (result) {
      if (named !== config) setConfig(named);
      setDraft(result);
      launchKey.current = crypto.randomUUID();
      setDirty(false);
      setSavedLocal(false);
      localStorage.removeItem("sidechannel-experiment-draft");
      void drafts.refresh();
      if (params.get("draft") !== result.id) {
        draftId.current = result.id;
        navigate("/experiments?draft=" + encodeURIComponent(result.id), {
          replace: true,
        });
      }
    }
  };
  const validate = async () => {
    const local = localFieldErrors(config!);
    if (Object.keys(local).length) {
      setTouched(Object.keys(local));
      setValidation({ valid: false, errors: [], fieldErrors: local });
      resetReview();
      requestAnimationFrame(() => focusField(Object.keys(local)[0]!));
      return;
    }
    const response = await mutation.run(() =>
      post<Validation>("/config/validate", { config }),
    );
    if (response) {
      const result = normalize(response);
      setValidation(result);
      if (result.valid && result.config) setConfig(result.config);
      setLaunchReview(result.valid);
      setConfirming(false);
      if (!result.valid) {
        const path = Object.keys(result.fieldErrors || {})[0];
        requestAnimationFrame(() =>
          path
            ? focusField(path)
            : document.getElementById("experiment-errors")?.focus(),
        );
      }
    }
  };
  const launch = async () => {
    const sent = config!;
    const result = await mutation.run(() =>
      post<Run[]>("/pairs", {
        config: sent,
        idempotencyKey: launchKey.current,
        pairingSeed: sent.scheduler?.seed,
        ...(!dirty && draft
          ? { sourceDraftId: draft.id, sourceDraftRevision: draft.revision }
          : {}),
      }),
    );
    if (result) {
      const entries = recordSessionLaunch(sent, launchKey.current, result);
      setSessionLaunches(entries);
      resetReview();
      localStorage.removeItem("sidechannel-experiment-draft");
      const pairId = entries[0]?.pairId;
      if (pairId) {
        setDirty(false);
        navigate("/runs/pairs/" + encodeURIComponent(pairId));
      } else setLaunchedNow(entries[0]);
    }
  };
  const configureAnother = () => {
    setLaunchedNow(undefined);
    setValidation(undefined);
    resetReview();
  };
  const startNew = () => {
    setConfig(blankConfig(defaults.data!));
    setDraft(undefined);
    draftId.current = undefined;
    setNotes("");
    setDirty(false);
    setValidation(undefined);
    setTouched([]);
    setLaunchedNow(undefined);
    resetReview();
    launchKey.current = crypto.randomUUID();
    navigate("/experiments/new");
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
    setNotes((item as Draft & { notes?: string }).notes || "");
    setDirty(false);
    setSavedLocal(false);
    setValidation(undefined);
    setTouched([]);
    resetReview();
    launchKey.current = crypto.randomUUID();
    draftId.current = item.id;
    navigate("/experiments?draft=" + item.id);
  };
  const duplicate = async () => {
    if (!draft) return;
    const result = await mutation.run(() =>
      post<Draft>("/drafts/" + draft.id + "/duplicate", {
        name: `Copy of ${config?.label || draft.config?.label || draft.id}`,
      }),
    );
    if (result) {
      launchKey.current = crypto.randomUUID();
      // The draft loader opens a never-edited copy as an unsaved "Copy of <name>".
      draftId.current = undefined;
      void drafts.refresh();
      navigate("/experiments?draft=" + encodeURIComponent(result.id));
    }
  };
  const duration = (path: string, label: string, scale: number) => {
    const ms = Number(valueAt(config!, path));
    const long =
      path === "limits.maxDurationMs" &&
      ms > DURATION_WARNING_MS &&
      ms <= MAX_DURATION_MS;
    return (
      <Field
        label={label}
        error={fieldError(path)}
        hint={
          long ? (
            <span className="field-warning">
              About {humanDuration(ms)}. Runs this long spend more model budget;
              the limit is 24 hours.
            </span>
          ) : undefined
        }
      >
        <Input
          data-config-path={path}
          type="number"
          step="any"
          min={1 / scale}
          value={Number.isFinite(ms) ? ms / scale : ""}
          onBlur={() => touch(path)}
          onChange={(event) =>
            change(path, Math.round(event.target.valueAsNumber * scale))
          }
        />
      </Field>
    );
  };
  if (!editing)
    return (
      <>
        <PageHeader
          title="Experiments"
          description="Resume a shared configuration or create a matched pair."
          actions={
            <Button asChild>
              <Link to="/experiments/new">
                <Plus size={15} />
                New experiment
              </Link>
            </Button>
          }
        />
        {localRecovery && (
          <Card>
            <CardHeading
              title="Local recovery"
              description="Unsaved edits in this browser only. Shared drafts are listed separately."
            />
            <div className="card-body">
              <Button asChild variant="secondary">
                <Link to="/experiments/new?recover=1">Recover local edits</Link>
              </Button>
            </div>
          </Card>
        )}
        <Card>
          <CardHeading
            title="Shared saved drafts"
            description="Saved configurations available to collaborators; saving does not launch runs."
          />
          {drafts.loading ? (
            <Loading />
          ) : drafts.error ? (
            <ErrorState error={drafts.error} retry={drafts.refresh} />
          ) : drafts.data?.length ? (
            drafts.data.map((item) => (
              <Link
                className="list-button"
                key={item.id}
                to={"/experiments?draft=" + encodeURIComponent(item.id)}
              >
                <div>
                  <strong>{item.config?.label || item.id}</strong>
                  <small>
                    {when(item.updatedAt)} · revision {item.revision ?? 1}
                  </small>
                </div>
              </Link>
            ))
          ) : (
            <p className="card-body">
              No shared drafts yet. Create an experiment to begin.
            </p>
          )}
        </Card>
      </>
    );
  if (draftError)
    return (
      <>
        <Link to="/experiments">All experiments</Link>
        <ErrorState error={draftError} />
      </>
    );
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
                onClick={startNew}
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
  const valid = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 1
      ? value.toLocaleString()
      : "—";
  const budget = runBudget(config);
  const fingerprint = configFingerprint(config);
  const previousLaunches = sessionLaunches.filter(
    (item) => item.at !== launchedNow?.at,
  );
  const nearIdentical = sessionLaunches.find(
    (item) => item.fingerprint === fingerprint && item.key !== launchKey.current,
  );
  return (
    <>
      <Link to="/experiments">All experiments</Link>
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
            <Button
              variant="secondary"
              disabled={mutation.busy || !!launchedNow}
              onClick={save}
            >
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
          <strong id="experiment-errors" tabIndex={-1}>
            Configuration needs attention
          </strong>
          {Object.entries(validation.fieldErrors || {}).map(([path, error]) => (
            <p key={path}>
              <button
                className="experiment-error-link"
                onClick={() => focusField(path)}
              >
                {error}
              </button>
            </p>
          ))}
          {validation.errors.length > 0 && (
            <ul>
              {validation.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}
      {pendingLeave && (
        <div
          className="leave-guard-backdrop"
          onKeyDown={(event) => {
            if (event.key === "Escape") setPendingLeave(undefined);
          }}
        >
          <div
            className="card leave-guard"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="leave-guard-title"
          >
            <h2 id="leave-guard-title">Leave without saving?</h2>
            <p>
              Your edits are not saved to the shared draft list. A recovery copy
              stays in this browser until you launch or start over.
            </p>
            <div className="actions">
              <Button autoFocus onClick={() => setPendingLeave(undefined)}>
                Keep editing
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const target = pendingLeave;
                  setPendingLeave(undefined);
                  navigate(target);
                }}
              >
                Leave and discard
              </Button>
            </div>
          </div>
        </div>
      )}
      <div className="editor-layout">
        <fieldset className="form-lock" disabled={!!launchedNow}>
          <Card className="form-section">
            <CardHeading
              title="Scenario & data"
              description="Versioned scenario and study metadata"
            />
            <div className="card-body form-grid">
              <HealthcarePreset
                config={config}
                replace={replace}
                errors={validation?.fieldErrors}
              />
              {field(
                "label",
                "Experiment name",
                undefined,
                "text",
                undefined,
                "Name this experiment, e.g. Pilot · reviewed vs excluded",
              )}
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
              {config.scenario.version !== "healthcare-points-v0.3" && (
                <>
                  {field("scenario.datasetId", "Dataset identifier")}
                  {field("scenario.datasetVersion", "Dataset version")}
                  {field(
                    "scenario.datasetSeed",
                    "Dataset seed",
                    undefined,
                    "number",
                  )}
                </>
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
              {config.scenario.version !== "healthcare-points-v0.3" && (
                <>
                  <div className="full">
                    <h3>Scenario assets</h3>
                    <p className="helper">
                      Synthetic fixture fields are editable below. Structured
                      scenario assets are retained and require a supported
                      scenario form.
                    </p>
                  </div>
                  {primitiveAssets ? (
                    primitiveAssets.map(([key, value]) => (
                      <Field key={key} label={readableName(key)}>
                        {typeof value === "string" ||
                        typeof value === "number" ? (
                          <Input
                            type={typeof value === "number" ? "number" : "text"}
                            value={value}
                            onChange={(e) =>
                              change("scenario.assets", {
                                ...(config.scenario.assets as Record<
                                  string,
                                  Json
                                >),
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
                                ...(config.scenario.assets as Record<
                                  string,
                                  Json
                                >),
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
                </>
              )}
            </div>
          </Card>
          <Card className="form-section">
            <CardHeading
              title="Agents & shared model"
              description="All roles use this model. Provider credentials stay on the server."
            />
            <div className="card-body form-grid">
              {config.scenario.version === "healthcare-points-v0.3" ? (
                <ModelControls
                  config={config}
                  replace={replace}
                  errors={validation?.fieldErrors}
                />
              ) : (
                <>
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
                </>
              )}
              <details className="full experiment-details">
                <summary>Advanced model parameters</summary>
                <div className="form-grid">
                  {supportedSettings
                    .filter(
                      (key) => key !== "maxOutputTokens" || !config.tokenBudget,
                    )
                    .map((key) => (
                      <Field
                        key={key}
                        label={readableName(key)}
                        hint="Optional; leave blank to use the provider default."
                        error={
                          validation?.fieldErrors?.[`model.settings.${key}`]
                        }
                      >
                        <Input
                          data-config-path={`model.settings.${key}`}
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
                </div>
              </details>
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
                                label={readableName(tool)}
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
              {duration(
                "limits.requestTimeoutMs",
                "Request timeout (seconds)",
                1000,
              )}
              {field(
                "limits.maxModelStepsPerTurn",
                "Model steps / turn",
                undefined,
                "number",
                1,
              )}
              {duration(
                "limits.maxDurationMs",
                "Maximum run duration (minutes)",
                60000,
              )}
              <p className="helper full">
                One final report call per agent. Automatic retries are disabled.
                Classification steps used by Jev are a separate unit.
              </p>
            </div>
          </Card>
          <details className="experiment-details form-section">
            <summary>Advanced board & private memory</summary>
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
                {!config.tokenBudget &&
                  field(
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
          </details>
          <details className="experiment-details form-section">
            <summary>Artifact & report settings</summary>
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
          </details>
        </fieldset>
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
                <dt>Dataset</dt>
                <dd>
                  {config.scenario.datasetId} · v
                  {config.scenario.datasetVersion}
                </dd>
                <dt>Configuration version</dt>
                <dd>{config.configVersion}</dd>
                <dt>Model</dt>
                <dd>
                  {config.model.provider} / {config.model.id}
                </dd>
                <dt>Roles</dt>
                <dd>{config.roles.map((r) => r.id).join(", ")}</dd>
                <BudgetSummary config={config} />
                <dt>Rounds</dt>
                <dd>
                  {valid(config.scheduler.rounds)} ×{" "}
                  {valid(config.scheduler.toolCallsPerTurn)} calls / turn
                </dd>
                <dt>Maximum duration</dt>
                <dd>
                  {valid(config.limits.maxDurationMs) === "—" ||
                  config.limits.maxDurationMs > MAX_DURATION_MS
                    ? "—"
                    : humanDuration(config.limits.maxDurationMs)}{" "}
                  per run
                </dd>
                <dt>Budget per run</dt>
                <dd>
                  {budget
                    ? `Up to ${budget.toolCalls.toLocaleString()} admitted tool calls and ${budget.modelSteps.toLocaleString()} model steps`
                    : "—"}
                </dd>
                <dt>Designation</dt>
                <dd>
                  <Badge>{config.phase}</Badge>
                </dd>
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
              {launchedNow && !launchedNow.pairId ? (
                <div className="stack" style={{ gap: 10 }}>
                  <Notice kind="success">
                    <strong>Matched pair queued</strong>
                    <p>
                      The configuration is frozen. Runs execute independently of
                      this browser.
                    </p>
                    <div className="actions">
                      {launchedNow.runs.map((run) => (
                        <Button
                          asChild
                          size="sm"
                          variant="secondary"
                          key={run.id}
                        >
                          <Link to={"/runs/" + run.id}>
                            {run.condition} · {run.id.slice(0, 12)}
                          </Link>
                        </Button>
                      ))}
                    </div>
                  </Notice>
                  <Button
                    variant="secondary"
                    onClick={configureAnother}
                    style={{ width: "100%" }}
                  >
                    Configure another
                  </Button>
                </div>
              ) : launchReview && confirming ? (
                <div className="stack" role="group" aria-label="Confirm launch">
                  <strong>Start 2 runs now?</strong>
                  <dl className="definition-list">
                    <dt>Runs</dt>
                    <dd>2 (reviewed board + excluded board)</dd>
                    <dt>Model</dt>
                    <dd>
                      {config.model.provider} / {config.model.id}
                    </dd>
                    <dt>Per run</dt>
                    <dd>
                      {budget
                        ? `${budget.rounds} rounds × ${budget.calls} admitted tool calls / turn × ${budget.agents} agents`
                        : "—"}
                    </dd>
                    <dt>Model steps / turn</dt>
                    <dd>{valid(config.limits.maxModelStepsPerTurn)}</dd>
                    <dt>Max duration</dt>
                    <dd>
                      {humanDuration(config.limits.maxDurationMs)} per run
                    </dd>
                  </dl>
                  {config.model.provider !== "scripted" && (
                    <p className="helper">
                      This spends real model budget on the live stack. Runs
                      continue even if you close this page.
                    </p>
                  )}
                  {nearIdentical && (
                    <Notice kind="warning">
                      You launched a near-identical pair at{" "}
                      {timeOf(nearIdentical.at)}
                      {nearIdentical.label === config.label
                        ? " with the same name"
                        : ` as “${nearIdentical.label}”`}
                      . Only the name or notes differ, so this starts two more
                      runs.{" "}
                      {nearIdentical.pairId && (
                        <Link to={"/runs/pairs/" + nearIdentical.pairId}>
                          View that pair
                        </Link>
                      )}
                    </Notice>
                  )}
                  <Button
                    disabled={mutation.busy}
                    onClick={launch}
                    style={{ width: "100%" }}
                  >
                    <Send size={14} />
                    {mutation.busy ? "Submitting…" : "Confirm: start 2 runs"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={mutation.busy}
                    onClick={() => setConfirming(false)}
                    style={{ width: "100%" }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : launchReview ? (
                <>
                  <Notice kind="success">
                    Valid configuration. Launch freezes two runs.
                  </Notice>
                  <Button
                    disabled={mutation.busy}
                    onClick={() => setConfirming(true)}
                    style={{ width: "100%" }}
                  >
                    <Send size={14} />
                    Launch matched pair
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={resetReview}
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
              {!launchReview && !launchedNow && (
                <p className="helper">
                  Launch requires successful validation of the current
                  configuration. Saving a draft is available before validation.
                </p>
              )}
              <p className="helper" style={{ marginTop: 12 }}>
                Reusing this submission after a network error returns the same
                pair. Edits create a new launch request.
              </p>
            </div>
          </Card>
          {previousLaunches.length > 0 && (
            <Card>
              <CardHeading
                title="Launched this session"
                description="Pairs started from this form in this browser session."
              />
              <ul className="launched-list card-body">
                {previousLaunches.map((item) => (
                    <li key={item.at + item.key}>
                      <strong>{item.label || "Untitled"}</strong>
                      <small>{timeOf(item.at)}</small>
                      <span className="actions">
                        {item.pairId && (
                          <Link to={"/runs/pairs/" + item.pairId}>Pair</Link>
                        )}
                        {item.runs.map((run) => (
                          <Link key={run.id} to={"/runs/" + run.id}>
                            {run.condition}
                          </Link>
                        ))}
                      </span>
                    </li>
                  ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeading
              title="Saved drafts"
              actions={
                <Button
                  aria-label="Start a new draft"
                  size="icon"
                  variant="ghost"
                  onClick={startNew}
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
