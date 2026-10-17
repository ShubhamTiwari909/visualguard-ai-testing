# Dashboard audit page and UI refinement

Move the growing administrative audit workflow out of People & integrations, then improve the shared dashboard layout and controls. Keep this follow-up separate from F04 and preserve existing authentication, recovery commands and offline CLI behavior.

1. Add an administrator-only `/operations` page with navigation from the sidebar and Settings. Keep readiness, audit filters and host-recovery guidance together. Replace the accumulating event list with bounded cursor pages and Previous/Next controls; reset pagination when filters or refresh change, retain a usable page on load failure, and permit continuation after an empty filtered page. Serve direct links in development, standalone and generated Vercel deployments. Include focused route/authorization validation and update the operations guide in this feature's commit.
2. Refine shared vertical spacing, heading hierarchy, form alignment, select-arrow inset, focus states and narrow-screen navigation. Reuse the existing Tailwind-enabled stylesheet and dashboard design language without new dependencies. Keep this UI refinement and its documentation in a separate commit.

Validate with focused operations/host tests, the dashboard UI build, and real-browser checks at desktop and mobile widths. Exercise multiple audit pages, filters, refresh, back navigation, errors, member access and Settings forms. Formatting, lint and type checks remain deferred under AGENTS.md; the previous exception was for PR #44 cleanup only.
