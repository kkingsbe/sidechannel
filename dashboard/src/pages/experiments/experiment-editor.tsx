import { Link } from "react-router-dom";
import { ChevronLeft, Copy } from "lucide-react";
import { Button, Card, CardHeading, Notice, PageHeader } from "../../components/ui";
import { PresetPicker } from "../../components/healthcare-preset";
import { configFingerprint } from "../../lib/experiment-form";
import { useScenarios } from "../../lib/descriptors";
import { useConfigField } from "./config-field";
import { focusField } from "./config-edit";
import { LaunchReview } from "./launch-review";
import { ScenarioSection } from "./scenario-section";
import { AgentsSection } from "./agents-section";
import { ExecutionSection } from "./execution-section";
import { BoardMemorySection } from "./board-memory-section";
import { ArtifactReportSection } from "./artifact-report-section";
import { SECTIONS, allErrors, sectionStates } from "./sections";
import type { ExperimentDraft } from "./use-experiment-draft";
import type { ExperimentValidation } from "./use-experiment-validation";

/**
 * The editing surface: composes the draft/validation hooks with the section components.
 * Layout is a steps rail, the stacked sections, and the sticky launch review.
 */
export function ExperimentEditor({
  draft,
  validation,
}: {
  draft: ExperimentDraft;
  validation: ExperimentValidation;
}) {
  const config = draft.config!;
  const scenarios = useScenarios();
  const errors = allErrors(
    config,
    validation.result?.fieldErrors,
    scenarios.view(config.scenario.version).showDatasetFields,
  );
  const { field, duration } = useConfigField(config, errors, draft.change);
  const states = sectionStates(errors);
  const stateOf = (id: string) => states.find((state) => state.id === id)!;
  const currentIndex = states.findIndex((state) => state.left.length > 0);
  const issueCount = states.reduce((sum, state) => sum + state.left.length, 0);
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
  const verdict = validation.result && !validation.result.valid ? validation.result : undefined;
  const reason =
    issueCount === 0
      ? undefined
      : `${issueCount} ${issueCount === 1 ? "field needs" : "fields need"} attention: ${states
          .flatMap((state) => state.left)
          .slice(0, 3)
          .join(", ")}. Saving a draft is available at any time; a draft never launches runs.`;
  const status = draft.dirty
    ? "Unsaved edits"
    : draft.draft
      ? `Draft revision ${draft.draft.revision ?? 1}`
      : "New draft";
  /** At most one notice on the screen: the most pressing condition wins. */
  const notice = error ? (
    <Notice kind="error">
      {error.message}
      {"status" in error && (error as { status?: number }).status === 409 && (
        <> This draft changed on the server. Your edits are retained. Load the latest saved draft to reconcile, or save your configuration as a new draft.</>
      )}
    </Notice>
  ) : verdict ? (
    <Notice kind="error">
      <strong id="experiment-errors" tabIndex={-1}>
        Configuration needs attention
      </strong>
      {Object.entries(verdict.fieldErrors || {}).map(([path, fieldError]) => (
        <p key={path}>
          <button className="experiment-error-link" onClick={() => focusField(path)}>
            {fieldError}
          </button>
        </p>
      ))}
      <ul>
        {verdict.errors.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </Notice>
  ) : draft.launched ? (
    <Notice kind="success">
      <strong>Matched pair queued</strong>. The configuration is frozen and runs execute independently of this browser.
      <div className="actions" style={{ marginTop: 8 }}>
        {draft.launched.map((run) => (
          <Button asChild size="sm" variant="secondary" key={run.id}>
            <Link to={"/runs/" + run.id}>
              {run.config.condition.id} · {run.id.slice(0, 12)}
            </Link>
          </Button>
        ))}
      </div>
    </Notice>
  ) : nearIdentical && !draft.launchedNow ? (
    <Notice kind="warning">
      You launched a near-identical pair at {timeOf(nearIdentical.at)}
      {nearIdentical.label === config.label
        ? " with the same name"
        : ` as “${nearIdentical.label}”`}
      . Only the name or notes differ, so this starts two more runs.{" "}
      {nearIdentical.pairId && (
        <Link to={"/runs/pairs/" + nearIdentical.pairId}>View that pair</Link>
      )}
    </Notice>
  ) : draft.savedLocal ? (
    <Notice kind="warning">
      Recovered unsaved edits from this browser. Save them to share the draft
      with your team.
    </Notice>
  ) : null;
  const stepNumber = (index: number) => index + 1;
  const reviewDone = !!draft.launchedNow;
  return (
    <>
      <Link className="crumb-back" to="/experiments">
        <ChevronLeft size={14} aria-hidden="true" />
        Experiments
      </Link>
      <PageHeader
        title={draft.draft && config.label ? config.label : "New experiment"}
        description={
          <>
            <strong>One frozen configuration, two conditions.</strong> Only the
            condition wording differs; the server verifies every other field
            matches at launch.
          </>
        }
        actions={
          <>
            <PresetPicker config={config} replace={draft.replace} />
            <Button variant="secondary" disabled={busy} onClick={() => void draft.save()}>
              Save draft
            </Button>
            <Button variant="ghost" onClick={draft.startNew}>
              New draft
            </Button>
          </>
        }
      />
      {notice}
      <div className="exp-layout">
        <nav className="exp-steps" aria-label="Sections">
          {SECTIONS.map((section, index) => {
            const left = stateOf(section.id).left.length;
            const done = left === 0;
            const current = index === currentIndex;
            return (
              <a
                key={section.id}
                href={"#" + section.id}
                className={done ? "done" : left > 0 ? "todo" : ""}
                aria-current={current ? "step" : undefined}
              >
                <i aria-hidden="true">{done ? "✓" : stepNumber(index)}</i>
                {section.title}
                {left > 0 && <span className="sr-only"> ({left} left)</span>}
              </a>
            );
          })}
          <a
            href="#review"
            className={reviewDone ? "done" : ""}
            aria-current={currentIndex === -1 && !reviewDone ? "step" : undefined}
          >
            <i aria-hidden="true">{reviewDone ? "✓" : 6}</i>
            Review &amp; launch
          </a>
        </nav>
        <fieldset className="form-lock" disabled={!!draft.launchedNow}>
          <ScenarioSection
            config={config}
            change={draft.change}
            replace={draft.replace}
            notes={draft.notes}
            editNotes={draft.editNotes}
            field={field}
            errors={errors}
            state={stateOf("scenario")}
          />
          <AgentsSection
            config={config}
            change={draft.change}
            replace={draft.replace}
            field={field}
            errors={errors}
            state={stateOf("model")}
          />
          <ExecutionSection field={field} duration={duration} state={stateOf("limits")} />
          <BoardMemorySection config={config} field={field} state={stateOf("board")} />
          <ArtifactReportSection config={config} field={field} state={stateOf("reports")} />
        </fieldset>
        <aside className="exp-aside">
          <LaunchReview
            config={config}
            reviewing={validation.reviewing}
            busy={busy}
            reason={reason}
            status={status}
            onValidate={() => void validation.validate()}
            onLaunch={() => void launch()}
            onBack={validation.dismissReview}
            onSave={() => void draft.save()}
          />
          {(draft.draft || draft.command.message) && (
            <div className="actions exp-draft-actions">
              {draft.command.message && <span className="small muted">{draft.command.message}</span>}
              {draft.draft && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => void draft.duplicate()}>
                    <Copy size={13} />
                    Duplicate draft
                  </Button>
                  <Button size="sm" variant="ghost" onClick={draft.saveAsNew}>
                    Save as new
                  </Button>
                </>
              )}
            </div>
          )}
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
          {draft.schema.error && (
            <p className="small muted">
              Configuration schema is unavailable. The backend still validates
              every save and launch.
            </p>
          )}
        </aside>
      </div>
    </>
  );
}
