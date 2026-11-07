// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReviewHistoryRow } from "./review-history";

afterEach(cleanup);

it("keeps the reviewer, decision, meta, rationale and note structure", () => {
  render(
    <ReviewHistoryRow
      reviewer="Reviewer A"
      decision="uncertain"
      meta={<>window · r2 · 12:00</>}
      rationale="The record does not establish execution."
      note={<>Initial judgment blinded · Revises abc123</>}
    />,
  );
  expect(screen.getByText("Reviewer A")).toBeTruthy();
  expect(screen.getByText("uncertain")).toBeTruthy();
  expect(screen.getByText(/window · r2/)).toBeTruthy();
  expect(
    screen.getByText("The record does not establish execution."),
  ).toBeTruthy();
  expect(screen.getByText(/Revises abc123/)).toBeTruthy();
});
