// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ViewRegistry } from "../lib/contracts";
import { NotFoundView, ViewPanel, tabItems } from "./view-registry";

afterEach(cleanup);

type Tab = "alpha" | "beta";
const registry: ViewRegistry<Tab> = {
  alpha: { title: "Alpha view", Component: () => <p>alpha body</p> },
  beta: { title: "Beta view", Component: () => <p>beta body</p> },
};

it("renders the registered view and one tab per registry entry in declared order", async () => {
  const onChange = vi.fn();
  render(<ViewPanel registry={registry} order={["beta", "alpha"]} tab="alpha" panelId="probe-panel" onChange={onChange} />);
  expect(screen.getByText("alpha body")).toBeTruthy();
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Beta view", "Alpha view"]);
  expect(tabItems(registry, ["beta", "alpha"])).toEqual([
    { id: "beta", label: "Beta view" },
    { id: "alpha", label: "Alpha view" },
  ]);
  await userEvent.click(screen.getByRole("tab", { name: "Beta view" }));
  expect(onChange).toHaveBeenCalledWith("beta");
});

it("keeps the tabpanel wiring identical to the pages it replaces", () => {
  render(<ViewPanel registry={registry} order={["alpha", "beta"]} tab="alpha" panelId="probe-panel" onChange={vi.fn()} />);
  const panel = screen.getByRole("tabpanel");
  expect(panel.id).toBe("probe-panel");
  expect(panel.getAttribute("aria-labelledby")).toBe("probe-panel-tab-alpha");
  expect(screen.getByRole("tab", { name: "Alpha view" }).getAttribute("aria-controls")).toBe("probe-panel");
});

it("renders not-found for an unknown view instead of another feature", () => {
  render(<ViewPanel registry={registry} order={["alpha", "beta"]} tab="gamma" panelId="probe-panel" onChange={vi.fn()} />);
  expect(screen.getByText("This view does not exist")).toBeTruthy();
  expect(screen.queryByText("alpha body")).toBeNull();
  expect(screen.getByRole("tabpanel").getAttribute("aria-label")).toBe("Unknown view");
  cleanup();
  render(<NotFoundView what="gamma" />);
  expect(screen.getAllByText(/“gamma” is not a view on this page/).length).toBeGreaterThan(0);
});
