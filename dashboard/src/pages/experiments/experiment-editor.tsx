import { Link } from "react-router-dom";
import { Save } from "lucide-react";
import { Badge, Button, Card, CardHeading, Notice, PageHeader } from "../../components/ui";
import { configFingerprint } from "../../lib/experiment-form";
import { useConfigField } from "./config-field";
import { focusField } from "./config-edit";
import { DraftListCard } from "./draft-library";
import { LaunchReview } from "./launch-review";
import { ScenarioSection } from "./scenario-section";
import { AgentsSection } from "./agents-section";
import { ExecutionSection } from "./execution-section";
import { BoardMemorySection } from "./board-memory-section";
import { ArtifactReportSection } from "./artifact-report-section";
import type { ExperimentDraft } from "./use-experiment-draft";
import type { ExperimentValidation } from "./use-experiment-validation";

/**
 * The editing surface: composes the draft/validation hooks with the section components.
 * Markup is the pre-split editor body; sections receive narrow props and field factories.
 */
export function ExperimentEditor({
  draft,
  validation,
}: {
  draft: ExperimentDraft;
  validation: ExperimentValidation;
}) {
  const config = draft.config!;
  const errors = validation.result?.fieldErrors;
  const { field, duration } = useConfigField(
    config,
    errors,
    (path) =>
      draft.schema.data?.fields.some(
        (item) => item.path === path && item.required,
      ) ?? false,
    draft.change,
  );
  const busy = draft.command.busy || validation.busy;
  const error = draft.command.error ?? validation.error;
  const fingerprint = configFingerprint(config);
  const nearIdentical = draft.sessionLaunches.find(
    (item) => item.fingerprint === fingerprint && item.key !== draft.launchKey,
  );
  const previousLaunches = draft.sessionLaunches.filter(
    (item) => item.at !== draft.launchedNow?.at,
  );
  const timeOf = (iso: string) =>
    new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  const launch = async () => {
    const result = await draft.launch();
    if (result) validation.dismissReview();
  };
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
              {draft.dirty
                ? "Unsaved edits"
                : draft.draft
                  ? `Draft revision ${draft.draft.revision ?? 1}`
                  : "New draft"}
            </Badge>
            <Button variant="secondary" disabled={busy} onClick={() => void draft.save()}>
              <Save size={15} />
              Save draft
            </Button>
          </>
        }
      />
      {draft.savedLocal && (
        <Notice kind="warning">
          Recovered unsaved edits from this browser. Save them to share the
          draft with your team.
        </Notice>
      )}
      {error && (
        <Notice kind="error">
          {error.message}
          {"status" in error && (error as { status?: number }).status === 409 && (
            <p>
              This draft changed on the server. Your edits are retained. Load
              the latest saved draft to reconcile, or save your configuration as
              a new draft.
            </p>
          )}
        </Notice>
      )}
      {draft.command.message && (
        <Notice kind="success">{draft.command.message}</Notice>
      )}
      {validation.result && !validation.result.valid && (
        <Notice kind="error">
          <strong id="experiment-errors" tabIndex={-1}>
            Configuration needs attention
          </strong>
          {Object.entries(validation.result.fieldErrors || {}).map(
            ([path, fieldError]) => (
              <p key={path}>
                <button
                  className="experiment-error-link"
                  onClick={() => focusField(path)}
                >
                  {fieldError}
                </button>
              </p>
            ),
          )}
          <ul>
            {validation.result.errors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Notice>
      )}
      {draft.launched && (
        <Notice kind="success">
          <strong>Matched pair queued</strong>
          <p>
            The configuration is frozen. Runs execute independently of this
            browser.
          </p>
          <div className="actions">
            {draft.launched.map((run) => (
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
        <fieldset className="form-lock" disabled={!!draft.launchedNow}>
          <ScenarioSection
            config={config}
            change={draft.change}
            replace={draft.replace}
            notes={draft.notes}
            editNotes={draft.editNotes}
            field={field}
            errors={errors}
          />
          <AgentsSection
            config={config}
            change={draft.change}
            replace={draft.replace}
            field={field}
            errors={errors}
          />
          <ExecutionSection field={field} duration={duration} />
          <BoardMemorySection config={config} field={field} />
          <ArtifactReportSection field={field} />
        </fieldset>
        <aside className="stack sticky">
          <LaunchReview
            config={config}
            reviewing={validation.reviewing}
            busy={busy}
            onValidate={() => void validation.validate()}
            onLaunch={() => void launch()}
            onBack={validation.dismissReview}
          />
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
          {nearIdentical && !draft.launchedNow && (
            <Notice kind="warning">
              You launched a near-identical pair at {timeOf(nearIdentical.at)}
              {nearIdentical.label === config.label
                ? " with the same name"
                : ` as “${nearIdentical.label}”`}
              . Only the name or notes differ, so this starts two more runs.{" "}
              {nearIdentical.pairId && (
                <Link to={"/runs/pairs/" + nearIdentical.pairId}>
                  View that pair
                </Link>
              )}
            </Notice>
          )}
          <DraftListCard
            drafts={draft.drafts}
            current={draft.draft}
            onLoad={draft.load}
            onDuplicate={() => void draft.duplicate()}
            onNew={draft.saveAsNew}
            onStartNew={draft.startNew}
          />
          {draft.schema.error && (
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
