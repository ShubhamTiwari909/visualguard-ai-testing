---
"visualguard": major
---

Strengthen visual acceptance, fix verification, baseline provenance, AI request caching/budgets, Playwright fixture integration and shard completeness.

Migration: missing baselines now fail by default; explicitly update snapshots or opt into `baseline.missing: "create"`. Legacy CLI baselines require regeneration or an explicit `baseline.legacy: "allow"`; fixture baseline IDs include project/rendering identity. Automatic fixing requires `fix.verify.server`. Shards outside GitHub Actions require a shared execution group, and legacy/incomplete/incompatible shard inputs are rejected. See the reliability migration guide for details.
