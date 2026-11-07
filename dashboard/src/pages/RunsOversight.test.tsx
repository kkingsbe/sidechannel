// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { activate, fakeServer, renderWithServer } from "../test/clients";
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
  activate(fakeServer((path: string) => handler(path)));
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
  renderWithServer(
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
  const mounted = renderWithServer(
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
  renderWithServer(
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
  renderWithServer(
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
    name: "Independent monitor - 1 source run - revision 7",
  });
  expect(open.getAttribute("href")).toContain(
    "jobCursor%3Dcursor-1%26jobCursor%3Dcursor-2",
  );
  fireEvent.click(open);
  expect(
    await screen.findByRole("heading", {
      name: "Independent monitor - 1 source run - revision 7",
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
