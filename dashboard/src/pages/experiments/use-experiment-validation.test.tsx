// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import { fakeClients, renderWithClients } from "../../test/clients";
import { useExperimentValidation } from "./use-experiment-validation";
import type { ExperimentConfig } from "../../lib/types";

afterEach(cleanup);

function Probe({
  config,
  onAccepted,
}: {
  config: ExperimentConfig;
  onAccepted: (value: ExperimentConfig) => void;
}) {
  const validation = useExperimentValidation({
    config,
    onAccepted,
    invalidateOn: config,
  });
  return (
    <>
      <button onClick={() => void validation.validate()} disabled={validation.busy}>
        validate
      </button>
      {validation.reviewing && <p>review open</p>}
      {validation.result && !validation.result.valid && (
        <p>{validation.result.errors.join(",")}</p>
      )}
    </>
  );
}

it("treats the server verdict as the only validity owner and reports field errors", async () => {
  const config = defaultFixtureConfiguration();
  const validate = vi.fn(async () => ({
    valid: false,
    errors: ["Fix memory"],
    fieldErrors: { "memory.contextBudget": "Use a positive memory budget" },
  }));
  renderWithClients(<Probe config={config} onAccepted={() => {}} />, {
    clients: fakeClients({ experiments: { validate } }),
  });
  await userEvent.click(screen.getByRole("button", { name: "validate" }));
  expect(validate).toHaveBeenCalledWith(config);
  expect(await screen.findByText("Fix memory")).toBeTruthy();
  expect(screen.queryByText("review open")).toBeNull();
});

it("keeps the verdict for the accepted configuration and drops it after another edit", async () => {
  const config = defaultFixtureConfiguration();
  const accepted = { ...config, label: "Accepted" };
  let current = config;
  function Harness() {
    return (
      <Probe
        config={current}
        onAccepted={(value) => {
          current = value;
        }}
      />
    );
  }
  const { rerender } = renderWithClients(<Harness />, {
    clients: fakeClients({
      experiments: { validate: async () => ({ valid: true, errors: [], config: accepted }) },
    }),
  });
  await userEvent.click(screen.getByRole("button", { name: "validate" }));
  await waitFor(() => expect(screen.getByText("review open")).toBeTruthy());
  current = { ...accepted, label: "Edited" };
  rerender(<Harness />);
  await waitFor(() => expect(screen.queryByText("review open")).toBeNull());
});
