// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { useClients } from "../lib/clients/context";
import { clientsFor, fakeClients, pageClients, renderWithClients } from "./clients";
import { fakeServer } from "./clients";

afterEach(cleanup);

function Probe() {
  const clients = useClients();
  return <p>{typeof clients.runs.get}</p>;
}

it("provides a client for every resource and lets a test override any member", async () => {
  const clients = fakeClients({ runs: { get: async () => ({ id: "run-1" }) as never } });
  renderWithClients(<Probe />, { clients });
  expect(screen.getByText("function")).toBeTruthy();
  expect((await clients.runs.get("run-1")).id).toBe("run-1");
});

it("renders at the requested route and answers through an activated fake server", () => {
  const server = fakeServer((path) => (path === "/workspace" ? { mode: "research" } : undefined));
  const clients = clientsFor(server);
  expect(clients).toBeTruthy();
  expect(pageClients(server)).toBeTruthy();
  renderWithClients(<Probe />, { route: "/runs/run-1?view=board" });
  expect(screen.getByText("function")).toBeTruthy();
});
