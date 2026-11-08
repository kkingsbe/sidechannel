// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeClients, renderWithClients } from "../test/clients";
import type { BehaviorCode } from "../lib/analysis-types";
import CodebookPage from "./Codebook";

const definition: BehaviorCode = { id: "visibility", code: "VISIBILITY", name: "Visibility", definition: "Refers to oversight", inclusionCriteria: [], exclusionCriteria: [], examples: [], counterexamples: [], qualifyingEvidenceTypes: [], enabled: true, archived: false, color: "#123456" };
const book = { id: "book", name: "Study", currentRevisionId: "revision-1", revision: 1, createdAt: "2026-11-07T12:00:00Z" };
const revision = { id: "revision-1", codebookId: "book", revision: 1, createdAt: "2026-11-07T12:00:00Z", author: "Researcher", codes: [definition] };
const seed: BehaviorCode[] = [
  { ...definition, framingExclusions: ["included in routine operator review"], decisionProcedure: "1. Check the actor" },
  { ...definition, id: "bare-step", code: "BARE STEP", kind: "audit", question: { type: "noul" } },
];

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function setup(extra: Record<string, unknown> = {}) {
  const calls: { revised?: any; applied?: any } = {};
  const clients = fakeClients({
    codebooks: {
      list: async () => ({ items: [book], nextCursor: null }),
      get: async () => ({ codebook: book, revision }),
      revisions: async () => ({ items: [], nextCursor: null }),
      revise: async (_id: string, input: any) => { calls.revised = input; return { codebook: book, revision: { ...revision, codes: input.codes }, warnings: [{ codeId: "visibility", field: "definition", message: "Server says: negated" }] }; },
      seedV2: async () => ({ definitions: seed }),
      applySeedV2: async (_id: string, input: any) => { calls.applied = input; return { codebook: book, revision: { ...revision, revision: 2, codes: seed }, warnings: [] }; },
      ...extra,
    } as any,
  });
  renderWithClients(<CodebookPage />, { clients });
  return { calls, user: userEvent.setup() };
}

it("edits kind, scope and a score question, and saves them with the revision", async () => {
  const { calls, user } = setup();
  await screen.findByLabelText("Definition");
  await user.selectOptions(screen.getByLabelText("Kind"), "distractor");
  await user.selectOptions(screen.getByLabelText("Scope"), "actor");
  await user.selectOptions(screen.getByLabelText("Question type"), "score");
  const levels = screen.getAllByLabelText(/^Level \d$/);
  await user.type(levels[0]!, "mild");
  await user.type(levels[1]!, "severe");
  await user.type(screen.getByLabelText("Revision author"), "Reviewer");
  await user.click(screen.getByRole("button", { name: "Save revision" }));
  await screen.findByText(/New immutable codebook revision saved/);
  expect(calls.revised.codes[0]).toMatchObject({ kind: "distractor", scope: "actor", question: { type: "score", levels: ["mild", "severe"] } });
});

it("blocks audit codes from actor scope and keeps the condition out of the background options", async () => {
  const { user } = setup();
  await screen.findByLabelText("Definition");
  await user.selectOptions(screen.getByLabelText("Kind"), "audit");
  expect((screen.getByRole("option", { name: "actor" }) as HTMLOptionElement).disabled).toBe(true);
  const background = screen.getByRole("group", { name: "Background shown with this question" });
  expect(within(background).getAllByRole("checkbox").map((box) => (box as HTMLInputElement).labels?.[0]?.textContent)).toEqual(["Task description", "Policy"]);
  expect(within(background).getByText(/never classifier input/)).toBeTruthy();
});

it("edits the decision procedure as an ordered list and framing exclusions as chips", async () => {
  const { calls, user } = setup();
  await screen.findByLabelText("Definition");
  await user.click(screen.getByRole("button", { name: /Add decision procedure step item/i }));
  await user.type(screen.getByLabelText("Decision procedure step item 1"), "Check the actor");
  await user.type(screen.getByLabelText("New framing exclusion"), "routine review{Enter}");
  expect(screen.getByRole("button", { name: "Remove framing exclusion routine review" })).toBeTruthy();
  await user.type(screen.getByLabelText("Revision author"), "Reviewer");
  await user.click(screen.getByRole("button", { name: "Save revision" }));
  await screen.findByText(/New immutable codebook revision saved/);
  expect(calls.revised.codes[0]).toMatchObject({ decisionProcedure: "1. Check the actor", framingExclusions: ["routine review"] });
});

it("shows negated phrasing warnings inline, live and from the save", async () => {
  const { user } = setup();
  const field = await screen.findByLabelText("Definition");
  await user.clear(field);
  await user.type(field, "Does not refer to anything");
  expect(await screen.findByText(/opens with negated phrasing/)).toBeTruthy();
  await user.type(screen.getByLabelText("Revision author"), "Reviewer");
  await user.click(screen.getByRole("button", { name: "Save revision" }));
  expect(await screen.findByText("Server says: negated")).toBeTruthy();
});

it("previews the v2 seed diff and applies it with the revision guard", async () => {
  const { calls, user } = setup();
  await screen.findByLabelText("Definition");
  await user.type(screen.getByLabelText("Revision author"), "Reviewer");
  await user.click(screen.getByRole("button", { name: "Apply v2 seed revision" }));
  const added = await screen.findByRole("list", { name: "Added codes" });
  expect(within(added).getByText("BARE STEP")).toBeTruthy();
  expect(within(screen.getByRole("list", { name: "Changed codes" })).getByText(/decisionProcedure, framingExclusions/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Apply seed as revision 2" }));
  await screen.findByText(/v2 seed revision saved/);
  expect(calls.applied).toEqual({ expectedRevisionId: "revision-1", author: "Reviewer" });
});

it("mounts the validation status slot for the selected code", async () => {
  setup();
  await screen.findByLabelText("Definition");
  expect(document.querySelector('[data-slot="validation-status"][data-code-id="visibility"]')).not.toBeNull();
});
