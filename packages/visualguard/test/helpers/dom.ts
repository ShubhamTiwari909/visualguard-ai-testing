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

/** Builds a DomSnapshot from a nested spec (depth-first order, like the real collector). */
export function snapshot(root: NodeSpec): DomSnapshot {
  const nodes: DomNode[] = [];
  const styles: Array<Record<string, string>> = [];
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
