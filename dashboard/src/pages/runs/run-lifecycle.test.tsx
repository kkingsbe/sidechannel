// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import { clientsFor, fakeClients, fakeServer, renderWithClients } from "../../test/clients";
import { RunList } from "./run-list";
import { RunDetail } from "./run-detail";
import type { Run } from "../../lib/types";

afterEach(cleanup);

const config = defaultFixtureConfiguration();
const make = (id: string, status: string, extra: Partial<Run> = {}) =>
  ({ id, config: { ...config, label: "Study " + id }, status, launchKey: "key-" + id, configHash: "h", createdAt: "2026-11-07T12:00:00Z", updatedAt: "2026-11-07T12:01:00Z", round: 1, turn: 1, board: [], artifacts: [], reports: [], operations: {}, scenarioState: null, usage: {}, ...extra }) as unknown as Run;

function listServer(rows: Run[]) {
  const server = fakeServer((path, options) => {
    if (path === "/runs/bulk") return { action: JSON.parse(String(options?.body)).action, results: [], succeeded: 0, failed: 0 };
    if (path.startsWith("/runs")) return { items: rows, total: rows.length, nextOffset: null };
    throw new Error("Unexpected " + path);
  });
  return server;
}

it("lets finished runs be selected, leaves active runs unselectable, and archives the selection in one request", async () => {
  const rows = [make("a1", "failed"), make("b2", "interrupted"), make("c3", "running")];
  const server = listServer(rows);
  localStorage.setItem("sidechannel-runs-view", "runs");
  renderWithClients(<RunList />, { clients: clientsFor(server), route: "/runs" });
  const user = userEvent.setup();
  const running = await screen.findByRole("checkbox", { name: /Select Study c3/ });
  expect((running as HTMLInputElement).disabled).toBe(true);
  await user.click(screen.getByRole("checkbox", { name: /Select Study a1/ }));
  await user.click(screen.getByRole("checkbox", { name: /Select Study b2/ }));
  expect(within(screen.getByRole("region", { name: "Selected runs" })).getByText("2 selected")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Archive" }));
  await waitFor(() => expect(server.calls.find((call) => call.path === "/runs/bulk")).toBeTruthy());
  expect(server.calls.find((call) => call.path === "/runs/bulk")!.body).toEqual({ action: "archive", ids: ["a1", "b2"] });
});

it("names every run in the delete confirmation, says it cannot be undone, and sends nothing until confirmed", async () => {
  const rows = [make("a1", "failed"), make("b2", "cancelled")];
  const server = listServer(rows);
  localStorage.setItem("sidechannel-runs-view", "runs");
  renderWithClients(<RunList />, { clients: clientsFor(server), route: "/runs" });
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText("Select all finished runs on this page"));
  await user.click(screen.getByRole("button", { name: "Delete…" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText("Delete 2 runs permanently?")).toBeTruthy();
  expect(within(dialog).getByText(/This cannot be undone/)).toBeTruthy();
  const named = within(dialog).getByRole("list", { name: "Runs to delete" });
  expect(named.textContent).toContain("Study a1");
  expect(named.textContent).toContain("Study b2");
  expect(server.calls.some((call) => call.path === "/runs/bulk")).toBe(false);
  await user.click(within(dialog).getByRole("button", { name: "Keep runs" }));
  expect(server.calls.some((call) => call.path === "/runs/bulk")).toBe(false);
  await user.click(screen.getByRole("button", { name: "Delete…" }));
  await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete 2 runs" }));
  await waitFor(() => expect(server.calls.find((call) => call.path === "/runs/bulk")).toBeTruthy());
  expect(server.calls.find((call) => call.path === "/runs/bulk")!.body).toEqual({ action: "delete", ids: ["a1", "b2"], confirm: true });
});

it("shows archived runs on request and offers to unarchive them; refusals are listed per run", async () => {
  const rows = [make("a1", "completed", { archivedAt: "2026-11-08T00:00:00Z" })];
  const server = fakeServer((path, options) => {
    if (path === "/runs/bulk") return { action: "unarchive", results: [{ id: "a1", ok: false, status: 409, error: "Run a1 is no longer terminal" }], succeeded: 0, failed: 1 };
    return { items: rows, total: 1, nextOffset: null };
  });
  localStorage.setItem("sidechannel-runs-view", "runs");
  renderWithClients(<RunList />, { clients: clientsFor(server), route: "/runs?archived=only" });
  const user = userEvent.setup();
  expect((await screen.findAllByText("Archived")).length).toBeGreaterThan(0);
  expect(server.calls[0]!.path).toContain("archived=only");
  await user.click(await screen.findByRole("checkbox", { name: /Select Study a1/ }));
  await user.click(screen.getByRole("button", { name: "Unarchive" }));
  expect(await screen.findByText(/could not be unarchived/)).toBeTruthy();
  expect(screen.getByText(/no longer terminal/)).toBeTruthy();
});

it("offers archive and delete on a finished run's detail page and confirms before deleting", async () => {
  const run = make("run-1", "failed");
  const calls: string[] = [];
  const clients = fakeClients({ runs: { get: async () => run, progress: async () => ({ id: "run-1", status: "failed", round: 1, turn: 1, updatedAt: run.updatedAt, observedAt: run.updatedAt, executionPhase: "action", rounds: 3, usage: {} }) as never, remove: async () => { calls.push("remove"); return {}; }, archive: async () => { calls.push("archive"); return {}; } } });
  renderWithClients(<Routes><Route path="/runs/:id" element={<RunDetail />} /><Route path="/runs" element={<p>run list</p>} /></Routes>, { clients, route: "/runs/run-1?returnTo=%2Fruns" });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Archive" }));
  await waitFor(() => expect(calls).toEqual(["archive"]));
  await user.click(screen.getByRole("button", { name: "Delete…" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText(/This cannot be undone/)).toBeTruthy();
  expect(calls).toEqual(["archive"]);
  await user.click(within(dialog).getByRole("button", { name: "Delete run" }));
  await waitFor(() => expect(calls).toEqual(["archive", "remove"]));
  expect(await screen.findByText("run list")).toBeTruthy();
});

it("does not offer archive or delete while a run is still active", async () => {
  const run = make("run-1", "running");
  const clients = fakeClients({ runs: { get: async () => run, progress: async () => ({ id: "run-1", status: "running", round: 1, turn: 1, updatedAt: run.updatedAt, observedAt: run.updatedAt, executionPhase: "action", rounds: 3, usage: {} }) as never } });
  renderWithClients(<Routes><Route path="/runs/:id" element={<RunDetail />} /></Routes>, { clients, route: "/runs/run-1" });
  await screen.findByText(/Round 1 of/);
  expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete…" })).toBeNull();
});
