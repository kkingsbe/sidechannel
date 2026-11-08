// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import { clientsFor, fakeServer, renderWithClients } from "../../test/clients";
import { FakeEventSource } from "../../testing/fake-event-source";
import Runs from "../Runs";

const config = defaultFixtureConfiguration();
const runOf = (status: string) => ({ id: "run-1", config, configHash: "abcdef0123456789", status, round: 1, turn: 1, createdAt: "2026-11-07T12:00:00Z", updatedAt: "2026-11-07T12:00:00Z", artifacts: [], reports: [], board: [] });
const event = (sequence: number, type = "turn_started") => ({ schemaVersion: 1, id: `e${sequence}`, runId: "run-1", sequence, type, timestamp: "2026-11-07T12:00:00Z", agentId: "alpha", round: 1, turn: 1, data: {} });
const turns = [{ agentId: "alpha", round: 1, turn: 1, firstSequence: 2, lastSequence: 5, eventCount: 4, modelCalls: 0, failures: 0 }];

function serverFor(status: string) {
  return fakeServer((path) => {
    if (path === "/runs/run-1" || path === "/runs/run-1/progress") return runOf(status);
    if (path.startsWith("/runs/run-1/events?")) return { events: [event(4), event(5)], hasMore: true, nextCursor: 5 };
    if (path === "/runs/run-1/turns") return { turns };
    if (path.startsWith("/runs/run-1/analyses") || path.startsWith("/monitor-evaluations")) return { items: [] };
    if (path === "/runs/run-1/outcomes") return [];
    throw new Error("Unexpected request " + path);
  });
}
const open = (status: string, entry = "/run-1") =>
  renderWithClients(<Runs />, { route: entry, clients: clientsFor(serverFor(status)) });

beforeEach(() => { FakeEventSource.reset(); vi.stubGlobal("EventSource", FakeEventSource); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

it("opens an active run at its newest turn and appends streamed events", async () => {
  open("running");
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
  const source = FakeEventSource.instances[0]!;
  expect(source.url).toContain("after=5");
  act(() => source.open());
  expect(await screen.findByText("● Live")).toBeTruthy();
  act(() => source.emit("harness_event", event(6, "board_posted")));
  expect(await screen.findByText("board posted", { selector: "strong" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Load earlier turns" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
});

it("opens a finished run at its first event without streaming, and jumps to a turn from the navigator", async () => {
  open("completed");
  expect(await screen.findByRole("button", { name: "Load later turns" })).toBeTruthy();
  expect(FakeEventSource.instances).toHaveLength(0);
  fireEvent.change(await screen.findByLabelText("Jump to turn"), { target: { value: "2" } });
  await waitFor(() => expect(screen.getByLabelText("Jump to turn")).toBeTruthy());
});
