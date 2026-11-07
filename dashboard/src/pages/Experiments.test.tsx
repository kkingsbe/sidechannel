// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { activate, fakeServer, renderWithServer } from "../test/clients";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import Experiments from "./Experiments";
const config = defaultFixtureConfiguration();
let submitted: { config: typeof config } | undefined;
function renderAt(path: string) {
  return renderWithServer(
    <MemoryRouter initialEntries={[path]}>
      <Experiments />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  localStorage.clear();
  submitted = undefined;
  activate(fakeServer((path, options) => {
      if (path === "/config/default") return config;
      if (path === "/config/schema") return { fields: [] };
      if (path === "/drafts") return [{ id: "shared", config, revision: 2 }];
      if (path === "/config/validate") {
        submitted = JSON.parse(String(options?.body));
        return {
          valid: false,
          errors: ["Fix memory"],
          fieldErrors: {
            "memory.contextBudget": "Use a positive memory budget",
          },
        };
      }
      throw new Error(path);
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("lists shared drafts separately from explicit local recovery", async () => {
  localStorage.setItem(
    "sidechannel-experiment-draft",
    JSON.stringify({ config }),
  );
  renderAt("/experiments");
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
it("starts with supported defaults and recovers local changes only on request", async () => {
  localStorage.setItem(
    "sidechannel-experiment-draft",
    JSON.stringify({ config: { ...config, label: "Recovered configuration" } }),
  );
  renderAt("/experiments/new?recover=1");
  expect(
    ((await screen.findByLabelText("Experiment name")) as HTMLInputElement)
      .value,
  ).toBe("Recovered configuration");
  expect(screen.getByText(/Recovered unsaved edits/)).toBeTruthy();
});
it("preserves frozen settings and opens and focuses collapsed validation errors", async () => {
  renderAt("/experiments/new");
  await screen.findByLabelText("Experiment name");
  const memory = screen.getByLabelText("Memory context budget (characters)");
  expect(memory.closest("details")?.open).toBe(false);
  await userEvent.click(
    screen.getByRole("button", { name: "Validate & review launch" }),
  );
  await waitFor(() => expect(document.activeElement).toBe(memory));
  expect(memory.closest("details")?.open).toBe(true);
  expect(submitted?.config).toEqual(config);
});
it("converts human duration inputs to exact millisecond payloads", async () => {
  renderAt("/experiments/new");
  const timeout = await screen.findByLabelText("Request timeout (seconds)");
  const duration = screen.getByLabelText("Maximum run duration (minutes)");
  const user = userEvent.setup();
  await user.clear(timeout);
  await user.type(timeout, "1.234");
  await user.clear(duration);
  await user.type(duration, "1.5");
  await user.click(
    screen.getByRole("button", { name: "Validate & review launch" }),
  );
  await waitFor(() => expect(submitted).toBeTruthy());
  expect(submitted?.config.limits.requestTimeoutMs).toBe(1234);
  expect(submitted?.config.limits.maxDurationMs).toBe(90000);
});
