// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import { fakeClients, renderWithClients } from "../../test/clients";
import { DraftLibrary } from "./draft-library";

const config = defaultFixtureConfiguration();
afterEach(cleanup);

it("lists shared drafts separately from explicit local recovery", async () => {
  renderWithClients(<DraftLibrary localRecovery='{"config":{}}' />, {
    route: "/experiments",
    clients: fakeClients({
      experiments: {
        drafts: async () => [{ id: "shared", config, revision: 2 }],
      },
    }),
  });
  expect(await screen.findByRole("link", { name: /revision 2/ })).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "New experiment" }).getAttribute("href"),
  ).toBe("/experiments/new");
  expect(
    screen
      .getByRole("link", { name: "Recover local edits" })
      .getAttribute("href"),
  ).toContain("recover=1");
  expect(screen.queryByLabelText("Experiment name")).toBeNull();
});

it("renders the empty state without a fetch stub", async () => {
  renderWithClients(<DraftLibrary localRecovery={null} />, {
    route: "/experiments",
    clients: fakeClients({ experiments: { drafts: async () => [] } }),
  });
  expect(
    await screen.findByText("No shared drafts yet. Create an experiment to begin."),
  ).toBeTruthy();
});
