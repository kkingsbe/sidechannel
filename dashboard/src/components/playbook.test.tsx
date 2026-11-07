// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import type { PlaybookCatalogItem } from "@sidechannel/contracts/browser";
import type { ExperimentConfig } from "../lib/types";
import { PlaybookPicker } from "./playbook-picker";
import { ModelControls } from "./model-controls";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const item = (
  over: Partial<PlaybookCatalogItem> = {},
): PlaybookCatalogItem => ({
  playbookId: "smoke",
  playbookVersion: "1",
  displayName: "Smoke",
  scenarioVersion: "",
  roles: [],
  rounds: 2,
  playbookHash: "abcdef0123456789abcdef",
  registeredAt: "2026-11-07T00:00:00.000Z",
  ...over,
});
const base = (): ExperimentConfig => defaultFixtureConfiguration();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function Harness({
  initial,
  onChange,
}: {
  initial: ExperimentConfig;
  onChange: (c: ExperimentConfig) => void;
}) {
  const [config, setConfig] = useState(initial);
  return (
    <PlaybookPicker
      config={config}
      replace={(value) => {
        onChange(value);
        setConfig(value);
      }}
    />
  );
}

it("selects a catalog item, replacing stale embedded playbook content", async () => {
  const config = base();
  const roles = config.roles.map((role) => role.id);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json([item({ scenarioVersion: config.scenario.version, roles })]),
    ),
  );
  config.phase = "pilot";
  config.model = {
    ...config.model,
    settings: {
      temperature: 0.2,
      playbook: { old: true },
      playbookHash: "stale",
      playbookVersion: "0",
    },
  };
  let latest = config;
  render(<Harness initial={config} onChange={(c) => (latest = c)} />);
  await userEvent.selectOptions(
    await screen.findByLabelText("Registered playbook"),
    "smoke:1",
  );
  expect(latest.model.provider).toBe("playbook");
  expect(latest.model.id).toBe("smoke");
  expect(latest.phase).toBe("development");
  expect(latest.model.settings).toEqual({
    temperature: 0.2,
    playbookVersion: "1",
  });
  expect(screen.getByText("abcdef012345")).toBeTruthy();
});

it("disables playbooks for a different scenario", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json([item({ scenarioVersion: "other-scenario" })])),
  );
  render(<Harness initial={base()} onChange={() => undefined} />);
  const option = (await screen.findByRole("option", {
    name: /different scenario/,
  })) as HTMLOptionElement;
  expect(option.disabled).toBe(true);
});

it("uploads a valid playbook, refreshes the catalog and selects it", async () => {
  const config = base();
  const created = item({
    playbookId: "new-one",
    displayName: "New one",
    scenarioVersion: config.scenario.version,
    roles: config.roles.map((r) => r.id),
  });
  let registered = false;
  const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      registered = true;
      return json(created, 201);
    }
    return json(registered ? [created] : []);
  });
  vi.stubGlobal("fetch", fetchMock);
  let latest = config;
  render(<Harness initial={config} onChange={(c) => (latest = c)} />);
  await screen.findByLabelText("Registered playbook");
  const body = {
    format_version: "sidechannel-playbook-v1",
    playbook_id: "new-one",
  };
  await userEvent.upload(
    screen.getByLabelText("Upload playbook JSON"),
    new File([JSON.stringify(body)], "x.json", { type: "application/json" }),
  );
  await waitFor(() => expect(latest.model.id).toBe("new-one"));
  const post = fetchMock.mock.calls.find(
    ([, init]) => init?.method === "POST",
  )!;
  expect(post[0]).toBe("/api/playbooks");
  expect(JSON.parse(post[1]!.body as string)).toEqual(body);
  expect(latest.model.settings.playbookVersion).toBe("1");
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Registered playbook") as HTMLSelectElement).value,
    ).toBe("new-one:1"),
  );
});

it("shows the server error for a rejected upload", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: string, init?: RequestInit) =>
      init?.method === "POST"
        ? json({ error: "roles.alpha.report is required" }, 400)
        : json([]),
    ),
  );
  render(<Harness initial={base()} onChange={() => undefined} />);
  await screen.findByLabelText("Registered playbook");
  await userEvent.upload(
    screen.getByLabelText("Upload playbook JSON"),
    new File(["{}"], "x.json", { type: "application/json" }),
  );
  expect(
    await screen.findByText("roles.alpha.report is required"),
  ).toBeTruthy();
});

it("reports non-JSON files without calling the API", async () => {
  const fetchMock = vi.fn(async () => json([]));
  vi.stubGlobal("fetch", fetchMock);
  render(<Harness initial={base()} onChange={() => undefined} />);
  await screen.findByLabelText("Registered playbook");
  const calls = fetchMock.mock.calls.length;
  await userEvent.upload(
    screen.getByLabelText("Upload playbook JSON"),
    new File(["not json"], "x.json", { type: "application/json" }),
  );
  expect(await screen.findByText(/not valid JSON/)).toBeTruthy();
  expect(fetchMock.mock.calls.length).toBe(calls);
});

it("warns when roles differ or rounds exceed the scheduler", async () => {
  const config = base();
  config.scheduler.rounds = 1;
  config.model = {
    ...config.model,
    provider: "playbook",
    id: "smoke",
    settings: { playbookVersion: "1" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json([
        item({
          scenarioVersion: config.scenario.version,
          roles: ["nobody"],
          rounds: 5,
        }),
      ]),
    ),
  );
  render(<Harness initial={config} onChange={() => undefined} />);
  expect(await screen.findByText(/do not match/)).toBeTruthy();
  expect(screen.getByText(/scripts 5 rounds/)).toBeTruthy();
});

it("offers the playbook driver in ModelControls and switches to development phase", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json([])),
  );
  const config = base();
  config.phase = "pilot";
  config.model = {
    ...config.model,
    provider: "scripted",
    settings: { playbook: {}, playbookHash: "h", playbookVersion: "1" },
  };
  let latest = config;
  function Controls() {
    const [value, setValue] = useState(config);
    return (
      <ModelControls
        config={value}
        replace={(next) => {
          latest = next;
          setValue(next);
        }}
      />
    );
  }
  render(<Controls />);
  expect(
    screen.getByRole("option", { name: /Uploaded playbook/ }),
  ).toBeTruthy();
  await userEvent.selectOptions(
    screen.getByLabelText("Execution driver"),
    "playbook",
  );
  expect(latest.phase).toBe("development");
  expect(latest.model.provider).toBe("playbook");
  expect(latest.model.id).toBe("");
  expect(latest.model.settings.playbook).toBeUndefined();
  expect(await screen.findByLabelText("Registered playbook")).toBeTruthy();
});
