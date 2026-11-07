import { Button, Card, CardHeading, Check, Field, Input, Notice } from "../../components/ui";
import { ModelControls } from "../../components/model-controls";
import { Plus } from "lucide-react";
import type { ExperimentConfig } from "../../lib/types";
import { readableName } from "./config-edit";
import type { ConfigFieldFactory } from "./config-field";

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

/** Agents & shared model section: role editor plus the model controls. */
export function AgentsSection({
  config,
  change,
  replace,
  field,
  errors,
}: {
  config: ExperimentConfig;
  change(path: string, value: unknown): void;
  replace(value: ExperimentConfig): void;
  field: ConfigFieldFactory;
  errors: Record<string, string> | undefined;
}) {
  return (
    <Card className="form-section">
      <CardHeading
        title="Agents & shared model"
        description="All roles use this model. Provider credentials stay on the server."
      />
      <div className="card-body form-grid">
        {config.scenario.version === "healthcare-points-v0.3" ? (
          <ModelControls config={config} replace={replace} errors={errors} />
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
              .filter((key) => key !== "maxOutputTokens" || !config.tokenBudget)
              .map((key) => (
                <Field
                  key={key}
                  label={readableName(key)}
                  hint="Optional; leave blank to use the provider default."
                  error={errors?.[`model.settings.${key}`]}
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
                  The saved {key} setting is preserved, but its structured editor
                  is unavailable.
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
                                : role.allowedTools.filter((t) => t !== tool),
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
  );
}
