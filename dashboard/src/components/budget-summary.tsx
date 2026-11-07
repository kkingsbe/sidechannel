import type { ExperimentConfig } from "../lib/types";

export function BudgetSummary({ config }: { config: ExperimentConfig }) {
  const budget = config.tokenBudget;
  return (
    <>
      <dt>Input allowance</dt>
      <dd
        title={
          budget
            ? undefined
            : "This configuration has no token budget, so the private-memory context is limited by character count (memory.contextBudget) instead of model tokens."
        }
      >
        {budget
          ? `${budget.maxInputTokens.toLocaleString()} tokens (conservative estimate)`
          : `${config.memory.contextBudget.toLocaleString()} characters (legacy)`}
      </dd>
      <dt>Output allowance</dt>
      <dd>
        {typeof config.model.settings.maxOutputTokens === "number"
          ? `${config.model.settings.maxOutputTokens.toLocaleString()} tokens`
          : "Provider default"}
      </dd>
      {budget && (
        <>
          <dt>Model capacity</dt>
          <dd>
            {config.model.provider === "scripted"
              ? "Scripted driver — no provider context"
              : budget.capacity
                ? `${budget.capacity.tokens.toLocaleString()} tokens`
                : "Unverified — select a supported model"}
          </dd>
          <dt>Reserved headroom</dt>
          <dd>{budget.counting.reservedTokens.toLocaleString()} tokens</dd>
        </>
      )}
      <dt>Private note limit</dt>
      <dd>
        {(
          config.memory.maxPrivateNoteCharacters ?? config.memory.contextBudget
        ).toLocaleString()}{" "}
        characters
      </dd>
    </>
  );
}
