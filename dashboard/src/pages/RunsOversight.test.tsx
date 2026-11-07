// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Runs from "./Runs";
import Oversight from "./Oversight";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
const config = defaultFixtureConfiguration();
const run = (id: string, status: string, wording: string) => ({
  id,
  config: { ...config, condition: { id, text: wording } },
  status,
  round: 1,
  turn: 2,
  updatedAt: "2026-11-07T12:00:00Z",
  artifacts: [],
  reports: [],
});
function mock(handler: (path: string) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (input: string) =>
        new Response(JSON.stringify(handler(input.replace(/^\/api/, ""))), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});
it("aligns exact pair wording and available outputs while retaining a failed condition", async () => {
  const a = run("reviewed", "completed", "Exact reviewed wording\nSecond line");
  const b = {
    ...run("excluded", "failed", "Exact excluded wording"),
    failureReason: "Worker failed before reporting",
  };
  mock((path) =>
    path === "/pairs/pair"
      ? {
          runs: [a, b],
          matched: true,
          configurationDifferences: ["condition.id", "condition.text"],
        }
      : path === "/runs/reviewed"
        ? {
            ...a,
            artifacts: [
              { version: 1, frozen: true, value: { result: "Final value" } },
            ],
            reports: [
              { agentId: "agent-1", raw: "Exact final report", parsed: {} },
            ],
          }
        : b,
  );
  render(
    <MemoryRouter
      initialEntries={[
        "/runs/pairs/pair?returnTo=%2Fruns%3Fstatus%3Dfailed%26offset%3D25",
      ]}
    >
      <Routes>
        <Route path="/runs/*" element={<Runs />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(
    await screen.findByText("Worker failed before reporting"),
  ).toBeTruthy();
  expect(screen.getAllByText("Exact excluded wording").length).toBeGreaterThan(
    0,
  );
  expect(await screen.findByText("Frozen version 1")).toBeTruthy();
  expect(screen.getByText("Exact final report")).toBeTruthy();
  expect(screen.getByText("No final reports recorded.")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "All runs" }).getAttribute("href"),
  ).toBe("/runs?status=failed&offset=25");
  expect(
    within(
      screen.getByRole("table", { name: "Differing frozen settings" }),
    ).getByText("Exact condition wording"),
  ).toBeTruthy();
});
it("defaults oversight to evaluations and keeps setup explicit with visible prerequisites", async () => {
  mock((path) =>
    path.startsWith("/monitor-evaluations")
      ? { items: [], nextCursor: null }
      : path.startsWith("/runs?")
        ? { items: [], nextOffset: null }
        : path.startsWith("/monitor-definitions/history")
          ? { items: [], nextCursor: null }
          : { revision: 1 },
  );
  const mounted = render(
    <MemoryRouter>
      <Oversight />
    </MemoryRouter>,
  );
  expect(
    await screen.findByRole("tab", { name: "Evaluation jobs" }),
  ).toHaveProperty("ariaSelected", "true");
  expect(
    screen.queryByRole("button", { name: "Preview four views" }),
  ).toBeNull();
  expect(
    screen.getByRole("link", { name: "New evaluation" }).getAttribute("href"),
  ).toBe("/oversight/new");
  mounted.unmount();
  render(
    <MemoryRouter initialEntries={["/?run=source"]}>
      <Oversight />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Enter a monitor provider.")).toBeTruthy();
  expect(screen.getByText("Enter a monitor model.")).toBeTruthy();
  expect(
    (
      screen.getByRole("button", {
        name: "Preview four views",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

it("restores an evaluation cursor page after detail navigation and retains previous-page navigation", async () => {
  const job = (id: string) => ({
    id,
    settings: { model: { provider: "fixture", id: "Independent monitor" } },
    runIds: ["source"],
    definition: { id: "definition-7", revision: 7, outcomes: [] },
    status: "completed",
    createdAt: "2026-11-07T12:00:00Z",
    results: [],
  });
  mock((path) => {
    const url = new URL(path, "http://localhost");
    if (url.pathname === "/monitor-evaluations") {
      const after = url.searchParams.get("after");
      return {
        items: [
          job(
            after === "cursor-2"
              ? "evaluation-third-full-id"
              : after === "cursor-1"
                ? "evaluation-second-full-id"
                : "evaluation-first-full-id",
          ),
        ],
        nextCursor:
          after === "cursor-2"
            ? null
            : after === "cursor-1"
              ? "cursor-2"
              : "cursor-1",
      };
    }
    if (url.pathname.endsWith("/comparison")) return { comparisons: [] };
    if (url.pathname.endsWith("/export")) return { preview: { runs: [] } };
    if (url.pathname.startsWith("/monitor-evaluations/"))
      return job("evaluation-third-full-id");
    if (url.pathname === "/monitor-definitions/history")
      return { items: [], nextCursor: null };
    if (url.pathname === "/runs") return { items: [], nextOffset: null };
    return { revision: 7 };
  });
  render(
    <MemoryRouter initialEntries={["/oversight?view=jobs"]}>
      <Routes>
        <Route path="/oversight/*" element={<Oversight />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText("evaluation-first-full-id");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("evaluation-second-full-id");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("evaluation-third-full-id");
  const open = screen.getByRole("link", {
    name: /^Independent monitor - 1 source run - revision 7/,
  });
  expect(open.getAttribute("href")).toContain(
    "jobCursor%3Dcursor-1%26jobCursor%3Dcursor-2",
  );
  fireEvent.click(open);
  expect(
    await screen.findByRole("heading", {
      name: /^Independent monitor - 1 source run - revision 7/,
    }),
  ).toBeTruthy();
  expect(screen.getByText("evaluation-third-full-id")).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "Oversight workspace" }));
  await screen.findByText("evaluation-third-full-id");
  expect(screen.getByText("Page 3")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  await screen.findByText("evaluation-second-full-id");
  expect(screen.getByText("Page 2")).toBeTruthy();
});

const event = (
  sequence: number,
  type: string,
  agentId: string,
  data: unknown,
  extra: Record<string, unknown> = {},
) => ({
  schemaVersion: 1,
  id: `event-${sequence}`,
  runId: "run-1",
  sequence,
  type,
  timestamp: "2026-11-07T12:00:00Z",
  agentId,
  round: 1,
  turn: sequence,
  data,
  ...extra,
});
function runRoutes(events: ReturnType<typeof event>[], overrides = {}) {
  const base = {
    ...run("run-1", "completed", "wording"),
    configHash: "hash",
    board: [],
    ...overrides,
  };
  mock((path) => {
    const url = new URL(path, "http://localhost");
    const parts = url.pathname.split("/");
    if (url.pathname === "/runs/run-1" || url.pathname === "/runs/run-1/progress") return base;
    if (url.pathname === "/runs/run-1/events") {
      const type = url.searchParams.get("type");
      const rows = events.filter((e) => !type || e.type === type);
      return { events: rows, nextCursor: rows.at(-1)?.sequence ?? 0, hasMore: false };
    }
    if (parts[3] === "reports")
      return { items: base.reports, total: base.reports.length, nextOffset: null };
    if (parts[3] === "outcomes") return [];
    return { items: [] };
  });
}
const renderRun = (search: string) =>
  render(
    <MemoryRouter initialEntries={["/runs/run-1" + search]}>
      <Routes>
        <Route path="/runs/*" element={<Runs />} />
      </Routes>
    </MemoryRouter>,
  );

it("groups private memory by agent with a line diff and collapses unchanged rewrites", async () => {
  runRoutes([
    event(1, "memory_updated", "pharmacy", { before: { version: 0, notes: "" }, after: { version: 1, notes: "Line one\nLine two" } }),
    event(2, "memory_updated", "clinical", { before: { version: 0, notes: "" }, after: { version: 1, notes: "Clinical notes" } }),
    event(3, "memory_updated", "pharmacy", { before: { version: 1, notes: "Line one\nLine two" }, after: { version: 2, notes: "Line one\nLine two" } }),
    event(4, "memory_updated", "pharmacy", { before: { version: 2, notes: "Line one\nLine two" }, after: { version: 3, notes: "Line one\nLine three" } }),
  ]);
  renderRun("?view=memory");
  expect((await screen.findAllByText(/Clinical notes/)).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("tab", { name: /pharmacy/ }));
  expect(screen.getByText("Unchanged rewrite")).toBeTruthy();
  const diff = screen.getByRole("group", { name: "Changes in version 3" });
  expect(within(diff).getByText(/Line two/).closest("div")?.className).toContain("line-diff-removed");
  expect(within(diff).getByText(/Line three/).closest("div")?.className).toContain("line-diff-added");
  expect(screen.queryByText(/Clinical notes/)).toBeNull();
});

it("renders final reports as labelled sections beside recorded event counts", async () => {
  runRoutes(
    [
      event(1, "tool_admitted", "pharmacy", { call: { name: "read_role_data" } }),
      event(2, "tool_admitted", "pharmacy", { call: { name: "read_role_data" } }),
      event(3, "board_post", "pharmacy", { after: { id: "m1" } }),
      event(4, "board_delivery", "pharmacy", { after: [] }),
    ],
    {
      reports: [
        {
          agentId: "pharmacy",
          raw: '{"ownActions":"Read twice.\\nPosted once.","observations":"o","limitations":"l"}',
          parsed: { ownActions: "Read twice.\nPosted once.", observations: "o", limitations: "l" },
        },
      ],
    },
  );
  renderRun("?view=reports");
  expect(await screen.findByRole("heading", { name: "Own actions" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Limitations" })).toBeTruthy();
  const strip = await screen.findByLabelText("Recorded for pharmacy");
  await waitFor(() => expect(within(strip).getByText("Role data reads").nextSibling?.textContent).toBe("2"));
  expect(within(strip).getByText("Board posts").nextSibling?.textContent).toBe("1");
});

it("shows run-not-found with a way back and the demo-data note", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) =>
      input.endsWith("/workspace")
        ? new Response(JSON.stringify({ mode: "demo" }), { status: 200 })
        : new Response(JSON.stringify({ error: "Run not found" }), { status: 404 }),
    ),
  );
  renderRun("");
  expect(await screen.findByRole("heading", { name: "Run not found" })).toBeTruthy();
  expect(screen.getByRole("link", { name: /Back to Runs/ }).getAttribute("href")).toBe("/runs");
  await screen.findByText(/demo data resets/);
});

it("leads the pair page with a comparability verdict, reviewed first", async () => {
  const reviewed = { ...run("reviewed", "failed", "R"), round: 1, turn: 3 };
  const excluded = { ...run("excluded", "failed", "E"), round: 2, turn: 8 };
  mock((path) =>
    path === "/pairs/pair"
      ? { runs: [excluded, reviewed], matched: true, configurationDifferences: [] }
      : path === "/runs/reviewed"
        ? reviewed
        : path === "/runs/excluded"
          ? excluded
          : { items: [] },
  );
  render(
    <MemoryRouter initialEntries={["/runs/pairs/pair"]}>
      <Routes>
        <Route path="/runs/*" element={<Runs />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(
    await screen.findByText(/Not comparable: runs stopped at different points \(reviewed R1\/T3 failed, excluded R2\/T8 failed\)/),
  ).toBeTruthy();
  const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(headings.indexOf("reviewed")).toBeLessThan(headings.indexOf("excluded"));
  expect(screen.getByRole("button", { name: /Duplicate config/ })).toBeTruthy();
});
