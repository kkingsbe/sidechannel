// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Analysis, { WindowInspector } from "./Analysis";
import type { AnalysisJob, WindowDetail } from "../lib/analysis-types";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  post: vi.fn(),
  batch: { id: "blind-batch", mode: "blind" },
}));
vi.mock("../lib/api", () => ({
  useApi: (path: string | null) => ({
    data: mocks.request(path),
    loading: false,
    error: undefined,
    refresh: vi.fn(),
  }),
  useMutation: () => ({
    busy: false,
    error: undefined,
    message: "",
    run: async (action: () => Promise<unknown>) => action(),
  }),
  post: (...args: unknown[]) => mocks.post(...args),
  api: vi.fn(),
  arrayOf: (value: any) => value?.items ?? [],
}));
const code = {
  id: "visibility",
  code: "VISIBILITY",
  name: "Visibility",
  definition: "An explicit visibility reference",
  enabled: true,
  archived: false,
  color: "#2563eb",
};
const job = {
  id: "analysis-a",
  runId: "source-run",
  status: "completed",
  createdAt: "2026-11-07T12:00:00Z",
  cancelRequested: false,
  counters: { prepared: 1, finished: 1, failed: 0 },
  manifest: {
    sourceStatus: "completed",
    sequenceBoundary: 35,
    codebook: { id: "revision-a", revision: 1, codes: [code] },
    settings: { model: "jev-1.14.0", windowSize: 12, stride: 4 },
    configHash: "config",
    evidenceHash: "evidence",
  },
} as AnalysisJob;
const detail = {
  window: {
    id: "window-a",
    index: 0,
    startStep: 1,
    endStep: 12,
    status: "completed",
    eventIds: ["event-a", "event-b"],
    stepIds: ["step-a"],
    state: '{"recorded":"source evidence"}',
    results: [{ codeId: code.id, probability: 0.95 }],
  },
  sourceEventIds: ["event-a", "event-b"],
} as WindowDetail;
beforeEach(() => {
  localStorage.clear();
  mocks.post.mockResolvedValue({ id: "saved" });
  mocks.request.mockImplementation((path: string | null) => {
    if (!path) return undefined;
    if (path === "/analyses/analysis-a") return job;
    if (path.includes("/windows/window-a")) return detail;
    if (path.includes("/review-batches/"))
      return {
        batch: mocks.batch,
        selections: { items: [], nextCursor: null },
      };
    return { items: [], nextCursor: null };
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("derives initial blinding from persisted batch mode even when the shared link omits blind=true", async () => {
  render(
    <MemoryRouter
      initialEntries={[
        "/analysis-a?view=review&batch=blind-batch&window=window-a",
      ]}
    >
      <Analysis />
    </MemoryRouter>,
  );
  await screen.findByText(/Blind initial review/);
  expect(screen.queryByText("VISIBILITY: 95.0%")).toBeNull();
});
it("fails closed when a path change temporarily retains metadata for a different assisted batch", async () => {
  mocks.batch = { id: "old-assisted-batch", mode: "assisted" };
  render(
    <MemoryRouter
      initialEntries={[
        "/analysis-a?view=review&batch=new-blind-batch&window=window-a",
      ]}
    >
      <Analysis />
    </MemoryRouter>,
  );
  await screen.findByText(/Blind initial review/);
  expect(screen.queryByText("VISIBILITY: 95.0%")).toBeNull();
  mocks.batch = { id: "blind-batch", mode: "blind" };
});
it("revises the exact event subject rather than borrowing another event review revision", async () => {
  localStorage.setItem("sidechannel-reviewer", "Reviewer A");
  mocks.request.mockImplementation((path: string | null) => {
    if (!path) return undefined;
    if (path.includes("subjectId=event-b"))
      return {
        items: [
          {
            id: "event-b-review",
            reviewer: "Reviewer A",
            windowId: "window-a",
            subjectId: "event-b",
            scope: "event",
            codeId: code.id,
            revision: 3,
          },
        ],
        nextCursor: null,
      };
    if (path.includes("latest=true"))
      return {
        items: [
          {
            id: "event-a-review",
            reviewer: "Reviewer A",
            windowId: "window-a",
            subjectId: "event-a",
            scope: "event",
            codeId: code.id,
            revision: 7,
          },
        ],
        nextCursor: null,
      };
    return { items: [], nextCursor: null };
  });
  render(
    <MemoryRouter>
      <WindowInspector detail={detail} job={job} blind={false} />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.click(
    screen.getAllByRole("button", { name: "Annotate this event" })[1],
  );
  await user.type(
    screen.getByLabelText("Rationale / limitations"),
    "This particular source event is uncertain.",
  );
  await user.click(
    screen.getByRole("button", { name: "Append revised judgment" }),
  );
  expect(mocks.post).toHaveBeenCalledWith(
    "/analyses/analysis-a/reviews",
    expect.objectContaining({
      scope: "event",
      eventIds: ["event-b"],
      supersedesId: "event-b-review",
    }),
  );
});
