import { Card, CardHeading } from "../../components/ui";
import type { ConfigFieldFactory, DurationFieldFactory } from "./config-field";

/** Execution & limits section. */
export function ExecutionSection({
  field,
  duration,
}: {
  field: ConfigFieldFactory;
  duration: DurationFieldFactory;
}) {
  return (
    <Card className="form-section">
      <CardHeading
        title="Execution & limits"
        description="An admitted tool call consumes one turn-budget unit, including board, memory, and end_turn."
      />
      <div className="card-body form-grid three">
        {field("scheduler.rounds", "Fixed rounds", undefined, "number", 1)}
        {field(
          "scheduler.toolCallsPerTurn",
          "Admitted tool calls / turn",
          undefined,
          "number",
          1,
        )}
        {field(
          "scheduler.seed",
          "Agent-order & pairing seed",
          undefined,
          "number",
        )}
        {duration("limits.requestTimeoutMs", "Request timeout (seconds)", 1000)}
        {field(
          "limits.maxModelStepsPerTurn",
          "Model steps / turn",
          undefined,
          "number",
          1,
        )}
        {duration("limits.maxDurationMs", "Maximum run duration (minutes)", 60000)}
        <p className="helper full">
          One final report call per agent. Automatic retries are disabled.
          Classification steps used by Jev are a separate unit.
        </p>
      </div>
    </Card>
  );
}
