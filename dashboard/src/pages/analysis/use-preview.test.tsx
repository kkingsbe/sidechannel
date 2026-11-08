// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { ApiClientProvider } from "../../lib/clients/context";
import { fakeClients } from "../../test/clients";
import { usePreview } from "./use-preview";
import type { AnalysisSettings } from "../../lib/analysis-types";

afterEach(cleanup);

const settings = (stride: number): AnalysisSettings => ({
  codebookId: "book",
  codebookRevisionId: "revision",
  model: "jev-1.14.0",
  windowSize: 12,
  stride,
  phases: ["action", "report"],
  evidence: ["assistant"],
  headroom: 2000,
  timeoutMs: 60000,
  maxAttempts: 2,
  creator: "Reviewer A",
});
const previewResult = {
  previewToken: "token",
  manifest: {
    windowCount: 1,
    diagnostics: [],
    availability: {},
    selectedStepCount: 1,
    partialWindowCount: 0,
    scoredCodeCount: 1,
  },
  windows: [],
};

function Probe({
  onPrepare,
}: {
  onPrepare?: (prepare: () => Promise<void>, edit: () => void) => void;
}) {
  const [current, setCurrent] = useState(() => settings(4));
  const draft = usePreview({ runId: "source-run", settings: current });
  return (
    <>
      <button
        onClick={() => {
          if (onPrepare) onPrepare(draft.prepare, () => setCurrent(settings(8)));
          else void draft.prepare();
        }}
      >
        prepare
      </button>
      <p>{draft.preview ? "prepared" : "clear"}</p>
    </>
  );
}

it("discards a preview whose settings were edited while the request was in flight", async () => {
  let release: (value: unknown) => void = () => {};
  const pending = new Promise((done) => (release = done));
  let prepare: (() => Promise<void>) | undefined;
  let edit: (() => void) | undefined;
  render(
    <MemoryRouter>
      <ApiClientProvider
        clients={fakeClients({ analyses: { preview: () => pending as never } })}
      >
        <Probe
          onPrepare={(run, change) => {
            prepare = run;
            edit = change;
          }}
        />
      </ApiClientProvider>
    </MemoryRouter>,
  );
  screen.getByText("prepare").click();
  await waitFor(() => expect(prepare).toBeTypeOf("function"));
  edit!();
  release(previewResult);
  await waitFor(() => expect(screen.getByText("clear")).toBeTruthy());
});

it("keeps a preview whose settings are unchanged", async () => {
  render(
    <MemoryRouter>
      <ApiClientProvider
        clients={fakeClients({
          analyses: { preview: async () => previewResult as never },
        })}
      >
        <Probe />
      </ApiClientProvider>
    </MemoryRouter>,
  );
  screen.getByText("prepare").click();
  await waitFor(() => expect(screen.getByText("prepared")).toBeTruthy());
});
