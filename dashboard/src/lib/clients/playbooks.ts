import type { PlaybookCatalogItem } from "@sidechannel/contracts/browser";
import type { Requester } from "../transport";
import { withQuery } from "../transport";

/** Canonical playbook endpoints. Immutable registration; the server owns validation and hashing. */
export const playbookPaths = {
  list: () => "/playbooks",
  upload: () => "/playbooks",
  get: (playbookId: string, playbookVersion: string) => withQuery("/playbooks/" + encodeURIComponent(playbookId), { version: playbookVersion }),
};

export interface PlaybookDetail {
  item: PlaybookCatalogItem;
  playbook: unknown;
}

export interface PlaybooksClient {
  paths: typeof playbookPaths;
  list(): Promise<PlaybookCatalogItem[]>;
  upload(playbook: unknown): Promise<PlaybookCatalogItem>;
  get(playbookId: string, playbookVersion: string): Promise<PlaybookDetail>;
}

export function createPlaybooksClient(request: Requester): PlaybooksClient {
  return {
    paths: playbookPaths,
    list: () => request<PlaybookCatalogItem[]>(playbookPaths.list()),
    upload: (playbook) => request<PlaybookCatalogItem>(playbookPaths.upload(), { method: "POST", body: JSON.stringify(playbook) }),
    get: (playbookId, playbookVersion) => request<PlaybookDetail>(playbookPaths.get(playbookId, playbookVersion)),
  };
}
