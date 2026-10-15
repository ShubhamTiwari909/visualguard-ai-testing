# Organization growth implementation

The current user-directed work follows `docs/ORGANIZATION-GROWTH-PLAN.md` on `codex/organization-growth`.

- Implement only the requested feature at each step, and keep each requested feature in its own commit.
- Keep each feature's implementation, documentation, and focused tests together in its own commit. The planning document has a separate preceding commit.
- Per the user's explicit instruction, do not run formatting, lint, or type-check commands during this sequence. These checks are deferred until after F36, unless the user changes that instruction.
- Focused behavior tests and feature-specific builds may be used to validate an implementation. Do not describe deferred checks as passed.
- Preserve the CLI/offline workflow while adding the platform as a separate app. Shared identity, review, baselines, runners, and release policies follow their own feature scope.
