import { Check, Field, Input } from "../../components/ui";
import { evidenceCategories as categories } from "../../lib/analysis-types";
import type { AnalysisSetupState } from "./analysis-setup";
import { categoryLabels, plural } from "./analysis-view";

/** Source steps as a strip: the first window is dark, the next window starts one advance later. */
function StepStrip({ size, stride }: { size: number; stride: number }) {
  const valid = Number.isFinite(size) && Number.isFinite(stride) && size >= 1 && stride >= 1;
  const count = valid ? Math.min(40, Math.max(6, size + stride * 2)) : 12;
  return (
    <div>
      <div className="strip an-steps" role="img" aria-label="Illustration of source steps and stride">
        {Array.from({ length: count }, (_, i) => (
          <i key={i} className={valid && i < size ? "hi" : ""} />
        ))}
      </div>
      <p className="small muted an-caption">
        {valid
          ? `Windows of ${plural(size, "step")} advance ${plural(stride, "step")}, so each window overlaps the previous by ${Math.max(0, size - stride)}. A classification step is not a tool-call budget unit.`
          : "Enter a window size and advance to see the windows."}
      </p>
    </div>
  );
}

export function WindowingSection({ state }: { state: AnalysisSetupState }) {
  const { settings, change } = state;
  return (
    <>
      <section className="well an-well" aria-labelledby="an-window-h">
        <div className="an-well-head">
          <h2 id="an-window-h">Windowing & evidence</h2>
          <p>Boundaries stay fixed. Oversized windows remain visible with missing scores.</p>
        </div>
        <div className="three">
          <Field label="Window size (classification steps)" required>
            <Input
              type="number"
              min="1"
              max="1000"
              value={settings.windowSize}
              onChange={(e) => change({ windowSize: e.target.valueAsNumber })}
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
          <Field label="Jev model" hint="Pinned default; change explicitly for a new analysis.">
            <Input value={settings.model} onChange={(e) => change({ model: e.target.value })} />
          </Field>
          <Field label="First source step (optional)">
            <Input
              type="number"
              min="1"
              value={settings.startStep ?? ""}
              onChange={(e) =>
                change({ startStep: e.target.value ? e.target.valueAsNumber : undefined })
              }
            />
          </Field>
          <Field label="Last source step (optional)">
            <Input
              type="number"
              min="1"
              value={settings.endStep ?? ""}
              onChange={(e) =>
                change({ endStep: e.target.value ? e.target.valueAsNumber : undefined })
              }
            />
          </Field>
          <Field
            label="Reserved input space (tokens)"
            hint="Reserved for provider overhead; reduces the evidence budget."
          >
            <Input
              type="number"
              min="0"
              value={settings.headroom}
              onChange={(e) => change({ headroom: e.target.valueAsNumber })}
            />
          </Field>
        </div>
        <div className="actions an-phases">
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
        <StepStrip size={settings.windowSize} stride={settings.stride} />
      </section>

      <section className="well an-well" aria-labelledby="an-evidence-h">
        <div className="an-well-head">
          <h2 id="an-evidence-h">Provider-visible evidence</h2>
          <p>These switches select inference inputs. Timeline visibility filters do not affect them.</p>
        </div>
        <div className="three">
          {categories.map((category) => (
            <Check
              key={category}
              label={categoryLabels[category]}
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
      </section>

      <section className="well an-well" aria-labelledby="an-requests-h">
        <div className="an-well-head">
          <h2 id="an-requests-h">Requests</h2>
        </div>
        <div className="three">
          <Field
            label="Request timeout (seconds)"
            hint="Maximum wait per request; stored exactly in milliseconds."
          >
            <Input
              type="number"
              min="0.001"
              step="0.001"
              value={settings.timeoutMs / 1000}
              onChange={(e) => change({ timeoutMs: e.target.valueAsNumber * 1000 })}
            />
          </Field>
          <Field label="Maximum attempts">
            <Input
              type="number"
              min="1"
              max="5"
              value={settings.maxAttempts}
              onChange={(e) => change({ maxAttempts: e.target.valueAsNumber })}
            />
          </Field>
        </div>
      </section>
    </>
  );
}
