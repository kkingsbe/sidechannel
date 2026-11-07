import {
  Button,
  Card,
  CardHeading,
  Check,
  ErrorState,
  Field,
  Input,
  Loading,
  Pager,
  Select,
} from "../../components/ui";
import type { MonitorSettings } from "@sidechannel/contracts/browser";
import type { Run } from "../../lib/types";
import { short, when } from "../../lib/utils";
import type { useMonitorSetup } from "./use-monitor-setup";

/** Source-run selection and the explicitly independent monitor configuration. */
export function MonitorConfigCard({
  setup,
}: {
  setup: ReturnType<typeof useMonitorSetup>;
}) {
  const { history, runs, selected, settings, change } = setup;
  return (
    <Card className="form-section">
      <CardHeading
        title="Source runs & monitor configuration"
        description="Monitor selection is independent from experiment models and Jev."
      />
      <div className="card-body form-grid">
        <Field label="Definition revision" required>
          <Select
            aria-label="Definition revision"
            value={setup.definitionRevision}
            onChange={(e) =>
              setup.selectDefinitionRevision(Number(e.target.value))
            }
          >
            {history.items.map((item) => (
              <option key={item.id} value={item.revision}>
                Revision {item.revision} · {when(item.createdAt)}
              </option>
            ))}
            {!history.items.some(
              (item) => item.revision === setup.definitionRevision,
            ) && (
              <option value={setup.definitionRevision}>
                Revision {setup.definitionRevision} (selected)
              </option>
            )}
          </Select>
          {history.error && (
            <ErrorState error={history.error} retry={history.refresh} />
          )}
          <Pager
            page={history.page}
            hasMore={history.hasMore}
            onChange={history.onChange}
          />
        </Field>
        <div>
          <span className="helper">Completed source runs</span>
          <div style={{ maxHeight: 210, overflow: "auto", marginTop: 8 }}>
            {runs.loading ? (
              <Loading />
            ) : runs.error ? (
              <ErrorState error={runs.error} retry={runs.refresh} />
            ) : runs.data.length ? (
              runs.data.map((run: Run) => (
                <Check
                  key={run.id}
                  label={`${run.config.label} · ${run.config.condition.id} · ${short(run.id)}`}
                  checked={selected.includes(run.id)}
                  onChange={(e) => setup.selectRun(run.id, e.target.checked)}
                />
              ))
            ) : (
              <p className="helper">No completed source runs yet.</p>
            )}
          </div>
          <Pager page={runs.page} hasMore={runs.hasMore} onChange={runs.onChange} />
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
                    onClick={() => setup.removeRun(id)}
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
                model: { ...settings.model, provider: e.target.value },
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
              change({ model: { ...settings.model, id: e.target.value } })
            }
            placeholder="Exact model identifier"
          />
        </Field>
        {["temperature", "maxOutputTokens", "topP", "seed"].map((key) => (
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
                change({ model: { ...settings.model, settings: options } });
              }}
            />
          </Field>
        ))}
        <Field
          label="Model context window (tokens)"
          hint="Complete instructions, evidence, and output allowance are preflighted."
        >
          <Input
            type="number"
            min="1"
            value={settings.contextWindowTokens}
            onChange={(e) =>
              change({ contextWindowTokens: e.target.valueAsNumber })
            }
          />
        </Field>
        <Field label="Output allowance (tokens)">
          <Input
            type="number"
            min="1"
            value={settings.outputAllowanceTokens}
            onChange={(e) =>
              change({ outputAllowanceTokens: e.target.valueAsNumber })
            }
          />
        </Field>
        <Field label="Maximum serialized input (characters)">
          <Input
            type="number"
            min="1"
            value={settings.maxInputChars}
            onChange={(e) => change({ maxInputChars: e.target.valueAsNumber })}
          />
        </Field>
        <Field label="Per-view timeout (seconds)" hint="Stored exactly in milliseconds.">
          <Input
            type="number"
            min="0.001"
            step="0.001"
            value={settings.timeoutMs / 1000}
            onChange={(e) => change({ timeoutMs: e.target.valueAsNumber * 1000 })}
          />
        </Field>
      </div>
    </Card>
  );
}
