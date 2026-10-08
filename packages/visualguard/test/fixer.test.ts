import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseConfig } from "../src/config/load.js";
import { resolveConfig } from "../src/config/resolve.js";
import { createRun } from "../src/core/run.js";
import { applyEdits, renderDiff, revertEdits, validateEdits } from "../src/fixer/edits.js";
import { fixRegressions, type FixCallbacks } from "../src/fixer/fix.js";
import { heuristicEdits } from "../src/fixer/heuristic-edits.js";
import { locateSource, type Clues } from "../src/fixer/locate.js";
import type { JobResult } from "../src/core/types.js";
import { FIXTURE_ROOT, startFixtureServer, type FixtureServer } from "./helpers/fixture-server.js";
import { MockProvider } from "./helpers/mock-provider.js";

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "vg-fix-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const clues = (overrides: Partial<Clues>): Clues => ({
  testIds: [],
  ids: [],
  classLists: [],
  texts: [],
  components: [],
  styles: [],
  classChanges: [],
  ...overrides,
});

describe("edits", () => {
  it("validates, applies, diffs and reverts search/replace edits", () => {
    const dir = project({
      "src/a.css": ".a { color: red; }\n.b { color: red; }\n",
      ".env": "SECRET=1",
      "package-lock.json": "{}",
    });
    const include = ["src/**"];
    expect(
      validateEdits(
        dir,
        [{ file: "src/a.css", search: "color: red;", replace: "color: blue;", reason: "" }],
        include,
      )[0],
    ).toMatch(/appears 2 times/);
    expect(
      validateEdits(
        dir,
        [{ file: "src/a.css", search: "nope", replace: "x", reason: "" }],
        include,
      )[0],
    ).toMatch(/not found/);
    expect(
      validateEdits(dir, [{ file: ".env", search: "1", replace: "2", reason: "" }], ["**"])[0],
    ).toMatch(/off limits/);
    expect(
      validateEdits(
        dir,
        [{ file: "package-lock.json", search: "{}", replace: "[]", reason: "" }],
        ["**"],
      )[0],
    ).toMatch(/off limits/);

    const edits = [
      {
        file: "src/a.css",
        search: ".b { color: red; }",
        replace: ".b { color: blue; }",
        reason: "restore",
      },
    ];
    expect(validateEdits(dir, edits, include)).toEqual([]);
    expect(renderDiff(dir, edits)).toContain("-.b { color: red; }\n+.b { color: blue; }");
    const originals = applyEdits(dir, edits);
    expect(readFileSync(join(dir, "src/a.css"), "utf8")).toContain(".b { color: blue; }");
    revertEdits(dir, originals);
    expect(readFileSync(join(dir, "src/a.css"), "utf8")).toBe(
      ".a { color: red; }\n.b { color: red; }\n",
    );
  });
});

