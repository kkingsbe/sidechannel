import type { PlaybookCatalogItem } from "@sidechannel/contracts/browser";

/** Canonical catalog row builder for picker/integration tests. */
export function playbookItem(overrides: Partial<PlaybookCatalogItem> = {}): PlaybookCatalogItem {
  return {
    playbookId: "smoke",
    playbookVersion: "1",
    displayName: "Smoke",
    scenarioVersion: "",
    roles: [],
    rounds: 2,
    playbookHash: "abcdef0123456789abcdef",
    registeredAt: "2026-11-07T00:00:00.000Z",
    ...overrides,
  };
}

/** A minimal valid uploaded playbook body (the server schema owns the real validation). */
export const uploadBody = (playbookId = "new-one") => ({ format_version: "sidechannel-playbook-v1", playbook_id: playbookId });
