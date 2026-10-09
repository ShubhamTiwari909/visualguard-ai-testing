/**
 * @file Tests CLI version and subcommand option routing.
 *
 * Tests are executable examples: describe groups a scenario, it/test names one expectation, and
 * expect checks the result. Helpers below create controlled data or temporary resources so
 * assertions do not depend on a developer's environment.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { describe, expect, it } from "vitest";
import { createProgram } from "../src/cli/program.js";
import { VERSION } from "../src/index.js";

describe("cli", () => {
  it("reports the package version", () => {
    const program = createProgram();
    expect(program.version()).toBe(VERSION);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("gives options after a subcommand to that subcommand", async () => {
    const program = createProgram();
    let received: Record<string, unknown> | undefined;
    const test = program.commands.find((command) => command.name() === "test")!;
    test.action((flags: Record<string, unknown>) => {
      received = flags;
    });
    await program.parseAsync([
      "node",
      "visualguard",
      "test",
      "--viewport",
      "mobile",
      "--provider",
      "gemini",
      "--no-ai",
      "--route",
      "/a",
    ]);
    expect(received).toMatchObject({
      viewport: ["mobile"],
      provider: "gemini",
      ai: false,
      route: ["/a"],
    });
  });
});
