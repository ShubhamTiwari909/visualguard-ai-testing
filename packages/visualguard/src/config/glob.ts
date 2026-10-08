/**
 * Minimal glob matching for route paths: `**` matches across "/", `*` within a segment,
 * `?` one character. Matching is against the whole path.
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

export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}
