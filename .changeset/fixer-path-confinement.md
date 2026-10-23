---
"visualguard": patch
---

Confine `visualguard fix` edits to the project. Proposed edit paths with `..` segments, absolute or drive paths, or backslashes are rejected, as are paths through a symbolic link, so a model-suggested patch can no longer read or write files outside the project, even when `fix.include` matches.
