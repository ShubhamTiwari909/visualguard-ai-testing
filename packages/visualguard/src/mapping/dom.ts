/**
 * @file Indexes DOM nodes, resolves labels/ancestry and provides geometry
 * intersection/area/shift operations.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import type { DomNode, DomSnapshot } from "../capture/dom-snapshot.js";
import type { Box } from "../core/types.js";

/**
 * Read helpers over a snapshot: children, ancestry, boxes and styles.
 */
export class DomIndex {
  readonly nodes: DomNode[];
  readonly children: number[][];

  /**
   * Wrap a flat snapshot and build an array of child indexes for each node. Parent/child
   * indexes avoid storing a second recursive tree while enabling fast traversal.
   */
  constructor(readonly snapshot: DomSnapshot) {
    this.nodes = snapshot.nodes;
    this.children = this.nodes.map(() => []);
    for (const node of this.nodes) if (node.p >= 0) this.children[node.p]!.push(node.i);
  }

  /**
   * Return the snapshot node at a known valid index. The non-null assertion ! expresses that
   * caller contract to TypeScript; it does not add a runtime bounds check.
   */
  node(index: number): DomNode {
    return this.nodes[index]!;
  }

  /**
   * Expand the stored [x, y, width, height] tuple into a named rectangle object. Destructuring
   * assigns each array position to its readable field name.
   */
  box(index: number): Box {
    const [x, y, width, height] = this.nodes[index]!.box;
    return { x, y, width, height };
  }

  /**
   * Look up the node's shared computed-style record, falling back to an empty object. Snapshots
   * deduplicate styles and reference them by index to save space.
   */
  style(index: number): Record<string, string> {
    return this.snapshot.styles[this.nodes[index]!.s] ?? {};
  }

  /**
   * Check whether the captured node has no element children. Leaves are useful candidates
   * because their boxes often correspond to individual visible content.
   */
  isLeaf(index: number): boolean {
    return this.nodes[index]!.n === 0;
  }

  /**
   * True when `ancestor` is a strict ancestor of `index`.
   *
   * Walk parent indexes to check for a strict ancestor relationship. Start at the parent, so a
   * node is never considered its own ancestor.
   */
  isAncestor(ancestor: number, index: number): boolean {
    let current = this.nodes[index]?.p ?? -1;
    while (current >= 0) {
      if (current === ancestor) return true;
      current = this.nodes[current]!.p;
    }
    return false;
  }

  /**
   * Visible content: leaves, images, form controls, or anything with a background or border.
   *
   * Recognize leaves, controls, images and visibly painted nodes as useful content. This
   * heuristic filters structural containers that offer little explanation.
   */
  isContent(index: number): boolean {
    const node = this.nodes[index]!;
    if (
      node.n === 0 ||
      ["img", "svg", "button", "input", "select", "textarea", "video", "canvas"].includes(node.tag)
    ) {
      return true;
    }
    const style = this.style(index);
    /**
     * Recognize absent, explicitly transparent or zero-alpha background color text. This is a
     * small supported-format predicate used by the content heuristic.
     */
    const transparent = (value: string | undefined) =>
      !value || value === "transparent" || /rgba\(.*,\s*0\)$/.test(value);
    return (
      !transparent(style["background-color"]) || (style["border-top-width"] ?? "0px") !== "0px"
    );
  }

  /**
   * Elements whose own box is meaningful to compare: leaves, replaced elements, text holders.
   *
   * Choose nodes whose own bounds are meaningful to compare, such as text holders and replaced
   * elements. Large structural wrappers are less useful for direct movement findings.
   */
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

  /**
   * Describe a node using its selector and shortened text/accessibility name. Keep the selector
   * when no visible label is available.
   */
  label(index: number): string {
    const node = this.nodes[index]!;
    const text = node.text ?? node.name;
    return text ? `${node.sel} “${text.length > 40 ? `${text.slice(0, 39)}…` : text}”` : node.sel;
  }
}

/**
 * Calculate rectangle area after clamping negative dimensions to zero. This makes geometry
 * scoring safe for degenerate boxes.
 */
export function area(box: Box): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

/**
 * Calculate the overlapping area of two rectangles, or zero when they are disjoint. Overlap
 * width/height come from the nearer far edge minus the farther near edge.
 */
export function intersection(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * Moves a production box into staging coordinates after a layout shift. For an insertion
 * (deltaY > 0) everything from `fromY` moves down; for a removal the removed band [fromY, fromY
 * - deltaY) stays where it was and everything after it moves up.
 *
 * Translate production geometry into staging coordinates below an insertion/removal boundary.
 * Preserve the removed band while shifting the content after it.
 */
export function shiftBox(box: Box, shift: { fromY: number; deltaY: number } | undefined): Box {
  if (!shift) return box;
  const movesFrom = shift.deltaY > 0 ? shift.fromY : shift.fromY - shift.deltaY;
  return box.y >= movesFrom ? { ...box, y: box.y + shift.deltaY } : box;
}
