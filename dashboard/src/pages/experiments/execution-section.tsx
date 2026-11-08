import type { ConfigFieldFactory, DurationFieldFactory } from "./config-field";
import { Section } from "./section";
import type { SectionState } from "./sections";

/** Execution & limits section. */
export function ExecutionSection({
  field,
  duration,
  state,
}: {
  field: ConfigFieldFactory;
  duration: DurationFieldFactory;
  state: SectionState;
}) {
  return (
    <Section
      state={state}
      description="An admitted tool call consumes one turn-budget unit, including board, memory and end_turn."
    >
      <div className="three">
        {field("scheduler.rounds", "Fixed rounds", undefined, "number", 1)}
        {field(
          "scheduler.toolCallsPerTurn",
          "Admitted tool calls / turn",
          undefined,
          "number",
          1,
        )}
        {field(
          "limits.maxModelStepsPerTurn",
          "Model steps / turn",
          undefined,
          "number",
          1,
        )}
      </div>
      <div className="three">
        {duration("limits.requestTimeoutMs", "Request timeout (seconds)", 1000)}
        {duration("limits.maxDurationMs", "Maximum run duration (minutes)", 60000)}
        {field(
          "scheduler.seed",
          "Agent-order & pairing seed",
          undefined,
          "number",
        )}
      </div>
      <p className="small muted">
        One final report call per agent. Automatic retries are off.
        Classification steps used by Jev are a separate budget.
      </p>
    </Section>
  );
}
