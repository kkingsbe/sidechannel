// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ValidationStatus } from "@sidechannel/contracts/browser";
import { ValidationStatusBadge, validationReasons } from "./validation-status-badge";

afterEach(cleanup);

it.each([
  ["validated", "Validated", "badge-success"],
  ["tentative", "Tentative", "badge-info"],
  ["unreliable", "Unreliable", "badge-danger"],
  ["unvalidated", "Unvalidated", "badge-warning"],
] as [ValidationStatus, string, string][])("renders %s with its tone", (status, label, tone) => {
  render(<ValidationStatusBadge validation={{ status, reasons: [] }} />);
  const badge = screen.getByText(label);
  expect(badge.className).toContain(tone);
  expect(badge.closest("[data-validation-status]")?.getAttribute("data-validation-status")).toBe(status);
});

it("shows the reasons on hover and to assistive technology", () => {
  render(<ValidationStatusBadge validation={{ status: "unreliable", reasons: ["kappa 0.31 is below 0.4", "2 contested windows excluded"] }} />);
  const wrapper = screen.getByText("Unreliable").closest("[title]")!;
  expect(wrapper.getAttribute("title")).toBe("kappa 0.31 is below 0.4; 2 contested windows excluded");
  expect(wrapper.getAttribute("aria-label")).toContain("kappa 0.31 is below 0.4");
});

it("states plainly when a validated code lists no reasons", () => {
  expect(validationReasons({ status: "validated", reasons: [] })).toBe("Meets every validation rule.");
  expect(validationReasons({ status: "tentative", reasons: [] })).toBe("No reason recorded.");
});
