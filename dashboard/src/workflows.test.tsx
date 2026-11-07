// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import Experiments from "./pages/Experiments";
import Runs from "./pages/Runs";
import Oversight from "./pages/Oversight";
import { WindowInspector } from "./pages/Analysis";
import type { AnalysisJob, WindowDetail } from "./lib/analysis-types";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import type { Run } from "./lib/types";
const config = defaultFixtureConfiguration();
const run: Run = {
  id: "run-1",
  config,
  status: "completed",
  configHash: "fixture-hash",
  launchKey: "key",
  createdAt: "2026-11-07T12:00:00Z",
  updatedAt: "2026-11-07T12:01:00Z",
  round: 3,
  turn: 6,
  board: [],
  artifacts: [],
  reports: [],
  operations: {},
  scenarioState: null,
  usage: {},
};
type Handler = (path: string, options?: RequestInit) => unknown;
function mockApi(handler: Handler) {
  return vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, options?: RequestInit) => {
      const value = handler(input.replace(/^\/api/, ""), options);
      return new Response(JSON.stringify(value), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}
function setupConfig(extra: Handler = () => undefined) {
  mockApi((path, options) => {
    const custom = extra(path, options);
    if (custom !== undefined) return custom;
    if (path === "/config/default") return config;
    if (path === "/drafts") return [];
    if (path === "/config/schema") return { fields: [] };
    throw new Error("Unexpected API route " + path);
  });
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("experiment form workflow", () => {
  it("validates ordinary form fields and explicitly launches one idempotent matched pair", async () => {
    let submitted: any;
    setupConfig((path, options) => {
      if (path === "/config/validate") return { valid: true, errors: [] };
      if (path === "/pairs") {
        submitted = JSON.parse(String(options?.body));
        return [
          run,
          {
            ...run,
            id: "run-2",
            config: {
              ...config,
              condition: {
                id: "excluded",
                version: "1",
                text: "Excluded wording",
              },
            },
          },
        ];
      }
    });
    render(
      <MemoryRouter initialEntries={["/experiments/new"]}>
        <Experiments />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Experiment name");
    await user.clear(name);
    await user.type(name, "Pilot matched pair");
    await user.click(
      screen.getByRole("button", { name: "Validate & review launch" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Launch matched pair" }),
    );
    expect(submitted).toBeUndefined();
    const confirm = await screen.findByRole("group", { name: "Confirm launch" });
    expect(within(confirm).getByText(/3 rounds × 3 admitted tool calls/)).toBeTruthy();
    await user.click(
      within(confirm).getByRole("button", { name: /Confirm: start 2 runs/ }),
    );
    await screen.findByText("Matched pair queued");
    expect(submitted.config.label).toBe("Pilot matched pair");
    expect(submitted.config.scheduler.rounds).toBe(3);
    expect(submitted.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      screen.getAllByRole("link", { name: /reviewed|excluded/ }),
    ).toHaveLength(2);
    expect(screen.queryByLabelText(/json editor/i)).toBeNull();
  });
  it("warns about a near-identical relaunch, keeps earlier pairs listed and locks the form after launch", async () => {
    let launches = 0;
    setupConfig((path) => {
      if (path === "/config/validate") return { valid: true, errors: [] };
      if (path === "/pairs") {
        launches += 1;
        return [{ ...run, id: `run-${launches}` }];
      }
    });
    render(
      <MemoryRouter initialEntries={["/experiments/new"]}>
        <Experiments />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Experiment name");
    await user.type(name, "First pair");
    await user.click(
      screen.getByRole("button", { name: "Validate & review launch" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Launch matched pair" }),
    );
    expect(screen.queryByText(/near-identical/)).toBeNull();
    await user.click(
      await screen.findByRole("button", { name: /Confirm: start 2 runs/ }),
    );
    await screen.findByText("Matched pair queued");
    expect((name as HTMLInputElement).closest("fieldset")?.disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Configure another" }));
    expect((name as HTMLInputElement).closest("fieldset")?.disabled).toBe(false);
    await user.clear(name);
    await user.type(name, "Second pair");
    await user.click(
      screen.getByRole("button", { name: "Validate & review launch" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Launch matched pair" }),
    );
    expect(await screen.findByText(/near-identical pair at/)).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: /Confirm: start 2 runs/ }),
    );
    await waitFor(() => expect(launches).toBe(2));
    expect(await screen.findByText("Launched this session")).toBeTruthy();
    expect(screen.getByText("First pair")).toBeTruthy();
  });
  it("opens the pair page after launch when the response carries a pair id", async () => {
    setupConfig((path) => {
      if (path === "/config/validate") return { valid: true, errors: [] };
      if (path === "/pairs") return [{ ...run, pairId: "pair-9" }];
    });
    function Where() {
      return <output aria-label="where">{useLocation().pathname}</output>;
    }
    render(
      <MemoryRouter initialEntries={["/experiments/new"]}>
        <Where />
        <Experiments />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Experiment name"), "Pairs");
    await user.click(
      screen.getByRole("button", { name: "Validate & review launch" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Launch matched pair" }),
    );
    await user.click(
      await screen.findByRole("button", { name: /Confirm: start 2 runs/ }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("where").textContent).toBe(
        "/runs/pairs/pair-9",
      ),
    );
  });
  it("recovers a structurally incomplete saved draft without hiding or overwriting it", async () => {
    setupConfig((path) =>
      path === "/drafts/incomplete"
        ? {
            id: "incomplete",
            revision: 4,
            config: { label: "Unfinished draft", roles: [null] },
          }
        : undefined,
    );
    render(
      <MemoryRouter initialEntries={["/experiments?draft=incomplete"]}>
        <Experiments />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Incomplete experiment draft" });
    expect(screen.getByLabelText("Draft name").getAttribute("value")).toBe(
      "Unfinished draft",
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Complete with supported default fields",
      }),
    );
    await screen.findByLabelText("Experiment name");
    expect(screen.getByLabelText("Experiment name").getAttribute("value")).toBe(
      "Unfinished draft",
    );
    expect(screen.getByText("Unsaved edits")).toBeTruthy();
  });
});
describe("canonical evidence inspection", () => {
  it("looks up a board message by its own ID and never treats its sequence as an event sequence", async () => {
    const message = {
      id: "message-1",
      runId: "run-1",
      authorId: "alpha",
      sequence: 1,
      timestamp: run.createdAt,
      text: "<img src=x onerror=alert(1)> board evidence",
    };
    mockApi((path) => {
      if (path === "/runs/run-1" || path === "/runs/run-1/progress") return run;
      if (path.startsWith("/runs/run-1/board?"))
        return { items: [message], total: 1, nextOffset: null, deliveries: [] };
      if (path === "/runs/run-1/board/message-1") return message;
      throw new Error("Unexpected route " + path);
    });
    render(
      <MemoryRouter initialEntries={["/run-1?view=board"]}>
        <Runs />
      </MemoryRouter>,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Inspect" }),
    );
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Board message");
    expect(dialog.textContent).toContain("message-1");
    expect(dialog.textContent).toContain("board evidence");
    expect(dialog.querySelector("img")).toBeNull();
    expect(
      (fetch as ReturnType<typeof vi.fn>).mock.calls.some((call) =>
        String(call[0]).includes("/events/"),
      ),
    ).toBe(false);
  });
});
describe("independent human run outcomes", () => {
  it("records a versioned human reference without Jev and exposes no single-reviewer finalization", async () => {
    const outcome = {
      id: "violation",
      name: "Individual violation",
      definition: "Executed prohibited action",
      qualifyingCriteria: "Actual action evidence",
      presentGuidance: "Cite an executed action",
      absentGuidance: "Review complete observable evidence",
      uncertainGuidance: "State missing evidence",
      examples: "",
      exclusions: "Proposals alone",
      archived: false,
    };
    const definition = {
      id: "definition:1",
      schemaVersion: 1,
      revision: 1,
      createdAt: run.createdAt,
      questions: "Assess each outcome.",
      outcomes: [outcome],
    };
    let posted: any;
    mockApi((path, options) => {
      if (path === "/monitor-definitions") return definition;
      if (path.startsWith("/monitor-definitions/history"))
        return { items: [definition], nextCursor: null };
      if (path.startsWith("/monitor-evaluations"))
        return { items: [], nextCursor: null };
      if (path.startsWith("/runs?")) return { items: [run] };
      if (path === "/runs/run-1/reviews/context")
        return {
          runId: run.id,
          evidenceRevision: "a".repeat(64),
          definition,
          sourceStatus: "completed",
          eventCount: 5,
          sequenceBoundary: 5,
        };
      if (path === "/runs/run-1/outcomes") return [];
      if (path.startsWith("/runs/run-1/reviews/latest")) return null;
      if (path.startsWith("/runs/run-1/reviews")) {
        if (options?.method === "POST") {
          posted = JSON.parse(String(options.body));
          return {
            ...posted,
            id: "review-1",
            revision: 1,
            sequence: 1,
            createdAt: run.createdAt,
            outcomeDefinition: outcome,
          };
        }
        return { items: [], nextCursor: null };
      }
      throw new Error("Unexpected route " + path);
    });
    render(
      <MemoryRouter initialEntries={["/?view=references&run=run-1"]}>
        <Oversight />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText("Claimed reviewer identity"),
      "Reviewer A",
    );
    await user.selectOptions(
      screen.getByLabelText("Human judgment"),
      "uncertain",
    );
    await user.type(
      screen.getByLabelText("Rationale / unresolved questions"),
      "The available record does not establish execution.",
    );
    await user.click(
      screen.getByRole("button", { name: "Save provisional reference" }),
    );
    await screen.findByText(/Human outcome review appended/);
    expect(posted.definitionRevisionId).toBe("definition:1");
    expect(posted.evidenceRevision).toBe("a".repeat(64));
    expect(posted.decision).toBe("uncertain");
    expect(posted).not.toHaveProperty("analysisId");
    expect(
      screen.queryByRole("button", { name: /finalize|override/i }),
    ).toBeNull();
  });
});
describe("blinded evidence inspection", () => {
  it("shows exact source IDs while hiding model probabilities and prior judgments until the initial review", async () => {
    mockApi((path) => {
      if (path.includes("/reviews"))
        return {
          items: [
            {
              id: "prior",
              analysisId: "blind-job",
              subjectId: "w1",
              scope: "window",
              codeId: "visibility",
              definitionRevision: "r1",
              evidenceRevision: "hash",
              reviewer: "Other reviewer",
              decision: "present",
              rationale: "Model suggested 95 percent.",
              eventIds: [],
              stepIds: [],
              predictionsVisible: true,
              revision: 1,
              createdAt: run.createdAt,
            },
          ],
          nextCursor: null,
        };
      if (path === "/runs/run-1/events/canonical-event-1")
        return {
          id: "canonical-event-1",
          sequence: 1,
          type: "assistant_message",
          data: { message: "Recorded agent text" },
        };
      throw new Error("Unexpected route " + path);
    });
    const job = {
      id: "blind-job",
      runId: "run-1",
      manifest: {
        codebook: {
          id: "r1",
          revision: 1,
          codes: [
            {
              id: "visibility",
              code: "VISIBILITY",
              name: "Visibility",
              enabled: true,
              archived: false,
            },
          ],
        },
      },
    } as AnalysisJob;
    const detail = {
      window: {
        id: "w1",
        index: 0,
        startStep: 1,
        endStep: 12,
        status: "completed",
        eventIds: ["canonical-event-1"],
        stepIds: ["step-1"],
        state: '{"evidence":"Recorded agent text"}',
        results: [{ codeId: "visibility", probability: 0.95 }],
      },
      sourceEventIds: ["canonical-event-1"],
    } as WindowDetail;
    render(
      <MemoryRouter>
        <WindowInspector detail={detail} job={job} blind />
      </MemoryRouter>,
    );
    await screen.findByText(/Blind initial review/);
    expect(screen.queryByText(/95\.0%|Model suggested 95/)).toBeNull();
    expect(screen.getByText("Canonical source events (1)")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Exact source event" })
        .getAttribute("href"),
    ).toContain("evidence=canonical-event-1");
    expect(await screen.findByText("Recorded agent text")).toBeTruthy();
    expect(screen.getByText(/Prior judgments are hidden/)).toBeTruthy();
  });
});
