import { expect, it } from "vitest";
import { evidenceKey } from "./evidence-key";

it("prefers id, then artifact version, then report agent, then position", () => {
  expect(evidenceKey({ id: "message-1" }, 0)).toBe("message-1");
  expect(evidenceKey({ version: 3 }, 1)).toBe("version-3");
  expect(evidenceKey({ agentId: "alpha" }, 2)).toBe("agent-alpha");
  expect(evidenceKey({}, 4)).toBe("record-4");
  expect(evidenceKey(null, 5)).toBe("record-5");
});
