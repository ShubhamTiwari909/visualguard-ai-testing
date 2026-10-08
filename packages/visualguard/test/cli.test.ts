import { describe, expect, it } from "vitest";
import { createProgram } from "../src/cli/program.js";
import { VERSION } from "../src/index.js";

describe("cli", () => {
  it("reports the package version", () => {
    const program = createProgram();
    expect(program.version()).toBe(VERSION);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
