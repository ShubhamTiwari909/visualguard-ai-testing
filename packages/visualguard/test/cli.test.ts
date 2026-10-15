/**
 * @file Tests CLI version and subcommand option routing.
 *
 * The tests construct the CLI program and check version and subcommand option routing.
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
    test.action((_project: string | undefined, flags: Record<string, unknown>) => {
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
  it("accepts a project name while preserving test flags", async () => {
    const program = createProgram();
    let selected: string | undefined, received: Record<string, unknown> | undefined;
    program.commands.find((command) => command.name() === "test")!.action((project: string | undefined, flags: Record<string, unknown>) => { selected = project; received = flags; });
    await program.parseAsync(["node", "visualguard", "test", "Storefront Web", "--dashboard", "https://dashboard.example.test", "--no-ai", "--environment", "preview", "--pr", "42"]);
    expect(selected).toBe("Storefront Web");
    expect(received).toMatchObject({ dashboard: "https://dashboard.example.test", ai: false, environment: "preview", pr: 42 });
  });
});
