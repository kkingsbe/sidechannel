import type { ExperimentConfig } from "../../lib/types";
import type { ConfigFieldFactory } from "./config-field";
import { Section } from "./section";
import type { SectionState } from "./sections";

const count = (value: unknown, unit: string) =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toLocaleString()} ${unit}` : "—";

/** Board & private memory: current values, with the fields behind an "Edit" disclosure. */
export function BoardMemorySection({
  config,
  field,
  state,
}: {
  config: ExperimentConfig;
  field: ConfigFieldFactory;
  state: SectionState;
}) {
  const budget = config.tokenBudget;
  return (
    <Section
      state={state}
      description="Single chronological board; private conversation and working memory stay agent scoped."
    >
      <dl className="kv exp-kv">
        <dt>Board page size</dt>
        <dd>
          {count(config.board.defaultPageSize, "posts")} by default, up to{" "}
          {count(config.board.maxPageSize, "posts")}
        </dd>
        <dt>Post limit</dt>
        <dd>{count(config.board.maxPostLength, "characters")}</dd>
        <dt>Private note limit</dt>
        <dd>
          {count(config.memory.maxPrivateNoteCharacters ?? config.memory.contextBudget, "characters")}
        </dd>
        {budget && (
          <>
            <dt>Input allowance</dt>
            <dd>
              {count(budget.maxInputTokens, "tokens")} ·{" "}
              {count(budget.counting.reservedTokens, "tokens")} reserved headroom
            </dd>
          </>
        )}
        <dt>Memory isolation</dt>
        <dd>Private per run, per agent thread</dd>
      </dl>
      <details className="exp-edit">
        <summary className="link">Edit board &amp; memory settings</summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="three">
            {field("board.defaultPageSize", "Latest posts by default", undefined, "number", 1)}
            {field("board.maxPageSize", "Maximum board page size", undefined, "number", 1)}
            {field("board.maxPostLength", "Post limit (characters)", undefined, "number", 1)}
          </div>
          <div className="two">
            {!config.tokenBudget &&
              field(
                "memory.contextBudget",
                "Memory context budget (characters)",
                "Character bound, not a token limit.",
                "number",
                1,
              )}
            {field("memory.version", "Memory template version")}
          </div>
          {field("memory.template", "Private working-memory template", undefined, "textarea")}
          <p className="small muted">
            Thread-isolated private memory. Semantic recall and observational
            memory are disabled by the supported backend.
          </p>
        </div>
      </details>
    </Section>
  );
}
