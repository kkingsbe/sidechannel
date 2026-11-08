// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import Analysis from "./Analysis";
import Oversight from "./Oversight";
import Runs from "./Runs";
import { fakeClients, renderWithClients } from "../test/clients";

afterEach(cleanup);
const config = defaultFixtureConfiguration();
const run = {
  id: "run-1", config, status: "completed", configHash: "h", launchKey: "k",
  createdAt: "2026-11-07T12:00:00Z", updatedAt: "2026-11-07T12:00:00Z",
  round: 1, turn: 1, board: [], artifacts: [], reports: [], operations: {}, scenarioState: null, usage: {},
};
const job = {
  id: "analysis-a", runId: "run-1", status: "completed", createdAt: "2026-11-07T12:00:00Z", cancelRequested: false,
  counters: { prepared: 1, submitted: 1, finished: 1, failed: 0, skipped: 0, answers: 1 },
  manifest: {
    schemaVersion: 1, runId: "run-1", configHash: "c", sourceStatus: "completed", sequenceBoundary: 1,
    evidenceHash: "e", normalizerVersion: "n", serializationVersion: "s", questionTemplateVersion: "q",
    adapterVersion: "a", sdkVersion: "v", settingsHash: "sh",
    staticContext: { version: "v" }, staticContextHash: "sch", diagnostics: [],
    availability: {}, windowCount: 1, scoredCodeCount: 0,
    codebook: { id: "revision-a", revision: 1, createdAt: "2026-11-07T12:00:00Z", codebookId: "book", codes: [], author: "Researcher" },
    settings: { codebookId: "book", codebookRevisionId: "revision-a", model: "jev", windowSize: 12, stride: 4, phases: ["action"], evidence: [], headroom: 1, timeoutMs: 1, maxAttempts: 1, creator: "Researcher" },
    updatedAt: "2026-11-07T12:00:00Z",
  },
} as never;

it("analysis renders not-found for an unknown view", async () => {
  renderWithClients(<Analysis />, {
    route: "/analysis-a?view=typo",
    clients: fakeClients({
      analyses: { job: async () => job, windows: async () => ({ items: [], nextCursor: null }), list: async () => ({ items: [], nextCursor: null }) },
      runs: { get: async () => run as never },
    }),
  });
  expect(await screen.findByText("This view does not exist")).toBeTruthy();
});

it("runs renders not-found for an unknown evidence view", async () => {
  renderWithClients(<Runs />, {
    route: "/run-1?view=typo",
    clients: fakeClients({ runs: { get: async () => run as never, progress: async () => ({ id: run.id, status: "completed", round: 1, turn: 1, updatedAt: run.updatedAt, observedAt: run.updatedAt, executionPhase: "action", rounds: 1 }) as never } }),
  });
  expect(await screen.findByText("This view does not exist")).toBeTruthy();
});

it("oversight renders not-found for an unknown view", async () => {
  renderWithClients(<Oversight />, {
    route: "/?view=typo",
    clients: fakeClients({
      monitor: { definition: async () => ({ id: "d", schemaVersion: 1, revision: 1, createdAt: run.createdAt, questions: "", outcomes: [] }) as never, history: async () => ({ items: [], nextCursor: null }), evaluations: async () => ({ items: [], nextCursor: null }) },
      runs: { list: async () => ({ items: [], total: 0, nextOffset: null }) },
    }),
  });
  expect(await screen.findByText("This view does not exist")).toBeTruthy();
});
