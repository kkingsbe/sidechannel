// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Runs from "../../pages/Runs";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
const config = defaultFixtureConfiguration();
const run = (id: string, condition: string, status: string, extra = {}) => ({
  id,
  config: { ...config, label: "Launch study", condition: { id: condition, text: condition } },
  status,
  round: 1,
  turn: 2,
  pairId: "pair-1",
  updatedAt: "2026-11-07T12:00:00Z",
  artifacts: [],
  reports: [],
  ...extra,
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it("lists matched pairs by default with a flat Runs toggle that is remembered", async () => {
  const items = [
    run("run-e", "excluded", "failed", { failureReason: "Worker crashed" }),
    run("run-r", "reviewed", "running"),
    run("solo", "reviewed", "completed", { pairId: undefined, config: { ...config, label: "Solo run", condition: { id: "reviewed", text: "r" } } }),
  ];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => json(input.includes("/runs?") ? { items, nextOffset: null } : { items: [] })));
  render(
    <MemoryRouter initialEntries={["/runs"]}>
      <Routes>
        <Route path="/runs/*" element={<Runs />} />
      </Routes>
    </MemoryRouter>,
  );
  const table = await screen.findByRole("table", { name: "Matched pairs" });
  expect(within(table).getAllByRole("row")).toHaveLength(3);
  expect(within(table).getByRole("link", { name: "Launch study" }).getAttribute("href")).toContain("/runs/pairs/pair-1");
  expect(within(table).getByText("Worker crashed")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Runs" }));
  expect(await screen.findByRole("table", { name: "Experiment runs" })).toBeTruthy();
  expect(localStorage.getItem("sidechannel-runs-view")).toBe("runs");
});

it("duplicates a pair under a 'Copy of' name and titles the page with the experiment", async () => {
  const bodies: unknown[] = [];
  const reviewed = run("run-r", "reviewed", "completed");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.replace(/^\/api/, "");
      if (init?.method === "POST") {
        bodies.push(JSON.parse(String(init.body)));
        return json({ id: "draft-1" });
      }
      return json(path === "/pairs/pair-1" ? { runs: [reviewed], matched: true, configurationDifferences: [] } : path === "/runs/run-r" ? reviewed : { items: [] });
    }),
  );
  render(
    <MemoryRouter initialEntries={["/runs/pairs/pair-1"]}>
      <Routes>
        <Route path="/runs/*" element={<Runs />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole("heading", { level: 1, name: "Launch study" })).toBeTruthy();
  expect(screen.getByText(/pair-1/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Duplicate config/ }));
  await waitFor(() => expect(bodies).toEqual([{ name: "Copy of Launch study" }]));
});
