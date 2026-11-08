import type { CSSProperties } from "react";
import { Button, Check, Field, Input } from "../../components/ui";
import { ModelControls } from "../../components/model-controls";
import { Plus } from "lucide-react";
import type { ExperimentConfig } from "../../lib/types";
import { useProviders, useScenarios } from "../../lib/descriptors";
import { PlaybookPicker } from "../../components/playbook-picker";
import { readableName } from "./config-edit";
import type { ConfigFieldFactory } from "./config-field";
import { Section } from "./section";
import type { SectionState } from "./sections";

/** Documented payload gap: scenario metadata carries no role tool list (presentation.toolNames). */
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

/** Role dots cycle through the data hues so adjacent roles stay distinguishable. */
const roleColors = ["var(--amber)", "#7a3fb8", "var(--success-fg)", "var(--blue)", "#c4242a"];

const oneLine = (text: string) => {
  const first = text.trim().split(/(?<=[.!?])\s|\n/)[0] ?? "";
  return first.length > 140 ? first.slice(0, 137) + "…" : first;
};

/** Model & roles section: shared model controls, then one compact row per role that expands to its editor. */
export function AgentsSection({
  config,
  change,
  replace,
  field,
  errors,
  state,
}: {
  config: ExperimentConfig;
  change(path: string, value: unknown): void;
  replace(value: ExperimentConfig): void;
  field: ConfigFieldFactory;
  errors: Record<string, string> | undefined;
  state: SectionState;
}) {
  const providers = useProviders();
  const scenarios = useScenarios();
  const provider = providers.view(config.model.provider);
  const scenario = scenarios.view(config.scenario.version);
  /** Server-embedded playbook keys are never numeric settings editors. */
  const playbookKeys = ["playbook", "playbookHash", "playbookVersion"];
  const supportedSettings = (provider.settings.length ? [...provider.settings] : Object.keys(config.model.settings))
    .filter((key) => !provider.playbook || !playbookKeys.includes(key));
  return (
    <Section
      state={state}
      description={`All ${config.roles.length} ${config.roles.length === 1 ? "role uses" : "roles use"} one model. Provider credentials stay on the server.`}
    >
      {scenario.modelSection === "catalog" ? (
        <div className="form-grid">
          <ModelControls config={config} replace={replace} errors={errors} />
        </div>
      ) : (
        <>
          <div className="two">
            {field(
              "model.provider",
              "Model provider",
              "For example openai, anthropic, or scripted",
            )}
            {field(
              "model.id",
              "Exact model identifier",
              "Scripted models are marked as fixtures in every list.",
            )}
          </div>
          {provider.playbook && (
            <PlaybookPicker config={config} replace={replace} errors={errors} />
          )}
        </>
      )}
      <details className="exp-edit">
        <summary className="link">Advanced model parameters</summary>
        <div className="two" style={{ marginTop: 12 }}>
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
            .filter((key) => !supportedSettings.includes(key) && !(provider.playbook && playbookKeys.includes(key)))
            .map((key) => (
              <p key={key} className="small muted">
                The saved {key} setting is preserved, but its structured editor
                is unavailable.
              </p>
            ))}
        </div>
      </details>
      <div className="stack" style={{ gap: 8 }}>
        <span className="exp-label">
          Roles <span className="opt">· order is drawn from the seed at launch</span>
        </span>
        {config.roles.map((role, index) => (
          <details
            className="exp-role"
            key={index}
            open={!!errors && Object.keys(errors).some((path) => path.startsWith(`roles.${index}.`)) ? true : undefined}
          >
            <summary className="trow">
              <span className="who-chip" style={{ "--c": roleColors[index % roleColors.length] } as CSSProperties}>
                {role.id || `Role ${index + 1}`}
              </span>
              <span className="small muted exp-clamp">
                {oneLine(role.instructions) || "No instructions"} · {role.allowedTools.length}{" "}
                {role.allowedTools.length === 1 ? "tool" : "tools"}
              </span>
              <span className="link exp-toggle">
                <span className="when-closed">Edit</span>
                <span className="when-open">Done</span>
              </span>
            </summary>
            <div className="exp-role-body stack">
              <div className="two">
                {field(`roles.${index}.id`, "Role identifier")}
                <div className="exp-remove">
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
              </div>
              {field(
                `roles.${index}.instructions`,
                "Role instructions",
                undefined,
                "textarea",
              )}
              <div className="stack" style={{ gap: 8 }}>
                <span className="exp-label">Allowed tools</span>
                <div className="exp-tools">
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
          </details>
        ))}
        <Button
          variant="secondary"
          size="sm"
          style={{ justifySelf: "start" }}
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
    </Section>
  );
}
