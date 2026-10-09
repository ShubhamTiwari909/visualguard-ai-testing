/**
 * @file Constructs synthetic DOM snapshots/nodes used in matching and classification tests.
 *
 * Tests are executable examples: describe groups a scenario, it/test names one expectation, and
 * expect checks the result. Helpers below create controlled data or temporary resources so
 * assertions do not depend on a developer's environment.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import type { DomNode, DomSnapshot } from "../../src/capture/dom-snapshot.js";

export interface NodeSpec {
  tag: string;
  sel?: string;
  key?: string;
  cls?: string;
  text?: string;
  box?: [number, number, number, number];
  style?: Record<string, string>;
  children?: NodeSpec[];
}

/**
 * Builds a DomSnapshot from a nested spec (depth-first order, like the real collector).
 *
 * Convert readable nested test nodes into the real flat snapshot format in depth-first order.
 * This lets matching tests specify small DOM examples without browser capture.
 */
export function snapshot(root: NodeSpec): DomSnapshot {
  const nodes: DomNode[] = [];
  const styles: Array<Record<string, string>> = [];
  /**
   * Add one synthetic node/style record and recurse into its children with the parent index.
   * Node indexes must match their positions for DomIndex to behave like a captured snapshot.
   */
  const visit = (spec: NodeSpec, parent: number) => {
    const style = { display: "block", color: "rgb(0, 0, 0)", ...spec.style };
    styles.push(style);
    const node: DomNode = {
      i: nodes.length,
      p: parent,
      tag: spec.tag,
      sel: spec.sel ?? (spec.cls ? `${spec.tag}.${spec.cls.split(" ")[0]}` : spec.tag),
      box: spec.box ?? [0, 0, 100, 20],
      s: styles.length - 1,
      n: spec.children?.length ?? 0,
    };
    if (spec.key) node.key = spec.key;
    if (spec.cls) node.cls = spec.cls;
    if (spec.text) node.text = spec.text;
    nodes.push(node);
    for (const child of spec.children ?? []) visit(child, node.i);
  };
  visit(root, -1);
  return {
    version: 1,
    url: "http://test/",
    viewport: { width: 1000, height: 800 },
    nodes,
    styles,
    truncated: false,
  };
}
