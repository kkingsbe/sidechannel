// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Analysis, { WindowInspector } from "./Analysis";
import { RecordedEventContent } from "./analysis/RecordedEventContent";
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
    run: async (action: () => Promise<unknown>) => {
      try {
        return await action();
      } catch {
        return undefined;
      }
    },
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
    screen.getByLabelText(/Rationale \/ limitations/),
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

it("selects multiple exact citations and preserves the draft when a save fails", async () => {
  localStorage.setItem("sidechannel-reviewer", "Reviewer A");
  const next = vi.fn();
  render(
    <MemoryRouter>
      <WindowInspector detail={detail} job={job} blind onNext={next} />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("checkbox", { name: "Cite event event-a" }),
  );
  await user.click(
    screen.getByRole("checkbox", { name: "Cite event event-b" }),
  );
  await user.type(
    screen.getByLabelText(/Rationale/),
    "Both recorded events support this judgment.",
  );
  mocks.post.mockRejectedValueOnce(new Error("Connection lost"));
  await user.click(screen.getByRole("button", { name: "Save and next" }));
  expect(next).not.toHaveBeenCalled();
  expect(
    (screen.getByLabelText(/Rationale/) as HTMLTextAreaElement).value,
  ).toBe("Both recorded events support this judgment.");
  expect(screen.getByText("Selected citations (2)")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Save and next" }));
  expect(next).toHaveBeenCalledTimes(1);
  expect(mocks.post).toHaveBeenLastCalledWith(
    "/analyses/analysis-a/reviews",
    expect.objectContaining({
      eventIds: ["event-a", "event-b"],
      predictionsVisible: false,
    }),
  );
});
it("renders canonical recorded text first and retains real zero probabilities", () => {
  const withEvents = {
    ...detail,
    events: [
      {
        id: "event-a",
        type: "assistant_message",
        sequence: 9,
        agentId: "Researcher",
        data: { message: "Exact recorded message" },
      },
    ],
    window: {
      ...detail.window,
      results: [{ codeId: code.id, probability: 0 }],
    },
  } as WindowDetail;
  render(
    <MemoryRouter>
      <WindowInspector detail={withEvents} job={job} blind={false} />
    </MemoryRouter>,
  );
  expect(screen.getByText("Exact recorded message")).toBeTruthy();
  expect(screen.getByText("VISIBILITY: 0.0%")).toBeTruthy();
  expect(screen.getByText("An explicit visibility reference")).toBeTruthy();
  const raw = screen
    .getByText("Exact normalized evidence used for this window")
    .closest("details");
  expect(raw?.open).toBe(false);
});
it("opens saved analyses as a collection and exposes a separate creation route", () => {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Analysis />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("link", { name: "New analysis" }).getAttribute("href"),
  ).toBe("/analysis/new");
  expect(screen.queryByRole("button", { name: "Preview analysis" })).toBeNull();
});
it("explains preview prerequisites and distinguishes unscored records while invalidating changed settings", async () => {
  const base = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path: string | null) => {
    if (path?.startsWith("/runs?")) return { items: [], nextCursor: null };
    if (path === "/runs/source-run")
      return {
        id: "source-run",
        status: "completed",
        configHash: "hash",
        config: { label: "Study", model: { provider: "demo", id: "test" } },
      };
    if (path?.startsWith("/codebooks?"))
      return {
        items: [
          { id: "book", name: "Behaviors", currentRevisionId: "revision" },
        ],
        nextCursor: null,
      };
    if (path === "/codebooks/book")
      return {
        codebook: { name: "Behaviors" },
        revision: { id: "revision", revision: 1, codes: [code] },
      };
    return base(path);
  });
  mocks.post.mockResolvedValue({
    previewToken: "preview",
    manifest: { availability: {}, diagnostics: [], scoredCodeCount: 1 },
    windows: [
      {
        id: "preview-window",
        index: 0,
        startStep: 1,
        endStep: 12,
        partial: true,
        empty: false,
        budget: { oversized: true, estimatedTokens: 100000, batches: [] },
      },
    ],
  });
  render(
    <MemoryRouter initialEntries={["/new?run=source-run"]}>
      <Analysis />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  expect(
    screen.getByText("Enter a researcher / creator identity."),
  ).toBeTruthy();
  await user.type(screen.getByLabelText(/Researcher \/ creator/), "Reviewer A");
  await user.click(screen.getByRole("button", { name: "Preview analysis" }));
  expect(await screen.findByText(/No scores will be produced/)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Save unscored analysis record" }),
  ).toBeTruthy();
  const size = screen.getByLabelText("Window size (classification steps)");
  await user.clear(size);
  await user.type(size, "8");
  expect(
    screen.queryByRole("button", { name: "Save unscored analysis record" }),
  ).toBeNull();
});

