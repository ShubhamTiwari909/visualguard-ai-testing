import { describe, expect, it } from "vitest";
import { classifyJob } from "../src/mapping/classify.js";
import { mapRegion } from "../src/mapping/deltas.js";
import { describeDeltas, formatValue } from "../src/mapping/describe.js";
import { DomIndex, shiftBox } from "../src/mapping/dom.js";
import { matchTrees } from "../src/mapping/match.js";
import type { RegionResult } from "../src/core/types.js";
import { snapshot, type NodeSpec } from "./helpers/dom.js";

const page = (children: NodeSpec[]): NodeSpec => ({
  tag: "body",
  box: [0, 0, 1000, 800],
  children,
});

function context(
  production: NodeSpec,
  staging: NodeSpec,
  shift?: { fromY: number; deltaY: number },
) {
  const a = new DomIndex(snapshot(production));
  const b = new DomIndex(snapshot(staging));
  return { production: a, staging: b, match: matchTrees(a, b), shift };
}

describe("matchTrees", () => {
  it("aligns siblings around an inserted element", () => {
    const ctx = context(
      page([
        { tag: "section", key: "testid:hero", text: "Hero" },
        { tag: "div", cls: "grid", text: "Grid one" },
        { tag: "div", cls: "grid", text: "Grid two" },
      ]),
      page([
        { tag: "div", cls: "banner", text: "New!" },
        { tag: "section", key: "testid:hero", text: "Hero" },
        { tag: "div", cls: "grid", text: "Grid one" },
        { tag: "div", cls: "grid", text: "Grid two" },
      ]),
    );
    expect([...ctx.match.forward.entries()]).toEqual([
      [1, 2],
      [0, 0],
      [2, 3],
      [3, 4],
    ]);
    expect(ctx.match.backward.has(1)).toBe(false);
  });

  it("matches keyed elements that moved to another parent", () => {
    const ctx = context(
      page([
        { tag: "div", children: [{ tag: "button", key: "testid:buy", text: "Buy" }] },
        { tag: "aside" },
      ]),
      page([
        { tag: "div" },
        { tag: "aside", children: [{ tag: "button", key: "testid:buy", text: "Buy" }] },
      ]),
    );
    expect(ctx.match.forward.get(2)).toBe(3);
  });
});

describe("mapRegion", () => {
  it("reports style changes on the element, not on children that inherit them", () => {
    const ctx = context(
      page([
        {
          tag: "p",
          cls: "note",
          box: [0, 0, 200, 40],
          style: { color: "rgb(37, 99, 235)" },
          children: [
            { tag: "span", text: "Hi", box: [0, 0, 20, 20], style: { color: "rgb(37, 99, 235)" } },
          ],
        },
      ]),
      page([
        {
          tag: "p",
          cls: "note",
          box: [0, 0, 200, 40],
          style: { color: "rgb(124, 58, 237)" },
          children: [
            { tag: "span", text: "Hi", box: [0, 0, 20, 20], style: { color: "rgb(124, 58, 237)" } },
          ],
        },
      ]),
    );
    const { deltas } = mapRegion(ctx, { x: 0, y: 0, width: 200, height: 40 });
    expect(deltas).toEqual([
      {
        kind: "style",
        selector: "p.note",
        property: "color",
        production: "rgb(37, 99, 235)",
        staging: "rgb(124, 58, 237)",
      },
    ]);
  });

  it("finds the container layout change behind moved children", () => {
    const child = (y: number) => ({
      tag: "a",
      key: "testid:pay",
      text: "Pay",
      box: [800, y, 100, 40] as [number, number, number, number],
    });
    const ctx = context(
      page([
        {
          tag: "div",
          cls: "actions",
          box: [0, 100, 1000, 96],
          style: { "align-items": "center" },
          children: [child(128)],
        },
      ]),
      page([
        {
          tag: "div",
          cls: "actions",
          box: [0, 100, 1000, 96],
          style: { "align-items": "flex-start" },
          children: [child(100)],
        },
      ]),
    );
    const { deltas, elements } = mapRegion(ctx, { x: 800, y: 100, width: 100, height: 68 });
    expect(deltas[0]).toMatchObject({
      kind: "style",
      selector: "div.actions",
      property: "align-items",
    });
    expect(elements[0]!.selector).toBe("a");
    expect(describeDeltas(deltas)).toBe(
      "Alignment changed: align-items center → flex-start on div.actions",
    );
  });

  it("reports added and removed elements once, at the root of the subtree", () => {
    const ctx = context(
      page([
        {
          tag: "nav",
          box: [0, 0, 1000, 50],
          children: [{ tag: "a", key: "testid:cta", text: "Start", box: [10, 10, 80, 30] }],
        },
      ]),
      page([
        {
          tag: "nav",
          box: [0, 0, 1000, 50],
          children: [
            {
              tag: "div",
              cls: "promo",
              box: [10, 10, 80, 30],
              children: [{ tag: "b", text: "Sale", box: [10, 10, 40, 20] }],
            },
          ],
        },
      ]),
    );
    const { deltas } = mapRegion(ctx, { x: 0, y: 0, width: 100, height: 50 });
    expect(deltas.filter((delta) => delta.kind === "presence")).toEqual([
      { kind: "presence", selector: "div.promo", presentIn: "staging" },
      { kind: "presence", selector: "a", presentIn: "production" },
    ]);
  });

  it("ignores movement explained by a layout shift", () => {
    expect(shiftBox({ x: 0, y: 300, width: 10, height: 10 }, { fromY: 100, deltaY: 50 }).y).toBe(
      350,
    );
    expect(shiftBox({ x: 0, y: 120, width: 10, height: 10 }, { fromY: 100, deltaY: -50 }).y).toBe(
      120,
    );
    expect(shiftBox({ x: 0, y: 160, width: 10, height: 10 }, { fromY: 100, deltaY: -50 }).y).toBe(
      110,
    );
    const ctx = context(
      page([{ tag: "footer", text: "Footer", box: [0, 300, 1000, 40] }]),
      page([{ tag: "footer", text: "Footer", box: [0, 350, 1000, 40] }]),
      { fromY: 100, deltaY: 50 },
    );
    expect(mapRegion(ctx, { x: 0, y: 350, width: 1000, height: 40 }).deltas).toEqual([]);
  });
});

