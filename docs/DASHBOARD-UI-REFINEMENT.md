# Dashboard UI refinement

Audit & recovery now has its own administrator-only `/operations` page. Use the sidebar, mobile workspace navigation, or the link in People & integrations. Previous/Next replace the audit list with a bounded page; expandable details and recovery instructions keep the default view compact. See [Workspace operations](WORKSPACE-OPERATIONS.md) for behavior and recovery testing.

The dashboard uses its existing Tailwind-enabled stylesheet and shared component classes, with no new dependencies. The refinement adds consistent paragraph/section spacing, heading hierarchy, aligned form controls and actions, and responsive settings/review layouts. Selects reserve 42 px for their arrow and inset it 14 px from the right edge; high-contrast mode restores the native select affordance. Checkboxes retain their compact size, keyboard focus remains visible, and long actions wrap on narrow screens. Changes are scoped to the dashboard so the embedded comparison viewer keeps its own styling.

The mobile header now contains the brand and account actions together, followed by visible workspace navigation. Active links indicate the current page. People & integrations and Audit & recovery have accurate browser titles and breadcrumbs; the desktop sidebar can scroll when its project list grows.

## Verification

On 17 October 2026:

- All 24 focused operations, authorization, development-route and standalone-host tests passed. Direct `/operations` GET/HEAD and generated Vercel rewrites are covered.
- The dashboard production UI build passed.
- Browser checks used a disposable SQLite workspace with 225 seeded audit events. Next/Previous replace rather than append, at most 50 events render, sparse filtered pages can continue, failed requests preserve the displayed page, retry succeeds, and filters/clear/refresh restart pagination.
- A real password member could not see audit navigation or trigger audit/readiness requests. Both protected APIs returned 403. Existing `/settings#operations` links reached the new page.
- Run history, review inbox, People & integrations and Audit & recovery were checked at 320, 375, 768 and 1440 px without page-wide horizontal overflow. Wide data tables retain their own scroll area.
- The administrator confirmation form, checkbox sizing, select inset, page-change focus, keyboard focus outline and high-contrast select fallback were checked in the browser.
- An imported disposable comparison exercised the run detail review composer: a comment was posted successfully and appeared in the review inbox. Desktop/mobile review forms were inspected visually.

Formatting, lint and type checks remain deferred under AGENTS.md for this follow-up. The earlier exception covered PR #44 review cleanup only. No Google configuration or new application environment variables are required.
