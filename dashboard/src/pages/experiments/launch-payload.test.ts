import { expect, it } from "vitest";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import { buildLaunchPayload } from "./launch-payload";
import type { Draft } from "../../lib/types";

const config = { ...defaultFixtureConfiguration(), label: "Pilot matched pair" };
const draft: Draft = { id: "draft-1", revision: 4, config };

it("sends the frozen matched-pair body for a saved, unedited draft", () => {
  expect(
    buildLaunchPayload({ config, launchKey: "key-1", dirty: false, draft }),
  ).toEqual({
    config,
    idempotencyKey: "key-1",
    pairingSeed: config.scheduler.seed,
    sourceDraftId: "draft-1",
    sourceDraftRevision: 4,
  });
});

it("omits draft provenance when the form is dirty, unsaved or draftless", () => {
  const dirty = buildLaunchPayload({
    config,
    launchKey: "key-2",
    dirty: true,
    draft,
  });
  expect(dirty).toEqual({
    config,
    idempotencyKey: "key-2",
    pairingSeed: config.scheduler.seed,
  });
  expect("sourceDraftId" in dirty).toBe(false);
  expect(
    buildLaunchPayload({ config, launchKey: "key-3", dirty: false, draft: undefined }),
  ).toEqual({
    config,
    idempotencyKey: "key-3",
    pairingSeed: config.scheduler.seed,
  });
});
