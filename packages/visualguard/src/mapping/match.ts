/**
 * @file Matches production and staging DOM trees, including stable keys, sibling changes and
 * moved elements.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import type { DomIndex } from "./dom.js";

export interface TreeMatch {
  /**
   * production index → staging index
   */
  forward: Map<number, number>;
  /**
   * staging index → production index
   */
  backward: Map<number, number>;
}

const LCS_LIMIT = 400;

/**
 * Build a compact tag/key signature for sibling matching. A stable key makes otherwise similar
 * elements distinguishable.
 */
function signature(dom: DomIndex, index: number): string {
  const node = dom.node(index);
  return `${node.tag}|${node.key ?? ""}`;
}

/**
 * How well two siblings correspond: 0 means they can't match (different tag or key); otherwise
 * matching class and text make the pairing more likely.
 *
 * Score how plausibly two nodes correspond, rejecting incompatible tags/keys. Matching stable
 * keys, classes and text increase the score.
 */
function weight(production: DomIndex, a: number, staging: DomIndex, b: number): number {
  const nodeA = production.node(a);
  const nodeB = staging.node(b);
  if (nodeA.tag !== nodeB.tag) return 0;
  if ((nodeA.key || nodeB.key) && nodeA.key !== nodeB.key) return 0;
  let score = nodeA.key ? 8 : 2;
  if ((nodeA.cls ?? "").split(" ")[0] === (nodeB.cls ?? "").split(" ")[0]) score += 1;
  if (nodeA.text && nodeA.text === nodeB.text) score += 1;
  return score;
}

/**
 * Weighted longest common subsequence of two child lists; returns matched index pairs.
 *
 * Find the highest-scoring in-order matching of two child lists using dynamic programming. The
 * table stores the best remaining score at each pair of positions, then a second walk
 * reconstructs matched indexes.
 */
function align(
  production: DomIndex,
  a: number[],
  staging: DomIndex,
  b: number[],
): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  // table[i][j] stores the best matching score for the suffixes beginning at i and j.
  // An extra row/column of zeros handles empty suffixes without special edge branches.
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  const weights = Array.from({ length: n }, (_, i) =>
    b.map((_, j) => weight(production, a[i]!, staging, b[j]!)),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const w = weights[i]![j]!;
      table[i]![j] = Math.max(
        table[i + 1]![j]!,
        table[i]![j + 1]!,
        w > 0 ? w + table[i + 1]![j + 1]! : 0,
      );
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const w = weights[i]![j]!;
    if (w > 0 && table[i]![j] === w + table[i + 1]![j + 1]!) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/**
 * Greedy in-order matching for very long child lists.
 *
 * Match equal signatures in order without building a quadratic table. This cheaper fallback
 * handles very long child lists while preserving sibling order.
 */
function greedy(a: string[], b: string[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  let j = 0;
  for (let i = 0; i < a.length && j < b.length; i++) {
    const found = b.indexOf(a[i]!, j);
    if (found >= 0) {
      pairs.push([i, found]);
      j = found + 1;
    }
  }
  return pairs;
}

/**
 * Matches elements between the two snapshots (PLAN.md §9.2). Elements with the same test id or
 * stable id match first, wherever they are; then children of matched parents are aligned like
 * lines in a text diff (LCS on tag + key), so an inserted banner doesn't shift every match
 * after it.
 *
 * Pair unique stable keys first, then align children of paired parents to handle
 * insertions/removals. Return forward and backward Maps so either environment can find its
 * counterpart.
 */
export function matchTrees(production: DomIndex, staging: DomIndex): TreeMatch {
  const forward = new Map<number, number>();
  const backward = new Map<number, number>();
  /**
   * Record a one-to-one node match only when neither endpoint is already paired. Updating both
   * Maps preserves the correspondence in both directions.
   */
  const pair = (a: number, b: number) => {
    if (forward.has(a) || backward.has(b)) return false;
    forward.set(a, b);
    backward.set(b, a);
    return true;
  };

  // 1. Unique keys present on both sides.
  /**
   * Group node indexes by stable key. Keeping an array for each key reveals duplicates, which
   * should not be treated as unambiguous identities.
   */
  const keyed = (dom: DomIndex) => {
    const byKey = new Map<string, number[]>();
    for (const node of dom.nodes) {
      if (!node.key) continue;
      const list = byKey.get(node.key) ?? [];
      list.push(node.i);
      byKey.set(node.key, list);
    }
    return byKey;
  };
  const keysB = keyed(staging);
  for (const [key, list] of keyed(production)) {
    const other = keysB.get(key);
    if (list.length === 1 && other?.length === 1) pair(list[0]!, other[0]!);
  }

  // 2. Align children of matched parents, starting from the roots.
  if (production.nodes.length === 0 || staging.nodes.length === 0) return { forward, backward };
  pair(0, 0);
  const queue: Array<[number, number]> = [[0, 0]];
  const visited = new Set<number>();
  for (let head = 0; head < queue.length; head++) {
    const [a, b] = queue[head]!;
    if (visited.has(a)) continue;
    visited.add(a);
    // Keyed children stay in the lists as anchors so their unkeyed siblings align around them.
    const childrenA = production.children[a]!;
    const childrenB = staging.children[b]!;
    const pairs =
      childrenA.length <= LCS_LIMIT && childrenB.length <= LCS_LIMIT
        ? align(production, childrenA, staging, childrenB)
        : greedy(
            childrenA.map((child) => signature(production, child)),
            childrenB.map((child) => signature(staging, child)),
          );
    for (const [i, j] of pairs) pair(childrenA[i]!, childrenB[j]!);

    // Continue into every matched child, including ones matched earlier by key.
    for (const child of production.children[a]!) {
      const counterpart = forward.get(child);
      if (counterpart !== undefined) queue.push([child, counterpart]);
    }
  }

  // 3. Keyed elements that moved under a different parent: descend into them too.
  for (const [a, b] of [...forward]) {
    if (!visited.has(a)) {
      const stack: Array<[number, number]> = [[a, b]];
      while (stack.length > 0) {
        const [pa, pb] = stack.pop()!;
        if (visited.has(pa)) continue;
        visited.add(pa);
        const childrenA = production.children[pa]!;
        const childrenB = staging.children[pb]!;
        for (const [i, j] of align(production, childrenA, staging, childrenB)) {
          if (pair(childrenA[i]!, childrenB[j]!)) stack.push([childrenA[i]!, childrenB[j]!]);
        }
      }
    }
  }
  return { forward, backward };
}
