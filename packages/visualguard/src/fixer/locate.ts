import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { DomNode, DomSnapshot } from "../capture/dom-snapshot.js";
import { discoverNextRoutes } from "../config/discover/nextjs.js";
import type { JobResult, StyleDelta } from "../core/types.js";
import type { SourceFile } from "./files.js";

export interface Candidate {
  path: string;
  score: number;
  reasons: string[];
  /** 0-based line numbers that matched a clue. */
  lines: number[];
}

/** What the run knows about the changed elements, used to find them in the source. */
export interface Clues {
  testIds: string[];
  ids: string[];
  /** Full class attributes of the changed elements (from the DOM snapshots). */
  classLists: string[];
  texts: string[];
  components: string[];
  styles: StyleDelta[];
  /** Elements whose class attribute differs between production and staging. */
  classChanges: Array<{ selector: string; production: string; staging: string }>;
}

function loadDom(runDir: string, path: string | undefined): DomSnapshot | undefined {
  if (!path || !existsSync(join(runDir, path))) return undefined;
  try {
    return JSON.parse(readFileSync(join(runDir, path), "utf8")) as DomSnapshot;
  } catch {
    return undefined;
  }
}

/** Collects test ids, classes, texts and style changes from a job's regions and analysis. */
export function collectClues(job: JobResult, runDir: string): Clues {
  const selectors = new Set<string>();
  const texts = new Set<string>();
  const components = new Set<string>();
  const styles: StyleDelta[] = [];
  for (const region of job.regions) {
    for (const element of region.elements) {
      selectors.add(element.selector);
      if (element.text) texts.add(element.text);
      if (element.component) components.add(element.component);
    }
    for (const delta of region.deltas) {
      selectors.add(delta.selector);
      if (delta.kind === "text") {
        if (delta.production) texts.add(delta.production);
        if (delta.staging) texts.add(delta.staging);
      }
      if (delta.kind === "style") styles.push(delta);
    }
  }
  for (const item of job.analysis?.affected ?? []) {
    selectors.add(item.selector);
    if (item.component) components.add(item.component);
  }

  const testIds = new Set<string>();
  const ids = new Set<string>();
  for (const selector of selectors) {
    for (const match of selector.matchAll(/\[data-testid="([^"]+)"\]/g)) testIds.add(match[1]!);
    for (const match of selector.matchAll(/#([\w-]+)/g)) ids.add(match[1]!);
  }

  // Class attributes of the changed elements, from both snapshots.
  const classLists = new Set<string>();
  const nodesBySelector: Partial<Record<"production" | "staging", Map<string, DomNode[]>>> = {};
  for (const env of ["staging", "production"] as const) {
    const dom = loadDom(runDir, job.captures[env]?.dom);
    if (!dom) continue;
    const bySelector = new Map<string, DomNode[]>();
    for (const node of dom.nodes)
      bySelector.set(node.sel, [...(bySelector.get(node.sel) ?? []), node]);
    nodesBySelector[env] = bySelector;
    for (const selector of selectors) {
      for (const node of bySelector.get(selector) ?? []) if (node.cls) classLists.add(node.cls);
    }
  }

  // Utility-class projects: when an element's classes changed, production's classes are the fix.
  const classChanges: Clues["classChanges"] = [];
  for (const selector of selectors) {
    const before = nodesBySelector.production?.get(selector);
    const after = nodesBySelector.staging?.get(selector);
    if (before?.length !== 1 || after?.length !== 1) continue;
    const [production, staging] = [before[0]!.cls, after[0]!.cls];
    if (production && staging && production !== staging)
      classChanges.push({ selector, production, staging });
  }

  return {
    testIds: [...testIds],
    ids: [...ids],
    classLists: [...classLists],
    texts: [...texts].filter((text) => text.trim().length >= 3),
    components: [...components],
    styles,
    classChanges,
  };
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function linesMatching(content: string, test: (line: string) => boolean): number[] {
  const lines: number[] = [];
  content.split("\n").forEach((line, index) => {
    if (test(line)) lines.push(index);
  });
  return lines;
}

/** Page files that render a route (Next.js file-system routing). */
export function routeFiles(cwd: string, route: string): string[] {
  const path = route.split(/[?#]/)[0]!.replace(/\/$/, "") || "/";
  const pattern = (filePath: string) =>
    new RegExp(
      `^${filePath
        .split("/")
        .map((segment) =>
          segment.startsWith("[[...")
            ? "(?:/.*)?"
            : segment.startsWith("[...")
              ? ".+"
              : segment.startsWith("[")
                ? "[^/]+"
                : escapeRegExp(segment),
        )
        .join("/")
        .replace(/\/\(\?:\/\.\*\)\?/g, "(?:/.*)?")}$`,
    );
  return discoverNextRoutes(cwd)
    .filter((candidate) => candidate.path === path || pattern(candidate.path).test(path))
    .map((candidate) => candidate.file);
}

/** Relative imports of a file, resolved to project paths (also `@/` and `~/` aliases). */
export function localImports(file: SourceFile, files: Map<string, SourceFile>): string[] {
  const results: string[] = [];
  for (const match of file.content.matchAll(
    /(?:from\s+|import\s*\(\s*|import\s+)["']((?:\.{1,2}|@|~)\/[^"']+)["']/g,
  )) {
    const spec = match[1]!;
    const bases = spec.startsWith(".")
      ? [
          normalize(join(dirname(file.path), spec))
            .split("\\")
            .join("/"),
        ]
      : [spec.replace(/^[@~]\//, "src/"), spec.replace(/^[@~]\//, "")];
    for (const base of bases) {
      const found = [
        "",
        ".tsx",
        ".ts",
        ".jsx",
        ".js",
        ".css",
        ".scss",
        "/index.tsx",
        "/index.ts",
        "/index.jsx",
        "/index.js",
      ]
        .map((suffix) => `${base}${suffix}`)
        .find((candidate) => files.has(candidate));
      if (found) {
        results.push(found);
        break;
      }
    }
  }
  return results;
}

/**
 * Ranks source files by how likely they are to contain the regression (PLAN.md §13.3): files
 * changed since `compareRef`, the route's page and its imports, then matches for test ids, ids,
 * class lists, visible text, component names and changed CSS values.
 */
export function locateSource(input: {
  job: JobResult;
  clues: Clues;
  files: SourceFile[];
  cwd: string;
  changed?: Set<string>;
  limit?: number;
}): Candidate[] {
  const { clues, files } = input;
  const byPath = new Map(files.map((file) => [file.path, file]));
  const candidates = new Map<string, Candidate>();
  const add = (path: string, score: number, reason: string, lines: number[] = []) => {
    const candidate = candidates.get(path) ?? { path, score: 0, reasons: [], lines: [] };
    candidate.score += score;
    if (!candidate.reasons.includes(reason)) candidate.reasons.push(reason);
    candidate.lines.push(...lines);
    candidates.set(path, candidate);
  };

  for (const path of input.changed ?? [])
    if (byPath.has(path)) add(path, 5, "changed since compare ref");
  for (const path of routeFiles(input.cwd, input.job.route)) {
    const page = byPath.get(path);
    if (!page) continue;
    add(path, 4, `renders ${input.job.route}`);
    for (const imported of localImports(page, byPath)) add(imported, 2, `imported by ${path}`);
  }

  // Static sites and many frameworks name files after the route: /pricing → pricing.html.
  const segment = input.job.route.split(/[?#]/)[0]!.replace(/\/$/, "").split("/").pop() || "index";
  const named = new RegExp(
    `(^|/)${escapeRegExp(segment)}(/index)?\\.(html|tsx|jsx|vue|svelte|astro|mdx?)$`,
  );
  for (const file of files)
    if (named.test(file.path)) add(file.path, 3, `named like ${input.job.route}`);

  for (const file of files) {
    for (const testId of clues.testIds) {
      const pattern = new RegExp(`data-testid\\s*=\\s*\\{?\\s*["'\`]${escapeRegExp(testId)}["'\`]`);
      const lines = linesMatching(file.content, (line) => pattern.test(line));
      if (lines.length > 0) add(file.path, 6, `data-testid="${testId}"`, lines);
    }
    for (const id of clues.ids) {
      const pattern = new RegExp(
        `\\bid\\s*=\\s*\\{?\\s*["'\`]${escapeRegExp(id)}["'\`]|#${escapeRegExp(id)}\\b`,
      );
      const lines = linesMatching(file.content, (line) => pattern.test(line));
      if (lines.length > 0) add(file.path, 4, `#${id}`, lines);
    }
    for (const classList of clues.classLists) {
      const exact = linesMatching(file.content, (line) => line.includes(classList));
      if (exact.length > 0) {
        add(file.path, 5, `class="${classList.slice(0, 40)}"`, exact);
        continue;
      }
      // Class names also appear in CSS selectors, or split across a className expression.
      const tokens = classList
        .split(/\s+/)
        .filter((token) => token.length >= 4 && !/^(flex|grid|block|hidden|relative)$/.test(token));
      const lines = linesMatching(file.content, (line) => {
        const hits = tokens.filter((token) =>
          new RegExp(`(^|[\\s"'\`.])${escapeRegExp(token)}(?=$|[\\s"'\`{:,])`).test(line),
        );
        return hits.length >= Math.min(2, tokens.length) && hits.length > 0;
      });
      if (lines.length > 0) add(file.path, 2, `classes from "${classList.slice(0, 30)}"`, lines);
    }
    for (const text of clues.texts) {
      const lines = linesMatching(file.content, (line) => line.includes(text));
      if (lines.length > 0) add(file.path, 4, `text "${text.slice(0, 30)}"`, lines);
    }
    for (const component of clues.components) {
      if (
        new RegExp(`(^|/)${escapeRegExp(component)}\\.(tsx|jsx|vue|svelte|astro)$`).test(file.path)
      )
        add(file.path, 4, `component ${component}`);
    }
    for (const delta of clues.styles) {
      const pattern = new RegExp(`${escapeRegExp(delta.property)}\\s*:`);
      const lines = linesMatching(file.content, (line) => pattern.test(line));
      if (lines.length > 0) add(file.path, 1, `sets ${delta.property}`, lines);
    }
  }

  return [...candidates.values()]
    .map((candidate) => ({
      ...candidate,
      lines: [...new Set(candidate.lines)].sort((a, b) => a - b),
    }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, input.limit ?? 5);
}

/** The parts of a file worth showing a model: whole small files, windows around matches otherwise. */
export function excerpt(
  content: string,
  lines: number[],
  options: { maxLines?: number; context?: number } = {},
): string {
  const all = content.split("\n");
  const maxLines = options.maxLines ?? 250;
  if (all.length <= maxLines || lines.length === 0)
    return all.slice(0, Math.max(maxLines, 1)).join("\n");
  const context = options.context ?? 25;
  const ranges: Array<[number, number]> = [];
  for (const line of lines) {
    const start = Math.max(0, line - context);
    const end = Math.min(all.length, line + context + 1);
    const last = ranges.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }
  return ranges.map(([start, end]) => all.slice(start, end).join("\n")).join("\n/* … */\n");
}