it("keeps later queue pages and filters after saving and advancing to the next item", async () => {
  localStorage.setItem("sidechannel-reviewer", "Reviewer A");
  const base = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path: string | null) => {
    if (path?.includes("/review-batches/blind-batch")) {
      const later = path.includes("after=page-2");
      return {
        batch: { ...mocks.batch, id: "blind-batch", mode: "blind" },
        selections: {
          items: (later ? ["window-b", "window-c"] : ["window-a"]).map(
            (windowId) => ({ id: windowId, windowId, reasons: ["flagged"] }),
          ),
          nextCursor: later ? null : "page-2",
        },
      };
    }
    if (
      path?.includes("/windows/window-b") ||
      path?.includes("/windows/window-c")
    ) {
      const third = path.includes("window-c");
      return {
        ...detail,
        window: {
          ...detail.window,
          id: third ? "window-c" : "window-b",
          index: third ? 2 : 1,
          startStep: third ? 9 : 5,
          endStep: third ? 20 : 16,
        },
      };
    }
    return base(path);
  });
  render(
    <MemoryRouter
      initialEntries={["/analysis-a?view=review&batch=blind-batch"]}
    >
      <Analysis />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Queue filter"), "uncertain");
  await user.click(screen.getByRole("button", { name: "Next selections" }));
  expect(screen.getByText(/Window 2 .* steps 5.*16/)).toBeTruthy();
  expect(screen.queryByText("flagged")).toBeNull();
  await user.click(
    screen.getAllByRole("button", { name: "Review evidence" })[0],
  );
  await user.type(
    screen.getByLabelText(/Rationale/),
    "A saved judgment on the second queue page.",
  );
  const beforeSave = mocks.request.mock.calls.length;
  expect(
    (screen.getByRole("button", { name: "Save and next" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "Save and next" }));
  expect(mocks.post).toHaveBeenCalled();
  expect(
    await screen.findByRole("heading", { name: /Window 3 .* steps 9.*20/ }),
  ).toBeTruthy();
  const queueRequests = mocks.request.mock.calls
    .slice(beforeSave)
    .map((call) => call[0])
    .filter((path) => path?.includes("review-batches/blind-batch?limit=30"));
  expect(queueRequests.length).toBeGreaterThan(0);
  expect(
    queueRequests.every(
      (path) =>
        path.includes("filter=uncertain") && path.includes("after=page-2"),
    ),
  ).toBe(true);
});

it("puts exact model messages ahead of technical input schemas", () => {
  render(
    <RecordedEventContent
      type="model_requested"
      data={{
        runId: "metadata-id",
        tools: [
          {
            name: "Tool schema noise",
            parameters: { description: "Schema internals" },
          },
        ],
        messages: [
          { role: "user", content: "Exact task wording" },
          { role: "assistant", content: "Exact recorded response" },
        ],
      }}
    />,
  );
  expect(screen.getByText("Exact task wording")).toBeTruthy();
  expect(screen.getByText("Exact recorded response")).toBeTruthy();
  expect(
    screen.queryByText(/Schema internals|Tool schema noise|metadata-id/),
  ).toBeNull();
});
it("does not claim an item is unreviewed before a reviewer is identified", () => {
  const base = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path: string | null) =>
    path?.includes("/review-batches/blind-batch")
      ? {
          batch: { id: "blind-batch", mode: "blind" },
          selections: {
            items: [{ id: "one", windowId: "window-a", reasons: ["flagged"] }],
            nextCursor: null,
          },
        }
      : base(path),
  );
  render(
    <MemoryRouter
      initialEntries={["/analysis-a?view=review&batch=blind-batch"]}
    >
      <Analysis />
    </MemoryRouter>,
  );
  expect(screen.getByText("Enter reviewer identity")).toBeTruthy();
  expect(screen.queryByText("Unreviewed", { selector: "td" })).toBeNull();
  expect(screen.queryByText("flagged")).toBeNull();
});

it("carries the saved analyses cursor into the detail return link", async () => {
  const base = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path: string | null) => {
    if (path?.startsWith("/analyses?"))
      return {
        items: [job],
        nextCursor: path.includes("after=") ? null : "second-page",
      };
    if (path === "/runs/source-run")
      return {
        config: { label: "Contextual study", condition: { id: "reviewed" } },
      };
    return base(path);
  });
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Analysis />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Next" }));
  const open = screen.getByRole("link", { name: "Open results" });
  expect(open.getAttribute("href")).toContain(
    encodeURIComponent("/analysis?cursor=second-page"),
  );
});
it("blocks preview and explains how to recover when the selected codebook is archived", async () => {
  const base = mocks.request.getMockImplementation()!;
  const run = { id: "source-run", status: "completed", configHash: "hash", config: { label: "Study", model: { provider: "demo", id: "test" } } };
  const activeBooks = { items: [{ id: "other", name: "Active book", currentRevisionId: "other-rev", archived: false }], nextCursor: null };
  const cloned = { ...job, manifest: { ...job.manifest, settings: { ...job.manifest.settings, codebookId: "book", codebookRevisionId: "revision", phases: ["action"], evidence: ["assistant"], creator: "Reviewer A" } } };
  const retired = { codebook: { id: "book", name: "Retired book", archived: true, archivedAt: "2026-11-08T00:00:00Z" }, revision: { id: "revision", revision: 1, codes: [code] } };
  mocks.request.mockImplementation((path: string | null) => {
    if (path?.startsWith("/runs?")) return { items: [], nextCursor: null };
    if (path === "/runs/source-run") return run;
    if (path?.startsWith("/codebooks?")) return activeBooks;
    if (path === "/analyses/analysis-a") return cloned;
    if (path === "/codebooks/book") return retired;
    return base(path);
  });
  localStorage.setItem("sidechannel-reviewer", "Reviewer A");
  render(
    <MemoryRouter initialEntries={["/new?run=source-run&clone=analysis-a"]}>
      <Analysis />
    </MemoryRouter>,
  );
  const message = "This codebook is archived. Restore it on the Codebook page to start a new analysis.";
  expect((await screen.findAllByText(new RegExp(message.replace(/\./g, "\\.")))).length).toBeGreaterThan(0);
  expect(screen.getByRole("link", { name: /Codebook page/ }).getAttribute("href")).toBe("/codebook");
  expect((screen.getByRole("button", { name: "Preview analysis" }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.setup().click(screen.getByRole("button", { name: "Preview analysis" }));
  expect(mocks.post).not.toHaveBeenCalled();
});
