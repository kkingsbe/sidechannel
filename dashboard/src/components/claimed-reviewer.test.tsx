// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { REVIEWER_STORAGE_KEY, useClaimedReviewer } from "./claimed-reviewer";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function Probe() {
  const { reviewer, identifyReviewer } = useClaimedReviewer();
  return (
    <>
      <input
        aria-label="reviewer"
        value={reviewer}
        onChange={(event) => identifyReviewer(event.target.value)}
      />
      <p>{localStorage.getItem(REVIEWER_STORAGE_KEY) ?? "empty"}</p>
    </>
  );
}

it("reads and writes the single claimed-reviewer key", async () => {
  localStorage.setItem(REVIEWER_STORAGE_KEY, "Reviewer A");
  render(<Probe />);
  expect(screen.getByLabelText("reviewer").getAttribute("value")).toBe(
    "Reviewer A",
  );
  await userEvent.type(screen.getByLabelText("reviewer"), "B");
  expect(screen.getByText("Reviewer AB")).toBeTruthy();
});
