import { CheckCircle2, Send } from "lucide-react";
import { Badge, Button, Card, CardHeading, Notice } from "../../components/ui";
import { BudgetSummary } from "../../components/budget-summary";
import type { ExperimentConfig } from "../../lib/types";
import { MAX_DURATION_MS, humanDuration, runBudget } from "../../lib/experiment-form";

/** The launch-review aside: frozen summary, pair conditions and the validate/launch controls. */
export function LaunchReview({
  config,
  reviewing,
  busy,
  onValidate,
  onLaunch,
  onBack,
}: {
  config: ExperimentConfig;
  reviewing: boolean;
  busy: boolean;
  onValidate(): void;
  onLaunch(): void;
  onBack(): void;
}) {
  const budget = runBudget(config);
  const maxDuration =
    Number.isSafeInteger(config.limits.maxDurationMs) && config.limits.maxDurationMs <= MAX_DURATION_MS
      ? humanDuration(config.limits.maxDurationMs)
      : "—";
  return (
    <Card>
      <CardHeading
        title="Launch review"
        description="One matched pair per submission"
      />
      <div className="card-body">
        <dl className="definition-list">
          <dt>Scenario</dt>
          <dd>{config.scenario.version}</dd>
          <dt>Dataset</dt>
          <dd>
            {config.scenario.datasetId} · v{config.scenario.datasetVersion}
          </dd>
          <dt>Configuration version</dt>
          <dd>{config.configVersion}</dd>
          <dt>Model</dt>
          <dd>
            {config.model.provider} / {config.model.id}
          </dd>
          <dt>Roles</dt>
          <dd>{config.roles.map((r) => r.id).join(", ")}</dd>
          <BudgetSummary config={config} />
          <dt>Rounds</dt>
          <dd>
            {config.scheduler.rounds} × {config.scheduler.toolCallsPerTurn}{" "}
            {config.scheduler.toolCallsPerTurn === 1 ? "call" : "calls"} / turn
          </dd>
          <dt>Maximum duration</dt>
          <dd>{maxDuration} per run</dd>
          <dt>Budget per run</dt>
          <dd>
            {budget
              ? `Up to ${budget.toolCalls.toLocaleString()} admitted tool calls and ${budget.modelSteps.toLocaleString()} model steps`
              : "—"}
          </dd>
          <dt>Designation</dt>
          <dd>
            <Badge>{config.phase}</Badge>
          </dd>
        </dl>
        <hr className="section-divider" />
        <div className="stack" style={{ gap: 10 }}>
          <div>
            <Badge>Reviewed board</Badge>
            <p className="helper">
              Messages are included in routine operator review.
            </p>
          </div>
          <div>
            <Badge>Excluded board</Badge>
            <p className="helper">
              Messages are excluded from routine operator review.
            </p>
          </div>
          <p className="helper">
            Only condition wording changes. Both runs retain the full researcher
            recording. The server verifies all other fields match.
          </p>
        </div>
        <hr className="section-divider" />
        {reviewing ? (
          <>
            <Notice kind="success">
              <CheckCircle2 size={14} /> Valid configuration. Launch freezes two
              runs.
            </Notice>
            <Button
              disabled={busy}
              onClick={onLaunch}
              style={{ width: "100%" }}
            >
              <Send size={14} />
              {busy ? "Submitting…" : "Launch matched pair"}
            </Button>
            <Button
              variant="ghost"
              onClick={onBack}
              style={{ width: "100%", marginTop: 7 }}
            >
              Back to editing
            </Button>
          </>
        ) : (
          <Button disabled={busy} onClick={onValidate} style={{ width: "100%" }}>
            <CheckCircle2 size={15} />
            Validate & review launch
          </Button>
        )}
        {!reviewing && (
          <p>
            Launch requires successful validation of the current configuration.
            Saving a draft is available before validation.
          </p>
        )}
        <p className="helper" style={{ marginTop: 12 }}>
          Reusing this submission after a network error returns the same pair.
          Edits create a new launch request.
        </p>
      </div>
    </Card>
  );
}
