// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import Experiments from "./Experiments";
const config = defaultFixtureConfiguration();
let submitted: { config: typeof config } | undefined;
let validateResult: unknown;
let savedBody: { name?: string; config?: typeof config } | undefined;
let copyDraft: unknown;
function Probe() {
  const location = useLocation();
  return (
    <output aria-label="location">{location.pathname + location.search}</output>
  );
}
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Link to="/runs">Elsewhere</Link>
      <Probe />
      <Experiments />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  localStorage.clear();
  submitted = undefined;
  savedBody = undefined;
  copyDraft = undefined;
  validateResult = {
    valid: false,
    errors: ["Fix memory"],
    fieldErrors: { "memory.contextBudget": "Use a positive memory budget" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, options?: RequestInit) => {
      const path = input.replace(/^\/api/, "");
      let data: unknown;
      if (path === "/config/default") data = config;
      else if (path === "/config/schema") data = { fields: [] };
      else if (path === "/drafts" && options?.method === "POST") {
        savedBody = JSON.parse(String(options.body));
        data = { id: "d1", revision: 1, config: savedBody!.config };
      } else if (path === "/drafts")
        data = [{ id: "shared", config, revision: 2 }];
      else if (path === "/drafts/copy" && copyDraft) data = copyDraft;
      else if (path === "/datasets")
        return new Response(JSON.stringify({ error: "API route not found" }), {
          status: 404,
        });
      else if (path === "/config/validate") {
        submitted = JSON.parse(String(options?.body));
        data = validateResult;
      } else throw new Error(path);
      return new Response(JSON.stringify(data), { status: 200 });
    }),
  );
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
  await userEvent.type(screen.getByLabelText("Experiment name"), "Pilot");
  await userEvent.click(
    screen.getByRole("button", { name: "Validate & review launch" }),
  );
  await waitFor(() => expect(document.activeElement).toBe(memory));
  expect(memory.closest("details")?.open).toBe(true);
  expect(submitted?.config).toEqual({ ...config, label: "Pilot" });
});
it("converts human duration inputs to exact millisecond payloads", async () => {
  renderAt("/experiments/new");
  const timeout = await screen.findByLabelText("Request timeout (seconds)");
  const duration = screen.getByLabelText("Maximum run duration (minutes)");
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Experiment name"), "Pilot");
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

it("starts with an empty experiment name and validates numbers on blur", async () => {
  renderAt("/experiments/new");
  const user = userEvent.setup();
  const name = (await screen.findByLabelText(
    "Experiment name",
  )) as HTMLInputElement;
  expect(name.value).toBe("");
  expect(name.placeholder).toMatch(/Name this experiment/);
  const rounds = screen.getByLabelText("Fixed rounds");
  await user.clear(rounds);
  await user.type(rounds, "-5");
  await user.tab();
  expect(
    await screen.findByText("Fixed rounds must be a whole number of 1 or more"),
  ).toBeTruthy();
  expect(screen.getByText(/^—\s×/)).toBeTruthy();
});

it("blocks validation locally for runs over 24 hours and warns above 2 hours", async () => {
  renderAt("/experiments/new");
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Experiment name"), "Long");
  const duration = screen.getByLabelText("Maximum run duration (minutes)");
  await user.clear(duration);
  await user.type(duration, "150");
  expect(
    screen.getByText(/Runs this long spend more model budget/),
  ).toBeTruthy();
  await user.clear(duration);
  await user.type(duration, "99999999");
  await user.click(
    screen.getByRole("button", { name: "Validate & review launch" }),
  );
  expect(
    (await screen.findAllByText(/can't be more than 24 hours/)).length,
  ).toBeGreaterThan(0);
  expect(submitted).toBeUndefined();
});

it("shows plain-language validation errors once", async () => {
  validateResult = {
    valid: false,
    errors: ["rounds must be a positive integer"],
    fieldErrors: { "scheduler.rounds": "rounds must be a positive integer" },
  };
  renderAt("/experiments/new");
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Experiment name"), "Pilot");
  await user.click(
    screen.getByRole("button", { name: "Validate & review launch" }),
  );
  const alert = await screen.findByRole("alert");
  expect(
    within(alert).getAllByText(
      "Fixed rounds must be a whole number of 1 or more",
    ),
  ).toHaveLength(1);
  expect(
    within(alert).queryByText(/rounds must be a positive integer/),
  ).toBeNull();
});

it("names an unnamed draft on save and puts its id in the URL", async () => {
  renderAt("/experiments/new");
  await screen.findByLabelText("Experiment name");
  await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() =>
    expect(screen.getByLabelText("location").textContent).toBe(
      "/experiments?draft=d1",
    ),
  );
  expect(savedBody?.name).toMatch(/^Untitled draft/);
  expect(
    (screen.getByLabelText("Experiment name") as HTMLInputElement).value,
  ).toMatch(/^Untitled draft/);
});

it("asks before leaving with unsaved edits", async () => {
  renderAt("/experiments/new");
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Experiment name"), "Draft");
  await user.click(screen.getByRole("link", { name: "Elsewhere" }));
  expect(await screen.findByRole("alertdialog")).toBeTruthy();
  expect(screen.getByLabelText("location").textContent).toBe(
    "/experiments/new",
  );
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await user.click(screen.getByRole("link", { name: "Elsewhere" }));
  await user.click(
    await screen.findByRole("button", { name: "Leave and discard" }),
  );
  expect(screen.getByLabelText("location").textContent).toBe("/runs");
});

it("opens a never-edited duplicate as an unsaved Copy of draft", async () => {
  copyDraft = {
    id: "copy",
    revision: 1,
    lineage: { sourceType: "run" },
    config: { ...config, label: "Base" },
  };
  renderAt("/experiments?draft=copy");
  const name = (await screen.findByLabelText(
    "Experiment name",
  )) as HTMLInputElement;
  await waitFor(() => expect(name.value).toBe("Copy of Base"));
  expect(screen.getByText("Unsaved edits")).toBeTruthy();
});

it("hides a missing dataset catalog gracefully and explains the disabled preset", async () => {
  renderAt("/experiments/new");
  const preset = await screen.findByRole("button", {
    name: "Use healthcare smoke preset",
  });
  expect((preset as HTMLButtonElement).disabled).toBe(true);
  expect(
    await screen.findByText(
      "The dataset catalog isn't available in this workspace.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/Dataset catalog unavailable/)).toBeNull();
});
