// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createClients } from "./context";
import type { Requester } from "../transport";
import { playbookItem, uploadBody } from "../../test/playbook-fixtures";

function stub(...responses: unknown[]) {
  const calls: { path: string; options?: RequestInit; body?: unknown }[] = [];
  const request: Requester = async <T,>(path: string, options?: RequestInit): Promise<T> => {
    calls.push({ path, options, body: options?.body ? JSON.parse(String(options.body)) : undefined });
    return structuredClone(responses.shift()) as T;
  };
  return { calls, request };
}

describe("playbooks client", () => {
  it("lists, uploads and fetches immutable playbook rows through canonical paths", async () => {
    const item = playbookItem();
    const server = stub([item], item, { item, playbook: uploadBody("smoke") });
    const { playbooks } = createClients({ request: server.request });

    await expect(playbooks.list()).resolves.toEqual([item]);
    expect(server.calls[0]!.path).toBe("/playbooks");

    await expect(playbooks.upload(uploadBody("smoke"))).resolves.toEqual(item);
    expect(server.calls[1]!.path).toBe("/playbooks");
    expect(server.calls[1]!.options?.method).toBe("POST");
    expect(server.calls[1]!.body).toEqual(uploadBody("smoke"));

    await expect(playbooks.get("demo-play", "1")).resolves.toMatchObject({ item });
    expect(server.calls[2]!.path).toBe("/playbooks/demo-play?version=1");
  });

  it("surfaces the server error for a rejected upload", async () => {
    const request: Requester = async () => { throw new Error("roles.alpha.report is required"); };
    const { playbooks } = createClients({ request });
    await expect(playbooks.upload(uploadBody("bad"))).rejects.toThrow("roles.alpha.report is required");
  });

  it("exposes path builders without performing requests", () => {
    const { playbooks } = createClients({ request: stub().request });
    expect(playbooks.paths.list()).toBe("/playbooks");
    expect(playbooks.paths.upload()).toBe("/playbooks");
    expect(playbooks.paths.get("new one", "2.0")).toBe("/playbooks/new%20one?version=2.0");
  });
});
