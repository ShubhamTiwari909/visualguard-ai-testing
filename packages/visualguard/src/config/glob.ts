/**
 * @file Converts supported glob syntax to regular expressions for route and source filtering.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

/**
 * Minimal glob matching for route paths: `**` matches across "/", `*` within a segment, `?` one
 * character. Matching is against the whole path.
 *
 * Convert the supported glob syntax into an anchored regular expression. Escape ordinary regex
 * metacharacters so route text such as a dot remains literal.
 */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;
    if (char === "*") {
      if (glob[i + 1] === "*") {
        // "/**" at the end also matches the bare prefix: "/blog/**" matches "/blog".
        const atEnd = i + 2 === glob.length;
        if (atEnd && source.endsWith("/")) {
          source = source.slice(0, -1) + "(?:/.*)?";
        } else {
          source += ".*";
        }
        i++;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * Test one complete path against one glob. Compiling the glob here centralizes the package's
 * route-pattern interpretation.
 */
export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}

/**
 * Return true as soon as any supplied glob matches. Array.some short-circuits, so it does not
 * evaluate the remaining patterns after a match.
 */
export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}
