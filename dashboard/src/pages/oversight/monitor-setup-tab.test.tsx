// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  MonitorDefinition,
  MonitorPreview,
} from "@sidechannel/contracts/browser";
import type { Run } from "../../lib/types";
import { fakeClients, renderWithClients } from "../../test/clients";
import { MonitorSetupTab } from "./monitor-setup-tab";

afterEach(cleanup);

const definition = { id: "definition:1", revision: 1, createdAt: "2026-11-07T12:00:00Z", questions: "Assess.", outcomes: [], schemaVersion: 1 } as unknown as MonitorDefinition;

function clients() {
  return fakeClients({
    monitor: { history: async () => ({ items: [definition], nextCursor: null }) },
    runs: { list: async () => ({ items: [], total: 0, nextOffset: null }) },
  });
}

it("requires an explicit provider and model and lists the four evidence views", async () => {
  renderWithClients(<MonitorSetupTab />, { route: "/oversight?view=setup&run=source", clients: clients() });
  expect(await screen.findByText("Enter a monitor provider.")).toBeTruthy();
  expect(screen.getByText("Enter a monitor model.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Preview four views" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Reports")).toBeTruthy();
  expect(screen.getByText("Full observable trace")).toBeTruthy();
  expect(screen.getByText("No completed source runs yet.")).toBeTruthy();
});

it("clears the prepared preview whenever a setting changes", async () => {
  const preview = { id: "preview-1", hash: "hash", definition, settings: { model: { provider: "fixture", id: "monitor" }, maxInputChars: 1000, contextWindowTokens: 8192, outputAllowanceTokens: 512, timeoutMs: 1000 }, runs: [] } as unknown as MonitorPreview;
  renderWithClients(<MonitorSetupTab />, {
    route: "/oversight?view=setup",
    clients: fakeClients({
      monitor: { history: async () => ({ items: [definition], nextCursor: null }), preview: async () => preview },
      runs: { list: async () => ({ items: [{ id: "source", config: { label: "Study", condition: { id: "reviewed" } } } as unknown as Run], total: 1, nextOffset: null }) },
    }),
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("checkbox", { name: /Study/ }));
  await user.type(screen.getByLabelText("Monitor provider"), "fixture");
  await user.type(screen.getByLabelText("Monitor model"), "monitor");
  await user.click(screen.getByRole("button", { name: "Preview four views" }));
  expect(await screen.findByRole("button", { name: "Launch monitor comparison" })).toBeTruthy();
  await user.type(screen.getByLabelText("Monitor model"), "x");
  expect(screen.queryByRole("button", { name: "Launch monitor comparison" })).toBeNull();
});
