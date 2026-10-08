---
"visualguard": minor
---

Add the HTML report: every run writes a self-contained `index.html` (works from `file://`, CI artifacts and any static host) with a job list, side-by-side / slider / onion-skin / diff views, region overlays and crops, findings, page health, keyboard shortcuts and a dark theme. `visualguard report` serves the latest run (or `--run <id>`) on localhost with a token-protected action API; `--no-serve` prints the file path.