describe("heuristicEdits", () => {
  const style = (selector: string, property: string, production: string, staging: string) => ({
    kind: "style" as const,
    selector,
    property,
    production,
    staging,
  });

  it("restores a CSS declaration, in the notation the source uses", () => {
    const css = ".hero .btn { background: #7c3aed; }\n.other { background: #7c3aed; }\n";
    const edits = heuristicEdits(
      clues({
        classLists: ["btn"],
        styles: [style("a.btn", "background-color", "rgb(37, 99, 235)", "rgb(124, 58, 237)")],
      }),
      [{ path: "styles/app.css", content: css }],
    );
    expect(edits).toEqual([
      expect.objectContaining({
        file: "styles/app.css",
        search: ".hero .btn { background: #7c3aed; }",
        replace: ".hero .btn { background: #2563eb; }",
      }),
    ]);
  });

  it("swaps Tailwind classes, including padding shorthands", () => {
    const tsx = `export function Card() {\n  return <div className="flex items-start gap-4 p-3">…</div>;\n}\n`;
    const edits = heuristicEdits(
      clues({
        classLists: ["flex items-start gap-4 p-3"],
        styles: [
          style("div.flex", "align-items", "center", "flex-start"),
          ...["top", "right", "bottom", "left"].map((side) =>
            style("div.flex", `padding-${side}`, "24px", "12px"),
          ),
        ],
      }),
      [{ path: "src/Card.tsx", content: tsx }],
    );
    expect(edits).toEqual([
      expect.objectContaining({
        search: "flex items-start gap-4 p-3",
        replace: "flex items-center gap-4 p-6",
      }),
    ]);
  });

  it("restores production's class list when an element's classes changed", () => {
    const tsx = `<button className="rounded bg-violet-600 px-4 text-white">Buy</button>`;
    const edits = heuristicEdits(
      clues({
        classChanges: [
          {
            selector: "button",
            production: "rounded bg-blue-600 px-4 text-white",
            staging: "rounded bg-violet-600 px-4 text-white",
          },
        ],
      }),
      [{ path: "src/Buy.tsx", content: tsx }],
    );
    expect(edits).toEqual([
      expect.objectContaining({
        search: "rounded bg-violet-600 px-4 text-white",
        replace: "rounded bg-blue-600 px-4 text-white",
      }),
    ]);
    expect(edits[0]!.reason).toContain("-bg-violet-600 +bg-blue-600");
  });

  it("leaves ambiguous cases to the AI", () => {
    const css = ".a { align-items: flex-start; }\n.b { align-items: flex-start; }\n";
    expect(
      heuristicEdits(clues({ styles: [style("div.c", "align-items", "center", "flex-start")] }), [
        { path: "x.css", content: css },
      ]),
    ).toEqual([]);
  });
});

describe("locateSource", () => {
  it("ranks a data-testid match above files that only set the property", () => {
    const job = { route: "/pricing", regions: [] } as unknown as JobResult;
    const candidates = locateSource({
      job,
      cwd: tmpdir(),
      clues: clues({
        testIds: ["cta"],
        texts: ["Start free trial"],
        styles: [
          { kind: "style", selector: "x", property: "color", production: "a", staging: "b" },
        ],
      }),
      files: [
        { path: "src/Hero.tsx", content: '<a data-testid="cta">Start free trial</a>' },
        { path: "src/other.css", content: ".x { color: red; }" },
        { path: "src/unrelated.ts", content: "export const a = 1;" },
      ],
    });
    expect(candidates.map((candidate) => candidate.path)).toEqual([
      "src/Hero.tsx",
      "src/other.css",
    ]);
    expect(candidates[0]!.reasons).toEqual(['data-testid="cta"', 'text "Start free trial"']);
  });
});

