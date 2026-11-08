import { Card, CardHeading, Check, Field, Input } from "../../components/ui";
import { evidenceCategories as categories } from "../../lib/analysis-types";
import type { AnalysisSetupState } from "./analysis-setup";
import { plural } from "./analysis-view";

export function WindowingSection({ state }: { state: AnalysisSetupState }) {
  const { settings, change } = state;
  return (
    <>
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
                  Illustration: windows of {plural(settings.windowSize, "step")} advance{" "}
                  {plural(settings.stride, "step")}. A classification step is different
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
    </>
  );
}
