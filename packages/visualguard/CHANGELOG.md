# visualguard

## 0.1.0

### Minor Changes

- 3bd87f8: Add the capture and diff pipeline: `visualguard test` captures production and staging with Playwright, stabilises pages (animations, fonts, lazy content, network, clock), diffs them with pixelmatch, groups changes into regions, and writes a versioned `manifest.json`. Includes the URL resolver (`--production`, `--staging`, `--route`, `--only`, `--viewport`, `--list`), terminal and JSON reporters, and exit codes.
- Add `visualguard init` (interactive or `--yes`), `visualguard doctor`, zero-config runs (`visualguard <url>` scans one site and saves snapshots; `visualguard <url> <url>` compares two), route discovery from Next.js `app/` and `pages/`, `sitemap.xml` and crawling, and health findings (HTTP errors, broken images, horizontal overflow) that raise a job's status.
