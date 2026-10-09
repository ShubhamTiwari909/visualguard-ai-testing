/**
 * @file Serializes relevant visible DOM structure, selectors, text, computed styles and
 * bounding boxes for later explanation.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import type { Page } from "playwright";

/**
 * A compact DOM snapshot taken right after the screenshot (PLAN.md §9.1). Computed styles are
 * stored once per unique combination in `styles` and referenced by index, which keeps snapshots
 * small: most elements share their styles with many others.
 */
/**
 * A compact captured element. Short field names reduce snapshot JSON size: i/p/s are indexes,
 * not nested objects; box is measured in page pixels.
 */
export interface DomNode {
  /**
   * Index of this node in `nodes`.
   */
  i: number;
  /**
   * Parent index, -1 for the root.
   */
  p: number;
  tag: string;
  /**
   * Human-readable selector for reports.
   */
  sel: string;
  /**
   * data-testid (or data-test / data-cy) or a stable-looking id.
   */
  key?: string;
  /**
   * Captured class-list text, used as a source-location clue rather than a stable identity.
   */
  cls?: string;
  /**
   * The element's own text (direct text nodes only).
   */
  text?: string;
  /**
   * aria-label, alt or title.
   */
  name?: string;
  role?: string;
  /**
   * data-component hint.
   */
  comp?: string;
  /**
   * Resolved media URL when the element exposes one.
   */
  src?: string;
  /**
   * An image finished loading but has no decoded width.
   */
  broken?: boolean;
  /**
   * Content is wider or taller than the box and the overflow is hidden: text is cut off.
   */
  clip?: boolean;
  /**
   * [x, y, width, height] in page coordinates.
   */
  box: [number, number, number, number];
  /**
   * Index into `styles`.
   */
  s: number;
  /**
   * Number of element children recorded.
   */
  n: number;
}

/**
 * A flat DOM tree plus shared style records. nodes[i] must be the node whose i equals that
 * position; p=-1 marks the root and s references styles[s].
 */
export interface DomSnapshot {
  version: 1;
  url: string;
  viewport: { width: number; height: number };
  nodes: DomNode[];
  styles: Array<Record<string, string>>;
  truncated: boolean;
}

/**
 * Computed style properties worth comparing (layout, spacing, typography, colour, effects).
 */
export const STYLE_PROPERTIES = [
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "float",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "row-gap",
  "column-gap",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-items",
  "align-self",
  "align-content",
  "justify-content",
  "justify-items",
  "grid-template-columns",
  "grid-template-rows",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "text-decoration-line",
  "white-space",
  "color",
  "background-color",
  "background-image",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-color",
  "border-top-style",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "box-shadow",
  "opacity",
  "visibility",
  "transform",
  "z-index",
  "overflow-x",
  "overflow-y",
  "object-fit",
] as const;

interface CollectArgs {
  maxNodes: number;
  props: readonly string[];
}

/**
 * Runs in the page. Must be self-contained: it is serialised and evaluated in the browser.
 *
 * Walk the browser DOM and build a compact snapshot of nodes, geometry and selected computed
 * styles. This entire function and its nested helpers are serialized into the page; they cannot
 * access imported Node.js helpers.
 */
