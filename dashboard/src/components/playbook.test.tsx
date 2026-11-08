// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import type { ExperimentConfig } from "../lib/types";
import { PlaybookPicker } from "./playbook-picker";
import { ModelControls } from "./model-controls";
import { fakeClients, renderWithClients } from "../test/clients";
import { playbookItem, uploadBody } from "../test/playbook-fixtures";

afterEach(cleanup);

const base = (): ExperimentConfig => defaultFixtureConfiguration();

function Harness({
  initial,
  onChange,
  clients,
}: {
  initial: ExperimentConfig;
  onChange: (c: ExperimentConfig) => void;
  clients: ReturnType<typeof fakeClients>;
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
  const clients = fakeClients({ playbooks: { list: async () => [playbookItem({ scenarioVersion: config.scenario.version, roles })] } });
  config.phase = "pilot";
  config.model = {
    ...config.model,
    settings: { temperature: 0.2, playbook: { old: true }, playbookHash: "stale", playbookVersion: "0" },
  };
  let latest = config;
  renderWithClients(
    <Harness initial={config} onChange={(c) => (latest = c)} clients={clients} />,
    { clients },
  );
  await userEvent.selectOptions(await screen.findByLabelText("Registered playbook"), "smoke:1");
  expect(latest.model.provider).toBe("playbook");
  expect(latest.model.id).toBe("smoke");
  expect(latest.phase).toBe("development");
  expect(latest.model.settings).toEqual({ temperature: 0.2, playbookVersion: "1" });
  expect(screen.getByText("abcdef012345")).toBeTruthy();
});

it("disables playbooks for a different scenario", async () => {
  const clients = fakeClients({ playbooks: { list: async () => [playbookItem({ scenarioVersion: "other-scenario" })] } });
  renderWithClients(<Harness initial={base()} onChange={() => undefined} clients={clients} />, { clients });
  const option = (await screen.findByRole("option", { name: /different scenario/ })) as HTMLOptionElement;
  expect(option.disabled).toBe(true);
});

it("uploads a valid playbook, refreshes the catalog and selects it", async () => {
  const config = base();
  const created = playbookItem({
    playbookId: "new-one",
    displayName: "New one",
    scenarioVersion: config.scenario.version,
    roles: config.roles.map((r) => r.id),
  });
  const list = vi.fn(async () => [created]);
  const upload = vi.fn(async () => created);
  const clients = fakeClients({ playbooks: { list, upload } });
  let latest = config;
  renderWithClients(<Harness initial={config} onChange={(c) => (latest = c)} clients={clients} />, { clients });
  await screen.findByLabelText("Registered playbook");
  const body = uploadBody("new-one");
  await userEvent.upload(
    screen.getByLabelText("Upload playbook JSON"),
    new File([JSON.stringify(body)], "x.json", { type: "application/json" }),
  );
  await waitFor(() => expect(latest.model.id).toBe("new-one"));
  expect(upload).toHaveBeenCalledWith(body);
  expect(latest.model.settings.playbookVersion).toBe("1");
  expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);
  await waitFor(() =>
    expect((screen.getByLabelText("Registered playbook") as HTMLSelectElement).value).toBe("new-one:1"),
  );
});

it("shows the server error for a rejected upload", async () => {
  const clients = fakeClients({
    playbooks: {
      list: async () => [],
      upload: async () => {
        throw new Error("roles.alpha.report is required");
      },
    },
  });
  renderWithClients(<Harness initial={base()} onChange={() => undefined} clients={clients} />, { clients });
  await screen.findByLabelText("Registered playbook");
  await userEvent.upload(
    screen.getByLabelText("Upload playbook JSON"),
    new File(["{}"], "x.json", { type: "application/json" }),
  );
  expect(await screen.findByText("roles.alpha.report is required")).toBeTruthy();
});

it("reports non-JSON files without calling the client", async () => {
  const upload = vi.fn(async () => playbookItem());
  const clients = fakeClients({ playbooks: { list: async () => [], upload } });
  renderWithClients(<Harness initial={base()} onChange={() => undefined} clients={clients} />, { clients });
  await screen.findByLabelText("Registered playbook");
  await userEvent.upload(
    screen.getByLabelText("Upload playbook JSON"),
    new File(["not json"], "x.json", { type: "application/json" }),
  );
  expect(await screen.findByText(/not valid JSON/)).toBeTruthy();
  expect(upload).not.toHaveBeenCalled();
});

it("warns when roles differ or rounds exceed the scheduler", async () => {
  const config = base();
  config.scheduler.rounds = 1;
  config.model = { ...config.model, provider: "playbook", id: "smoke", settings: { playbookVersion: "1" } };
  const clients = fakeClients({
    playbooks: { list: async () => [playbookItem({ scenarioVersion: config.scenario.version, roles: ["nobody"], rounds: 5 })] },
  });
  renderWithClients(<Harness initial={config} onChange={() => undefined} clients={clients} />, { clients });
  expect(await screen.findByText(/do not match/)).toBeTruthy();
  expect(screen.getByText(/scripts 5 rounds/)).toBeTruthy();
});

it("offers the playbook driver in ModelControls and switches to development phase", async () => {
  const clients = fakeClients({ playbooks: { list: async () => [] } });
  const config = base();
  config.phase = "pilot";
  config.model = { ...config.model, provider: "scripted", settings: { playbook: {}, playbookHash: "h", playbookVersion: "1" } };
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
  renderWithClients(<Controls />, { clients });
  expect(screen.getByRole("option", { name: /Uploaded playbook/ })).toBeTruthy();
  await userEvent.selectOptions(screen.getByLabelText("Execution driver"), "playbook");
  expect(latest.phase).toBe("development");
  expect(latest.model.provider).toBe("playbook");
  expect(latest.model.id).toBe("");
  expect(latest.model.settings.playbook).toBeUndefined();
  expect(await screen.findByLabelText("Registered playbook")).toBeTruthy();
});
