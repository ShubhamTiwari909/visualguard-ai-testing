# Documentation website implementation

Branch: `codex/documentation-website`. Plan: [documentation website plan](DOCUMENTATION-WEBSITE-PLAN.md).

## D01 — Foundation

Added the private `apps/docs` Astro workspace, Starlight article layout/navigation, React setup chooser, Tailwind v4 compatibility layers, applicability metadata, favicon and local development instructions. Root commands target only the docs workspace. The existing CLI/platform runtime and unrelated local edits are preserved.

Resolved stack: Astro 7.4.1, Starlight 0.42.6, React integration 6.0.0, React 19.3.0, Tailwind 4.3.3 and Starlight Tailwind 5.0.0. The React integration is pinned to the compatible stable 6.0.0 release because 7.1.0's React-transform peer ranges conflict with its current Vite plugin dependency. The root lockfile records the tested set. Docs require Node 22.22+; this run uses Node 24.13.0 and pnpm 9.0.0. Existing MongoDB peer warnings in the platform/engine remain outside this change.

Validation: focused docs production build passed. Starlight generated the static homepage, contributor guide, 404 and Pagefind index. This early phase intentionally precedes the article migration; full link/content acceptance follows in D07. No formatting, lint or semantic type checks ran. Astro's build-time content declarations are not a semantic type check.
