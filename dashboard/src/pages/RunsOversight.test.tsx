// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import type { MonitorDefinition, MonitorEvaluation } from "@sidechannel/contracts/browser";
import type { MonitorComparison } from "../lib/types";
import { activate, fakeClients, fakeServer, renderWithClients, renderWithServer } from "../test/clients";
import Runs from "./Runs";
import Oversight from "./Oversight";
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
afterEach(() => {
  cleanup();
  localStorage.clear();
});
it("aligns exact pair wording and available outputs while retaining a failed condition", async () => {
  const a = run("reviewed", "completed", "Exact reviewed wording\nSecond line");
  const b = {
    ...run("excluded", "failed", "Exact excluded wording"),
    failureReason: "Worker failed before reporting",
  };
  activate(fakeServer((path) => path === "/pairs/pair"
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
        : b));
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
  const mounted = renderWithClients(
    <Routes>
      <Route path="/*" element={<Oversight />} />
    </Routes>,
    {
      route: "/",
      clients: fakeClients({
        monitor: { evaluations: async () => ({ items: [], nextCursor: null }) },
      }),
    },
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
  renderWithClients(
    <Routes>
      <Route path="/*" element={<Oversight />} />
    </Routes>,
    {
      route: "/?run=source",
      clients: fakeClients({
        monitor: {
          history: async () => ({
            items: [] as MonitorDefinition[],
            nextCursor: null,
          }),
        },
        runs: { list: async () => ({ items: [], total: 0, nextOffset: null }) },
      }),
    },
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
  }) as unknown as MonitorEvaluation;
  renderWithClients(
    <Routes>
      <Route path="/oversight/*" element={<Oversight />} />
    </Routes>,
    {
      route: "/oversight?view=jobs",
      clients: fakeClients({
        monitor: {
          evaluations: async (query) => {
            const after = query?.after ?? null;
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
          },
          evaluation: async () => job("evaluation-third-full-id"),
          comparison: async () => ({ comparisons: [] }) as unknown as MonitorComparison,
          exportEnvelope: async () => ({ preview: { runs: [] } }) as never,
          history: async () => ({
            items: [] as MonitorDefinition[],
            nextCursor: null,
          }),
        },
      }),
    },
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

