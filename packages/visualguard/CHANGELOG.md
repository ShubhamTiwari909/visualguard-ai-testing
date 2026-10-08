# visualguard

## 0.2.0

### Minor Changes

- Explain differences without AI: every capture now records a compact DOM snapshot; changed regions are mapped to the elements under them and to style, text, position and added/removed-element changes, described in plain language ("Alignment changed: align-items center → flex-start on div.actions"). Layout shifts are detected and reported as one root cause, removed controls and new overlaps are regressions, and tiny changes with no DOM change are treated as rendering noise. Captures are steadier: scrollbars are hidden through CDP and a few re-rasterised pixels no longer count as a moving page.
- 18bcadb: Add the HTML report: every run writes a self-contained `index.html` (works from `file://`, CI artifacts and any static host) with a job list, side-by-side / slider / onion-skin / diff views, region overlays and crops, findings, page health, keyboard shortcuts and a dark theme. `visualguard report` serves the latest run (or `--run <id>`) on localhost with a token-protected action API; `--no-serve` prints the file path.

## 0.1.0

### Minor Changes

- 3bd87f8: Add the capture and diff pipeline: `visualguard test` captures production and staging with Playwright, stabilises pages (animations, fonts, lazy content, network, clock), diffs them with pixelmatch, groups changes into regions, and writes a versioned `manifest.json`. Includes the URL resolver (`--production`, `--staging`, `--route`, `--only`, `--viewport`, `--list`), terminal and JSON reporters, and exit codes.
- Add `visualguard init` (interactive or `--yes`), `visualguard doctor`, zero-config runs (`visualguard <url>` scans one site and saves snapshots; `visualguard <url> <url>` compares two), route discovery from Next.js `app/` and `pages/`, `sitemap.xml` and crawling, and health findings (HTTP errors, broken images, horizontal overflow) that raise a job's status.
