import type { DomNode, DomSnapshot } from "../capture/dom-snapshot.js";
import type { Box } from "../core/types.js";

/** Read helpers over a snapshot: children, ancestry, boxes and styles. */
export class DomIndex {
  readonly nodes: DomNode[];
  readonly children: number[][];

  constructor(readonly snapshot: DomSnapshot) {
    this.nodes = snapshot.nodes;
    this.children = this.nodes.map(() => []);
    for (const node of this.nodes) if (node.p >= 0) this.children[node.p]!.push(node.i);
  }

  node(index: number): DomNode {
    return this.nodes[index]!;
  }

  box(index: number): Box {
    const [x, y, width, height] = this.nodes[index]!.box;
    return { x, y, width, height };
  }

  style(index: number): Record<string, string> {
    return this.snapshot.styles[this.nodes[index]!.s] ?? {};
  }

  isLeaf(index: number): boolean {
    return this.nodes[index]!.n === 0;
  }

  /** True when `ancestor` is a strict ancestor of `index`. */
  isAncestor(ancestor: number, index: number): boolean {
    let current = this.nodes[index]?.p ?? -1;
    while (current >= 0) {
      if (current === ancestor) return true;
      current = this.nodes[current]!.p;
    }
    return false;
  }

  /** Visible content: leaves, images, form controls, or anything with a background or border. */
  isContent(index: number): boolean {
    const node = this.nodes[index]!;
    if (
      node.n === 0 ||
      ["img", "svg", "button", "input", "select", "textarea", "video", "canvas"].includes(node.tag)
    ) {
      return true;
    }
    const style = this.style(index);
    const transparent = (value: string | undefined) =>
      !value || value === "transparent" || /rgba\(.*,\s*0\)$/.test(value);
    return (
      !transparent(style["background-color"]) || (style["border-top-width"] ?? "0px") !== "0px"
    );
  }

  /** Elements whose own box is meaningful to compare: leaves, replaced elements, text holders. */
  isAtomic(index: number): boolean {
    const node = this.nodes[index]!;
    return (
      node.n === 0 ||
      Boolean(node.text) ||
      ["img", "svg", "button", "input", "select", "textarea", "video", "canvas", "iframe"].includes(
        node.tag,
      )
    );
  }

  label(index: number): string {
    const node = this.nodes[index]!;
    const text = node.text ?? node.name;
    return text ? `${node.sel} “${text.length > 40 ? `${text.slice(0, 39)}…` : text}”` : node.sel;
  }
}

export function area(box: Box): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

export function intersection(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * Moves a production box into staging coordinates after a layout shift. For an insertion
 * (deltaY > 0) everything from `fromY` moves down; for a removal the removed band
 * [fromY, fromY - deltaY) stays where it was and everything after it moves up.
 */
export function shiftBox(box: Box, shift: { fromY: number; deltaY: number } | undefined): Box {
  if (!shift) return box;
  const movesFrom = shift.deltaY > 0 ? shift.fromY : shift.fromY - shift.deltaY;
  return box.y >= movesFrom ? { ...box, y: box.y + shift.deltaY } : box;
}
