// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { HarnessEvent } from "@sidechannel/contracts/browser";
import { renderWithClients } from "../../test/clients";
import { CanonicalEvent, eventKind } from "./canonical-event";

afterEach(cleanup);
const make = (
  id: string,
  type: string,
  data: unknown,
  extra: Partial<HarnessEvent> = {},
): HarnessEvent => ({
  schemaVersion: 1,
  id,
  runId: "run-1",
  sequence: 217,
  type,
  timestamp: "2026-11-07T00:00:00Z",
  agentId: "Researcher",
  round: 2,
  turn: 3,
  data,
  ...extra,
});

function setup(event: HarnessEvent, open = false) {
  const props = {
    onToggle: vi.fn(),
    onOpenChange: vi.fn(),
    onJudgeOnly: vi.fn(),
  };
  renderWithClients(
    <CanonicalEvent
      eventId={event.id}
      runId="run-1"
      supplied={event}
      selected={false}
      open={open}
      {...props}
    />,
  );
  return props;
}

describe("eventKind", () => {
  it("separates accounting from actions", () => {
    expect(eventKind("context_accounted")).toBe("context");
    expect(eventKind("model_requested")).toBe("context");
    expect(eventKind("model_response")).toBe("action");
    expect(eventKind("tool_requested")).toBe("action");
    expect(eventKind(undefined)).toBe("action");
  });
});

describe("CanonicalEvent collapsed row", () => {
  it("summarizes context_accounted", () => {
    setup(
      make("c1", "context_accounted", {
        measured: 11838,
        limit: 120000,
        capacity: { modelId: "qwen3.8-27b" },
      }),
    );
    expect(screen.getByText("Context accounted")).toBeTruthy();
    expect(
      screen.getByText("11,838 of 120,000 tokens · qwen3.8-27b"),
    ).toBeTruthy();
    expect(screen.getByText("r2 · t3")).toBeTruthy();
  });

  it("summarizes model_requested and model_response", () => {
    setup(
      make("m1", "model_requested", {
        messages: [{ role: "system", content: "x" }, { role: "user", content: "y" }],
      }),
    );
    expect(
      screen.getByText("System prompt and 2 messages · repeated context"),
    ).toBeTruthy();
  });

  it("quotes response text and names tool-only responses", () => {
    setup(make("r1", "model_response", { text: "I will check." }));
    expect(screen.getByText("“I will check.”")).toBeTruthy();
  });

  it("names the tool when a response only proposes calls", () => {
    setup(
      make("r2", "model_response", {
        text: "",
        toolCalls: [{ id: "t", name: "search_web", arguments: {} }],
      }),
    );
    expect(screen.getByText("Proposed search_web")).toBeTruthy();
  });

  it("summarizes tool events with name and arguments", () => {
    setup(
      make("t1", "tool_requested", {
        call: { id: "t", name: "search_web", arguments: { q: "cats" } },
      }),
    );
    expect(screen.getByText('search_web · {"q":"cats"}')).toBeTruthy();
  });

  it("toggles open through the row button and cites through the checkbox", async () => {
    const user = userEvent.setup();
    const props = setup(make("e1", "model_response", { text: "Hello" }));
    const button = screen.getByRole("button", { expanded: false });
    await user.click(button);
    expect(props.onOpenChange).toHaveBeenCalledWith(true);
    await user.click(
      screen.getByRole("checkbox", { name: "Cite event 217, Model response" }),
    );
    expect(props.onToggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Judge this event only")).toBeNull();
  });
});

describe("CanonicalEvent expanded body", () => {
  it("renders the budget bar and detail well and calls onJudgeOnly", async () => {
    const user = userEvent.setup();
    const props = setup(
      make(
        "c2",
        "context_accounted",
        {
          estimated: true,
          unit: "tokens",
          method: "utf8-byte-upper-bound",
          scope: "messages-and-tool-definitions",
          measured: 11838,
          limit: 120000,
          reservedTokens: 2048,
          maxOutputTokens: 16384,
          capacity: {
            modelId: "qwen3.8-27b",
            tokens: 262144,
            sourceUrl: "https://example.com/model",
            verifiedAt: "2026-11-07T01:00:00Z",
          },
        },
        { id: "0123456789abcdef" },
      ),
      true,
    );
    expect(screen.getByText("tokens in context")).toBeTruthy();
    expect(screen.getByText("limit")).toBeTruthy();
    expect(screen.getByText(/9.9% of the limit · estimated with/)).toBeTruthy();
    expect(screen.getByText("Reserved")).toBeTruthy();
    expect(screen.getByText("2,048 tokens")).toBeTruthy();
    expect(screen.queryByText("Exceeds limit")).toBeNull();
    const link = screen.getByRole("link", { name: "capacity source" });
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByText("01234567…")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy event ID 0123456789abcdef" }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Judge this event only" }),
    );
    expect(props.onJudgeOnly).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole("link", { name: /Open in run timeline/ })
        .getAttribute("href"),
    ).toBe("/runs/run-1?view=timeline&evidence=0123456789abcdef");
  });

  it("clamps long model input until the prompt is expanded", async () => {
    const user = userEvent.setup();
    const long = "Follow every rule carefully. ".repeat(60);
    setup(
      make("m2", "model_requested", {
        messages: [{ role: "system", content: long }],
      }),
      true,
    );
    expect(
      screen.getByText(/Model input as recorded\. Repeated context, not a new action by Researcher\./),
    ).toBeTruthy();
    const body = screen.getByText(long.trim());
    expect(body.className).toContain("ev-clamp");
    await user.click(screen.getByRole("button", { name: "Show the full prompt" }));
    expect(body.className).not.toContain("ev-clamp");
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
  });

  it("renders a response as a quote with its proposed call", () => {
    setup(
      make("r3", "model_response", {
        text: "Searching now.",
        toolCalls: [{ id: "t", name: "search_web", arguments: { q: "cats" } }],
      }),
      true,
    );
    expect(screen.getByText("Searching now.").tagName).toBe("BLOCKQUOTE");
    expect(screen.getByText("Proposed tool call")).toBeTruthy();
    expect(document.querySelector("pre")?.textContent).toContain("search_web(");
  });

  it("labels tool dispositions", () => {
    setup(
      make("t2", "tool_result", { call: { name: "search_web" }, disposition: "denied", reason: "Over allowance" }),
      true,
    );
    expect(screen.getByText("Denied")).toBeTruthy();
    expect(screen.getByText("Over allowance")).toBeTruthy();
  });
});
