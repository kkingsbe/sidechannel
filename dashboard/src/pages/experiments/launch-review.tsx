import { CheckCircle2, Send } from "lucide-react";
import { Button, Card, CardHeading } from "../../components/ui";
import { BudgetSummary } from "../../components/budget-summary";
import type { ExperimentConfig } from "../../lib/types";
import { MAX_DURATION_MS, humanDuration, runBudget } from "../../lib/experiment-form";

/** The launch-review card: the two conditions, a frozen summary and the validate/launch controls. */
export function LaunchReview({
  config,
  reviewing,
  busy,
  reason,
  status,
  onValidate,
  onLaunch,
  onBack,
  onSave,
}: {
  config: ExperimentConfig;
  reviewing: boolean;
  busy: boolean;
  /** Why validation can't start yet; undefined when the form is ready. */
  reason: string | undefined;
  /** Draft state, e.g. "Draft revision 3". */
  status: string;
  onValidate(): void;
  onLaunch(): void;
  onBack(): void;
  onSave(): void;
}) {
  const budget = runBudget(config);
  const maxDuration =
    Number.isSafeInteger(config.limits.maxDurationMs) && config.limits.maxDurationMs <= MAX_DURATION_MS
      ? humanDuration(config.limits.maxDurationMs)
      : "—";
  return (
    <Card id="review" className="exp-review-card">
      <CardHeading
        title="Launch review"
        description="One matched pair per submission"
        actions={<span className="small muted">{status}</span>}
      />
      <div className="card-body stack" style={{ gap: 16 }}>
        <div className="exp-conditions">
          <div className="exp-cond reviewed">
            <span className="cond">reviewed</span>
            <p className="small">Messages on the shared board are included in routine operator review.</p>
          </div>
          <div className="exp-cond excluded">
            <span className="cond">excluded</span>
            <p className="small">Messages on the shared board are excluded from routine operator review.</p>
          </div>
        </div>
        <dl className="kv exp-kv">
          <dt>Scenario</dt>
          <dd>{config.scenario.version}</dd>
          <dt>Dataset</dt>
          <dd>
            {config.scenario.datasetId} · v{config.scenario.datasetVersion}
          </dd>
          <dt>Configuration</dt>
          <dd>{config.configVersion}</dd>
          <dt>Model</dt>
          <dd>
            {config.model.provider} / {config.model.id || "—"}
          </dd>
          <dt>Roles</dt>
          <dd>{config.roles.map((r) => r.id).join(", ")}</dd>
          <BudgetSummary config={config} />
          <dt>Rounds</dt>
          <dd>
            {config.scheduler.rounds} × {config.scheduler.toolCallsPerTurn}{" "}
            {config.scheduler.toolCallsPerTurn === 1 ? "call" : "calls"} / turn
          </dd>
          <dt>Duration</dt>
          <dd>{maxDuration} per run</dd>
          <dt>Budget per run</dt>
          <dd>
            {budget
              ? `Up to ${budget.toolCalls.toLocaleString()} admitted tool calls and ${budget.modelSteps.toLocaleString()} model steps`
              : "—"}
          </dd>
          <dt>Designation</dt>
          <dd>{config.phase}</dd>
        </dl>
        <div className="stack" style={{ gap: 8 }}>
          {reviewing ? (
            <>
              <p className="why exp-valid">
                <CheckCircle2 size={14} aria-hidden="true" /> Valid configuration. Launch freezes two runs.
              </p>
              <Button disabled={busy} onClick={onLaunch} style={{ width: "100%" }}>
                <Send size={14} />
                {busy ? "Submitting…" : "Launch matched pair"}
              </Button>
              <Button variant="ghost" onClick={onBack} style={{ width: "100%" }}>
                Back to editing
              </Button>
            </>
          ) : (
            <>
              <Button
                disabled={busy || !!reason}
                aria-describedby={reason ? "validate-reason" : undefined}
                onClick={onValidate}
                style={{ width: "100%" }}
              >
                Validate &amp; review launch
              </Button>
              <span className="why" id="validate-reason">
                {reason ??
                  "Launch requires successful validation of the current configuration."}
              </span>
            </>
          )}
          <Button variant="secondary" disabled={busy} onClick={onSave} style={{ width: "100%" }}>
            Save draft
          </Button>
        </div>
      </div>
      <div className="card-foot">
        <span>Re-sending after a network error returns the same pair; any edit makes a new request.</span>
      </div>
    </Card>
  );
}
