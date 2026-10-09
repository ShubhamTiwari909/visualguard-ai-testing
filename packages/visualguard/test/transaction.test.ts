import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { applyEdits } from "../src/fixer/edits.js";

const failure = vi.hoisted(() => ({ path: "" }));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      if (String(args[0]) === failure.path) {
        failure.path = "";
        throw new Error("simulated disk failure");
      }
      return actual.writeFileSync(...args);
    },
  };
});

it("rolls back an already-written file when the next write fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "vg-transaction-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/a.css"), "red");
  writeFileSync(join(dir, "src/b.css"), "blue");
  failure.path = join(dir, "src/b.css");
  expect(() =>
    applyEdits(dir, [
      { file: "src/a.css", search: "red", replace: "green", reason: "a" },
      { file: "src/b.css", search: "blue", replace: "green", reason: "b" },
    ]),
  ).toThrow(/rollback attempted/);
  expect(readFileSync(join(dir, "src/a.css"), "utf8")).toBe("red");
  expect(readFileSync(join(dir, "src/b.css"), "utf8")).toBe("blue");
});
