// @vitest-environment node
import { expect, it } from "vitest";
import { createClients } from "./context";
import type { Requester } from "../transport";
import type { Codebook } from "../analysis-types";

const codebook: Codebook = {
  id: "book-a",
  name: "Study codebook",
  currentRevisionId: "revision-a",
  createdAt: "2026-11-07T12:00:00Z",
};

function stub(...responses: unknown[]) {
  const calls: { path: string; method?: string; body?: unknown }[] = [];
  const request: Requester = async <T,>(path: string, options?: RequestInit): Promise<T> => {
    calls.push({
      path,
      method: options?.method,
      body: options?.body ? JSON.parse(String(options.body)) : undefined,
    });
    return structuredClone(responses.shift()) as T;
  };
  return { calls, request };
}

it("lists with the archived filter and archives/restores through the canonical paths", async () => {
  const server = stub(
    { items: [codebook], nextCursor: null },
    { codebook: { ...codebook, archived: true } },
    { codebook: { ...codebook, archived: false } },
  );
  const { codebooks } = createClients({ request: server.request, adapt: false });

  await codebooks.list({ limit: 30, archived: "include" });
  expect(server.calls[0]!.path).toMatch(/^\/codebooks\?.*archived=include/);
  expect(server.calls[0]!.path).toMatch(/limit=30/);

  await codebooks.archive(codebook.id, { expectedRevisionId: "revision-a", author: "Researcher" });
  expect(server.calls[1]!.path).toBe("/codebooks/" + codebook.id + "/archive");
  expect(server.calls[1]!.method).toBe("POST");
  expect(server.calls[1]!.body).toEqual({ expectedRevisionId: "revision-a", author: "Researcher" });

  await codebooks.restore(codebook.id, { expectedRevisionId: "revision-a", author: "Researcher" });
  expect(server.calls[2]!.path).toBe("/codebooks/" + codebook.id + "/restore");
});

it("reads the proposed v2 seed and applies it with the revision guard", async () => {
  const server = stub({ definitions: [] }, { codebook, revision: { id: "revision-b" }, warnings: [] });
  const { codebooks } = createClients({ request: server.request, adapt: false });

  await codebooks.seedV2();
  expect(server.calls[0]!.path).toBe("/codebooks/seed-v2");

  await codebooks.applySeedV2(codebook.id, { expectedRevisionId: "revision-a", author: "Researcher" });
  expect(server.calls[1]!.path).toBe("/codebooks/" + codebook.id + "/seed-v2");
  expect(server.calls[1]!.method).toBe("POST");
  expect(server.calls[1]!.body).toEqual({ expectedRevisionId: "revision-a", creator: "Researcher" });
});