describe("describeDeltas", () => {
  it("formats colours and rounds pixel values", () => {
    expect(formatValue("rgb(37, 99, 235)")).toBe("#2563eb");
    expect(formatValue("rgba(0, 0, 0, 0.5)")).toBe("#000000 @ 0.5");
    expect(formatValue("179.516px 12px")).toBe("179.5px 12px");
  });

  it("groups four equal padding sides", () => {
    const sides = ["top", "right", "bottom", "left"].map((side) => ({
      kind: "style" as const,
      selector: "div.card",
      property: `padding-${side}`,
      production: "24px",
      staging: "12px",
    }));
    expect(describeDeltas(sides)).toBe("Spacing changed: padding 24px → 12px on div.card");
  });

  it("describes text and movement", () => {
    expect(
      describeDeltas([
        { kind: "text", selector: "a", production: "Start free trial", staging: "Start trial" },
      ]),
    ).toBe("Text changed: “Start free trial” → “Start trial”");
    expect(
      describeDeltas([
        {
          kind: "box",
          selector: "footer",
          production: { x: 0, y: 300, width: 10, height: 10 },
          staging: { x: 0, y: 276, width: 10, height: 10 },
        },
      ]),
    ).toBe("Moved 24px up: footer");
  });
});

describe("classifyJob", () => {
  const region = (box: RegionResult["box"]): RegionResult => ({
    id: 0,
    box,
    diffPixels: 30,
    elements: [],
    deltas: [],
  });

  it("treats tiny changes with no DOM change as rendering noise", () => {
    const dom = snapshot(page([{ tag: "p", text: "Same" }]));
    const result = classifyJob({
      diff: { width: 1000, height: 800, diffPixels: 30, diffRatio: 30 / 800_000 },
      regions: [region({ x: 10, y: 10, width: 8, height: 8 })],
      production: dom,
      staging: dom,
    });
    expect(result.status).toBe("pass");
    expect(result.findings[0]!.message).toMatch(/rendering noise/);
  });

  it("flags a removed control as a regression", () => {
    const result = classifyJob({
      diff: { width: 1000, height: 800, diffPixels: 3000, diffRatio: 0.004 },
      regions: [region({ x: 0, y: 0, width: 200, height: 60 })],
      production: snapshot(
        page([
          {
            tag: "a",
            key: "testid:cta",
            sel: '[data-testid="cta"]',
            text: "Buy now",
            box: [10, 10, 100, 40],
          },
        ]),
      ),
      staging: snapshot(page([])),
    });
    expect(result.status).toBe("regression");
    expect(result.findings[0]!.message).toBe('[data-testid="cta"] “Buy now” is missing on staging');
  });
});

describe("contrast", () => {
  it("computes WCAG ratios and blends backgrounds", async () => {
    const { contrastRatio, parseColor, textContrast } = await import("../src/mapping/contrast.js");
    const white = parseColor("rgb(255, 255, 255)")!;
    expect(contrastRatio(parseColor("rgb(0, 0, 0)")!, white)).toBeCloseTo(21, 0);
    expect(contrastRatio(parseColor("rgb(71, 85, 105)")!, white)).toBeCloseTo(7.6, 1);
    expect(contrastRatio(parseColor("rgb(226, 232, 240)")!, white)).toBeLessThan(1.3);

    const dom = new DomIndex(
      snapshot({
        tag: "body",
        style: { "background-color": "rgb(15, 23, 42)" },
        children: [
          {
            tag: "p",
            text: "Hi",
            style: { color: "rgb(255, 255, 255)", "background-color": "rgba(0, 0, 0, 0)" },
          },
        ],
      }),
    );
    expect(textContrast(dom, 1)).toBeGreaterThan(15);
  });
});
