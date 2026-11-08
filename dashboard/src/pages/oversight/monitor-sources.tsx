import type { ChangeEvent } from "react";
import {
  Button,
  Card,
  CardHeading,
  ErrorState,
  Field,
  Input,
  Loading,
  Pager,
  Select,
} from "../../components/ui";
import type { Run } from "../../lib/types";
import { short, when } from "../../lib/utils";
import type { useMonitorSetup } from "./use-monitor-setup";

type Setup = ReturnType<typeof useMonitorSetup>;
type RunExtras = { updatedAt?: string; createdAt?: string; config: { model?: { id?: string }; roles?: unknown[] } };

/** A source run as one row: checkbox, name and id, the condition as a single lane, updated. */
function SourceRow({ run, checked, onChange }: { run: Run; checked: boolean; onChange: (checked: boolean) => void }) {
  const extras = run as unknown as RunExtras;
  const condition = run.config.condition.id;
  const rounds = run.config.scheduler?.rounds;
  const turnsPerRound = extras.config.roles?.length;
  const total = rounds && turnsPerRound ? rounds * turnsPerRound : undefined;
  const share = total && run.turn !== undefined ? Math.min(1, run.turn / total) : rounds && run.round !== undefined ? Math.min(1, run.round / rounds) : 1;
  const stamp = extras.updatedAt ?? extras.createdAt;
  const model = extras.config.model?.id;
  return (
    <label
      className="trow source-row"
      style={{ gridTemplateColumns: "20px minmax(0, 1fr) minmax(150px, 220px) auto", cursor: "pointer", background: checked ? "var(--subtle)" : undefined }}
    >
      <input
        type="checkbox"
        aria-label={`${run.config.label} · ${condition} · ${short(run.id)}`}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 500 }}>{run.config.label}</span>
        <span className="small muted">
          {model ? `${model} · ` : ""}
          <span className="mono">{short(run.id)}</span>
        </span>
      </span>
      <span className={"lane" + (condition === "excluded" ? " excluded" : "")} style={{ gridTemplateColumns: "72px minmax(0, 1fr) 56px" }}>
        <span className="cond">{condition}</span>
        <span className="track" aria-hidden="true"><i style={{ width: `${Math.round(share * 100)}%` }} /></span>
        <span className="prog">{run.round !== undefined || run.turn !== undefined ? `R${run.round ?? 0} · T${run.turn ?? 0}` : "—"}</span>
      </span>
      <span className="small muted nowrap">{stamp ? when(stamp) : ""}</span>
    </label>
  );
}

/** Source-run selection: only completed runs are eligible. */
export function SourceRunsCard({ setup }: { setup: Setup }) {
  const { runs, selected } = setup;
  const total = (runs as { total?: number }).total;
  return (
    <Card>
      <CardHeading
        title="Source runs"
        count={`${selected.length} selected`}
        description="Only completed runs can be evaluated. Each selected run gets four isolated monitor calls."
        ruled
      />
      <div>
        <div className="small muted" style={{ padding: "8px var(--card-pad) 0" }}>Completed source runs</div>
        {runs.loading ? (
          <Loading />
        ) : runs.error ? (
          <ErrorState error={runs.error} retry={runs.refresh} />
        ) : runs.data.length ? (
          runs.data.map((run: Run) => (
            <SourceRow key={run.id} run={run} checked={selected.includes(run.id)} onChange={(c) => setup.selectRun(run.id, c)} />
          ))
        ) : (
          <p className="helper" style={{ padding: "8px var(--card-pad) 16px" }}>No completed source runs yet.</p>
        )}
        {(runs.page > 0 || runs.hasMore) && <Pager page={runs.page} hasMore={runs.hasMore} onChange={runs.onChange} />}
      </div>
      <div className="card-foot">
        <span>
          {typeof total === "number" ? total : runs.data.length} eligible completed runs · cancelled and failed runs are not eligible
        </span>
        {selected.length > 0 && (
          <span className="small">
            Selected:{" "}
            {selected.map((id) => (
              <span key={id} className="mono">
                {short(id)}{" "}
                <Button size="sm" variant="ghost" aria-label={"Remove source " + id} onClick={() => setup.removeRun(id)}>
                  Remove
                </Button>
              </span>
            ))}
          </span>
        )}
      </div>
    </Card>
  );
}

