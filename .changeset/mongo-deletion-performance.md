---
"visualguard": patch
---

Reduce MongoDB run deletion latency by batching artifact cleanup queue writes, bounding concurrent cleanup work and indexing artifact references/chunks. Preserve shared evidence, active upload checks, generation-safe deletion and durable retry tasks; await all cleanup workers before returning.
