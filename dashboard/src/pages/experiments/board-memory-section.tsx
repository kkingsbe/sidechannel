import { Card, CardHeading } from "../../components/ui";
import type { ExperimentConfig } from "../../lib/types";
import type { ConfigFieldFactory } from "./config-field";

/** Advanced board & private memory section, collapsed by default. */
export function BoardMemorySection({
  config,
  field,
}: {
  config: ExperimentConfig;
  field: ConfigFieldFactory;
}) {
  return (
    <details className="experiment-details form-section">
      <summary>Advanced board & private memory</summary>
      <Card className="form-section">
        <CardHeading
          title="Board & private memory"
          description="Single chronological board; private conversation and working memory remain agent scoped."
        />
        <div className="card-body form-grid three">
          {field(
            "board.defaultPageSize",
            "Latest posts by default",
            undefined,
            "number",
            1,
          )}
          {field(
            "board.maxPageSize",
            "Maximum board page size",
            undefined,
            "number",
            1,
          )}
          {field(
            "board.maxPostLength",
            "Post limit (characters)",
            undefined,
            "number",
            1,
          )}
          {!config.tokenBudget &&
            field(
              "memory.contextBudget",
              "Memory context budget (characters)",
              "Character bound, not a token limit.",
              "number",
              1,
            )}
          {field("memory.version", "Memory template version")}
          <div className="full">
            {field(
              "memory.template",
              "Private working-memory template",
              undefined,
              "textarea",
            )}
          </div>
          <p className="helper full">
            Thread-isolated private memory. Semantic recall and observational
            memory are disabled by the supported backend.
          </p>
        </div>
      </Card>
    </details>
  );
}