/** The monitor model and its limits, chosen explicitly and never inherited from the source run. */
export function MonitorCard({ setup }: { setup: Setup }) {
  const { history, settings, change } = setup;
  const option = (key: string) => ({
    type: "number" as const,
    step: "any",
    placeholder: key === "seed" ? "none" : "provider default",
    value: typeof settings.model.settings[key] === "number" ? (settings.model.settings[key] as number) : "",
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const options = { ...settings.model.settings };
      if (e.target.value === "") delete options[key];
      else options[key] = e.target.valueAsNumber;
      change({ model: { ...settings.model, settings: options } });
    },
  });
  return (
    <Card>
      <CardHeading title="Monitor" description="Chosen explicitly, never inherited from the source run's model." ruled />
      <div className="card-body" style={{ paddingTop: 16, display: "grid", gap: 16 }}>
        <div className="two">
          <Field required label="Monitor provider">
            <Input
              value={settings.model.provider}
              onChange={(e) => change({ model: { ...settings.model, provider: e.target.value } })}
              placeholder="openai, anthropic or adaption"
            />
          </Field>
          <Field required label="Monitor model">
            <Input
              value={settings.model.id}
              onChange={(e) => change({ model: { ...settings.model, id: e.target.value } })}
              placeholder="Exact model identifier"
            />
          </Field>
        </div>
        <div className="three">
          <Field label="Temperature (optional)"><Input {...option("temperature")} /></Field>
          <Field label="Top-p (optional)"><Input {...option("topP")} /></Field>
          <Field label="Sampling seed (optional)"><Input {...option("seed")} /></Field>
        </div>
        <div className="three">
          <Field label="Context window" hint="tokens">
            <Input type="number" min="1" value={settings.contextWindowTokens} onChange={(e) => change({ contextWindowTokens: e.target.valueAsNumber })} />
          </Field>
          <Field label="Output allowance" hint="tokens">
            <Input type="number" min="1" value={settings.outputAllowanceTokens} onChange={(e) => change({ outputAllowanceTokens: e.target.valueAsNumber })} />
          </Field>
          <Field label="Per-view timeout" hint="seconds · stored exactly in milliseconds">
            <Input type="number" min="0.001" step="0.001" value={settings.timeoutMs / 1000} onChange={(e) => change({ timeoutMs: e.target.valueAsNumber * 1000 })} />
          </Field>
        </div>
        <div className="two">
          <Field label="Definition revision" required hint="Frozen at launch and shared across the four views.">
            <Select
              aria-label="Definition revision"
              value={setup.definitionRevision}
              onChange={(e) => setup.selectDefinitionRevision(Number(e.target.value))}
            >
              {history.items.map((item) => (
                <option key={item.id} value={item.revision}>
                  Revision {item.revision} · {when(item.createdAt)} · {item.outcomes.filter((o) => !o.archived).length} outcomes
                </option>
              ))}
              {!history.items.some((item) => item.revision === setup.definitionRevision) && (
                <option value={setup.definitionRevision}>Revision {setup.definitionRevision} (selected)</option>
              )}
            </Select>
            {history.error && <ErrorState error={history.error} retry={history.refresh} />}
            {(history.page > 0 || history.hasMore) && <Pager page={history.page} hasMore={history.hasMore} onChange={history.onChange} />}
          </Field>
          <Field label="Maximum serialized input" hint="characters · evidence past this is cut and recorded as cut">
            <Input type="number" min="1" value={settings.maxInputChars} onChange={(e) => change({ maxInputChars: e.target.valueAsNumber })} />
          </Field>
        </div>
      </div>
    </Card>
  );
}
