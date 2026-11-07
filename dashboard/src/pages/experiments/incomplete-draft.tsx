import {
  Button,
  Card,
  CardHeading,
  Field,
  Input,
  Notice,
  PageHeader,
} from "../../components/ui";
import type { Draft, ExperimentConfig } from "../../lib/types";
import { pretty } from "../../lib/utils";

/** The preserved-content path for a saved draft whose structural groups are incomplete. */
export function IncompleteDraft({
  config,
  draft,
  busy,
  error,
  onChange,
  onComplete,
  onSave,
  onStartNew,
}: {
  config: ExperimentConfig;
  draft: Draft | undefined;
  busy: boolean;
  error: Error | undefined;
  onChange(path: string, value: unknown): void;
  onComplete(): void;
  onSave(): void;
  onStartNew(): void;
}) {
  return (
    <>
      <PageHeader
        title="Incomplete experiment draft"
        description="This saved draft is missing required configuration groups. Its stored content and revision are preserved."
      />
      <Notice kind="warning">
        The ordinary experiment form needs complete model, scenario, execution,
        board, memory, and role structures. Add the backend's supported default
        fields explicitly, then edit and validate before launch.
      </Notice>
      {error && <Notice kind="error">{error.message}</Notice>}
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
              onChange={(e) => onChange("label", e.target.value)}
            />
          </Field>
          <div className="actions">
            <Button onClick={onComplete}>
              Complete with supported default fields
            </Button>
            <Button variant="secondary" onClick={onSave} disabled={busy}>
              Save incomplete draft
            </Button>
            <Button variant="ghost" onClick={onStartNew}>
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
}