function collect({ maxNodes, props }: CollectArgs): Omit<DomSnapshot, "version"> {
  const SKIP = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEMPLATE",
    "META",
    "LINK",
    "HEAD",
    "TITLE",
    "BASE",
  ]);
  const nodes: DomNode[] = [];
  const styles: Array<Record<string, string>> = [];
  const styleIndex = new Map<string, number>();
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  let truncated = false;

  /**
   * Escape a selector fragment with the browser's CSS.escape when available. The fallback keeps
   * the original value for browsers without that API.
   */
  const escape = (value: string) => (window.CSS?.escape ? window.CSS.escape(value) : value);
  /**
   * Read a recognized testing attribute in priority order. The nullish coalescing operator ??
   * tries the next attribute when the preceding lookup returns null.
   */
  const testIdOf = (el: Element) =>
    el.getAttribute("data-testid") ??
    el.getAttribute("data-test") ??
    el.getAttribute("data-cy") ??
    undefined;
  // Generated ids (React useId, UUIDs, long numbers) are not stable between builds.
  /**
   * Reject empty IDs and common generated/hash-like IDs. This heuristic favors identifiers
   * likely to stay the same between the two captures.
   */
  const stableId = (id: string) => id !== "" && !/^:|^[a-f0-9-]{16,}$|\d{4,}/i.test(id);
  // Skip hashed class names from CSS-in-JS; keep utility and BEM classes.
  /**
   * Reject long or generated-looking CSS class names when building readable selectors.
   * Stable-looking classes make matching less sensitive to build-specific hashes.
   */
  const stableClass = (name: string) =>
    name.length < 40 && !/^(css|sc|jsx|emotion|e|tw)-[a-z0-9]{4,}$/i.test(name);

  /**
   * Build one selector segment from the element's tag and up to two stable classes. Array.from
   * converts the DOM class collection into an array so filter/map can be used.
   */
  const segment = (el: Element) => {
    const classes = Array.from(el.classList)
      .filter(stableClass)
      .slice(0, 2)
      .map((name) => `.${escape(name)}`)
      .join("");
    return `${el.tagName.toLowerCase()}${classes}`;
  };

  /**
   * Choose a short selector using a test identifier, stable ID or a bounded ancestor chain.
   * This is an evidence label for matching/reporting, not a guarantee that every arbitrary page
   * selector is unique.
   */
  const selectorFor = (el: Element): string => {
    const testId = testIdOf(el);
    if (testId) return `[data-testid="${testId}"]`;
    if (stableId(el.id)) return `#${escape(el.id)}`;
    const parts: string[] = [segment(el)];
    let current = el.parentElement;
    for (let depth = 0; current && current !== document.body && depth < 2; depth++) {
      const parentTestId = testIdOf(current);
      if (parentTestId) {
        parts.unshift(`[data-testid="${parentTestId}"]`);
        break;
      }
      if (stableId(current.id)) {
        parts.unshift(`#${escape(current.id)}`);
        break;
      }
      parts.unshift(segment(current));
      current = current.parentElement;
    }
    return parts.join(" > ");
  };

  /**
   * Visit one element, record visible evidence and recurse into children and open shadow roots.
   * Store the parent index in the flat node array and stop at maxNodes to bound snapshot size.
   */
  const visit = (el: Element, parentIndex: number) => {
    if (nodes.length >= maxNodes) {
      truncated = true;
      return;
    }
    if (SKIP.has(el.tagName)) return;
    const computed = getComputedStyle(el);
    if (computed.display === "none") return;

    const rect = el.getBoundingClientRect();
    const visible =
      el === document.body ||
      (computed.visibility !== "hidden" &&
        computed.opacity !== "0" &&
        rect.width > 0 &&
        rect.height > 0);

    let index = parentIndex;
    if (visible) {
      const style: Record<string, string> = {};
      for (const prop of props) style[prop] = computed.getPropertyValue(prop);
      const styleKey = JSON.stringify(style);
      let s = styleIndex.get(styleKey);
      if (s === undefined) {
        s = styles.length;
        styles.push(style);
        styleIndex.set(styleKey, s);
      }

      const text = Array.from(el.childNodes)
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
      const testId = testIdOf(el);
      const node: DomNode = {
        i: nodes.length,
        p: parentIndex,
        tag: el.tagName.toLowerCase(),
        sel: selectorFor(el),
        box: [
          Math.round(rect.left + scrollX),
          Math.round(rect.top + scrollY),
          Math.round(rect.width),
          Math.round(rect.height),
        ],
        s,
        n: 0,
      };
      if (testId) node.key = `testid:${testId}`;
      else if (stableId(el.id)) node.key = `id:${el.id}`;
      const className = el.getAttribute("class");
      if (className) node.cls = className.slice(0, 160);
      if (text) node.text = text;
      const name =
        el.getAttribute("aria-label") ?? el.getAttribute("alt") ?? el.getAttribute("title");
      if (name) node.name = name.slice(0, 120);
      const role = el.getAttribute("role");
      if (role) node.role = role;
      const component = el.getAttribute("data-component");
      if (component) node.comp = component;
      if (text) {
        const clipsX =
          /hidden|clip/.test(computed.overflowX) && el.scrollWidth > el.clientWidth + 1;
        const clipsY =
          /hidden|clip/.test(computed.overflowY) && el.scrollHeight > el.clientHeight + 1;
        if (clipsX || clipsY) node.clip = true;
      }
      if (el instanceof HTMLImageElement) {
        node.src = el.currentSrc || el.src;
        if (el.complete && el.naturalWidth === 0) node.broken = true;
      }
      index = nodes.length;
      nodes.push(node);
      if (parentIndex >= 0) nodes[parentIndex]!.n++;
    }

    for (const child of Array.from(el.children)) visit(child, index);
    if (el.shadowRoot) for (const child of Array.from(el.shadowRoot.children)) visit(child, index);
  };

  visit(document.body, -1);
  return {
    url: location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    nodes,
    styles,
    truncated,
  };
}

/**
 * Pass the self-contained collector and allowed style names into page.evaluate. Wrap the
 * browser result with a version so saved snapshots can be read consistently.
 */
export async function captureDomSnapshot(page: Page, maxNodes = 4_000): Promise<DomSnapshot> {
  const result = await page.evaluate(collect, { maxNodes, props: STYLE_PROPERTIES });
  return { version: 1, ...result };
}
