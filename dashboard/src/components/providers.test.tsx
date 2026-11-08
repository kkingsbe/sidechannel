// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import { ModelControls } from "./model-controls";
import { fakeClients, renderWithClients } from "../test/clients";
import type { ExperimentConfig } from "../lib/types";

afterEach(cleanup);

const config = (): ExperimentConfig => {
  const next = defaultFixtureConfiguration();
  next.model.provider = "zephyr";
  next.model.id = "";
  return next;
};

it("adds a provider to the select from metadata with zero component edits", async () => {
  const clients = fakeClients({
    experiments: {
      providers: async () => ({
        providers: [
          { id: "scripted", label: "Scripted healthcare", settings: [], fixture: true },
          { id: "zephyr", label: "Zephyr research", settings: ["temperature", "topP"], fixture: false },
        ],
      }),
      scenarios: async () => ({ scenarios: [] }),
    },
  });
  renderWithClients(<ModelControls config={config()} replace={() => {}} />, { clients });
  expect(await screen.findByRole("option", { name: "Zephyr research" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Scripted healthcare · development" })).toBeTruthy();
  expect((screen.getByLabelText("Execution driver") as HTMLSelectElement).value).toBe("zephyr");
});

it("keeps the known provider copy when metadata is unavailable", () => {
  const clients = fakeClients();
  renderWithClients(<ModelControls config={config()} replace={() => {}} />, { clients });
  expect(screen.getByRole("option", { name: "Scripted healthcare · development" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Live Adaption · pilot" })).toBeTruthy();
});
