// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CancelJobButton } from "./cancel-job-button";

afterEach(cleanup);
it("renders nothing for a terminal job and confirms before cancelling", async () => {
  const onCancel = vi.fn();
  const { rerender } = render(
    <CancelJobButton
      active={false}
      cancelRequested={false}
      busy={false}
      confirm="Cancel?"
      idleLabel="Cancel"
      requestedLabel="Cancellation requested"
      onCancel={onCancel}
    />,
  );
  expect(screen.queryByRole("button")).toBeNull();
  rerender(
    <CancelJobButton
      active
      cancelRequested={false}
      busy={false}
      confirm="Cancel?"
      idleLabel="Cancel run"
      requestedLabel="Cancellation requested"
      onCancel={onCancel}
    />,
  );
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await userEvent.click(screen.getByRole("button", { name: "Cancel run" }));
  expect(onCancel).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  await userEvent.click(screen.getByRole("button", { name: "Cancel run" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  confirm.mockRestore();
});
