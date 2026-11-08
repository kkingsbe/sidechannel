import { expect, it } from "vitest";
import { fakeServer } from "../../test/clients";
import { createValidationClient, validationPaths } from "./validation";

it("builds canonical validation and disagreement paths with encoded identifiers", () => {
  expect(validationPaths.validation("book 1", "model/x")).toBe("/jev/codebooks/book%201/validation?model=model%2Fx");
  expect(validationPaths.disagreements("book", "m", "supply", 20)).toBe("/jev/codebooks/book/disagreements?model=m&codeId=supply&limit=20");
  expect(validationPaths.disagreements("book", "m", "supply")).toBe("/jev/codebooks/book/disagreements?model=m&codeId=supply");
});

it("requests the validation report and the disagreement list", async () => {
  const server = fakeServer((path) => path.includes("/validation") ? { items: [{ codeId: "supply" }] } : { codeId: "supply", modelHighHumanAbsent: [], modelLowHumanPresent: [] });
  const client = createValidationClient(server.request);
  expect((await client.validation("book", "m")).items[0]!.codeId).toBe("supply");
  expect((await client.disagreements("book", "m", "supply")).codeId).toBe("supply");
  expect(server.calls.map((call) => call.path)).toEqual(["/jev/codebooks/book/validation?model=m", "/jev/codebooks/book/disagreements?model=m&codeId=supply"]);
});