describe("fix end to end (local server, production fixture)", () => {
  let production: FixtureServer;
  let dir: string;
  let port: number;
  const serverScript = resolve(import.meta.dirname, "helpers/static-site-server.mjs");

  beforeAll(async () => {
    production = await startFixtureServer("production");
    port = await new Promise<number>((done) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const { port: free } = probe.address() as { port: number };
        probe.close(() => done(free));
      });
    });
    // The project: the staging fixture site is the "source code" with the regressions.
    dir = mkdtempSync(join(tmpdir(), "vg-fix-e2e-"));
    cpSync(join(FIXTURE_ROOT, "staging"), join(dir, "site"), { recursive: true });
    writeFileSync(join(dir, ".gitignore"), ".visualguard/\n");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
    git("init", "-q");
    git("-c", "user.email=test@example.com", "-c", "user.name=Test", "add", ".");
    git("-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "init");
  }, 60_000);

  afterAll(() => production?.close());

  const configFor = () =>
    resolveConfig(
      parseConfig({
        baseURL: { production: production.url, staging: `http://127.0.0.1:${port}` },
        routes: ["/alignment", "/color-change", "/spacing", "/text-change"],
        stabilize: { networkQuietMs: 100, freezeTime: "2026-01-01T00:00:00Z" },
        fix: {
          enabled: true,
          include: ["site/**"],
          verify: {
            server: {
              command: `node "${serverScript}" site ${port}`,
              url: `http://127.0.0.1:${port}`,
              readyTimeoutMs: 15_000,
            },
          },
        },
      }),
      { cwd: dir, env: {} },
    );

  it("fixes style regressions without AI and uses the AI for the rest, verifying each one", async () => {
    const config = configFor();
    // The run itself needs the local server too; start it the same way the fixer will.
    const { DevServer } = await import("../src/fixer/verify.js");
    const server = new DevServer(config.fix.verify.server!, dir);
    await server.ensure();
    const { manifest } = await createRun(config).start();
    await server.stop();
    expect(manifest.jobs.map((job) => job.status)).toEqual([
      "review",
      "review",
      "review",
      "review",
    ]);

    const confirmed: string[] = [];
    const callbacks: FixCallbacks = {
      confirm: async (proposal) => {
        confirmed.push(`${proposal.job.route}:${proposal.source}`);
        return true;
      },
      consent: async () => true,
      progress: () => {},
    };
    const provider = new MockProvider((request) => {
      const prompt = request.parts
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("\n");
      expect(prompt).toContain("File: site/text-change.html");
      return {
        summary: "Restore the CTA copy",
        confidence: 0.9,
        edits: [
          {
            file: "site/text-change.html",
            search: ">Start trial</a>",
            replace: ">Start free trial</a>",
            reason: "copy",
          },
        ],
      };
    });

    const outcomes = await fixRegressions(config, { includeReview: true, provider, callbacks });
    const results = Object.fromEntries(
      outcomes.map((outcome) => [outcome.job.route, outcome.result]),
    );
    expect(results).toEqual({
      "/alignment": "fixed",
      "/color-change": "fixed",
      "/spacing": "fixed",
      "/text-change": "fixed",
    });
    expect(confirmed).toEqual([
      "/alignment:heuristic",
      "/color-change:heuristic",
      "/spacing:heuristic",
      "/text-change:ai",
    ]);

    const read = (name: string) => readFileSync(join(dir, "site", name), "utf8");
    expect(read("alignment.html")).toContain(".checkout-summary .actions { align-items: center; }");
    expect(read("color-change.html")).toContain(".hero .btn { background: #2563eb; }");
    expect(read("spacing.html")).toContain(".grid .card { padding: 24px; }");
    expect(read("text-change.html")).toContain(">Start free trial</a>");
    expect(readFileSync(join(dir, ".visualguard", "consent.json"), "utf8")).toContain('"mock"');
  }, 240_000);

  it("refuses to run on a dirty tree or when fixing is off", async () => {
    const config = configFor();
    const callbacks: FixCallbacks = {
      confirm: async () => true,
      consent: async () => true,
      progress: () => {},
    };
    await expect(
      fixRegressions({ ...config, fix: { ...config.fix, enabled: false } }, { callbacks }),
    ).rejects.toThrow(/turned off/);
    await expect(fixRegressions(config, { callbacks })).rejects.toThrow(/uncommitted changes/);
  });
});

describe("watch", () => {
  it("maps changed files to the routes that import them", async () => {
    const { affectedRoutes } = await import("../src/cli/commands/watch.js");
    const pages = [
      { path: "/pricing", file: "app/pricing/page.tsx" },
      { path: "/checkout", file: "app/checkout/page.tsx" },
    ];
    const graph = new Map([
      ["components/PricingCard.tsx", new Set(["app/pricing/page.tsx"])],
      [
        "components/Button.tsx",
        new Set(["components/PricingCard.tsx", "components/CheckoutSummary.tsx"]),
      ],
      ["components/CheckoutSummary.tsx", new Set(["app/checkout/page.tsx"])],
    ]);
    expect(affectedRoutes(["components/PricingCard.tsx"], pages, graph)).toEqual(["/pricing"]);
    expect(affectedRoutes(["components/Button.tsx"], pages, graph)?.sort()).toEqual([
      "/checkout",
      "/pricing",
    ]);
    expect(affectedRoutes(["app/globals.css"], pages, graph)).toBeUndefined();
  });
});
