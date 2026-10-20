---
title: "Dashboard overview"
description: "Add persistent history, project access and shared visual review to local testing."
audience: "developer"
docType: "explanation"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["docs/PRODUCT-FEATURES.md"]
sidebar: {"order": 1}
---

The dashboard groups evidence by project so developers, reviewers and maintainers can work from the same stored run.

Features include:

- Run history and comparison views with project/status/environment/branch/revision/PR/deployment/date filters.
- Project creation from the UI or authorized CLI, with stable identifiers.
- Project and run names, editable by permitted maintainers; earlier public project IDs remain aliases after renaming.
- Imports of local runs and remote project-scoped publishing.
- Role-controlled access, visual review and reviewer inbox.
- Approved baseline sets, policies and operator pages in compatible feature releases.
- Confirmed project/run deletion with reference-aware evidence cleanup.

Publishing transfers evidence in checksummed chunks and can resume the same credential-bound upload after interruption. Original local run files remain available. A run is committed only after its required uploaded evidence validates; importing a genuinely incomplete capture does not make its coverage complete.

MongoDB deletion batches artifact cleanup queue writes and cleans independent artifacts with bounded concurrency. Shared screenshots, active uploads and interrupted cleanup remain protected; failed cleanup stays queued for retry. Network latency and the amount of evidence still affect deletion time.

Select a project in the dashboard sidebar to find **Delete project** in that project's run-history section. The action is available to workspace administrators and project maintainers and requires explicit project-ID and run-count confirmation. People & integrations continues to manage access and upload tokens.

Project deletion removes its runs/access/upload credentials while preserving unrelated workspace accounts and evidence still referenced elsewhere. Deleted project IDs remain reserved. Deletion does not erase original runner copies or independent backups, and hosting does not enable automatic time-based retention.

Each project can save independent production/staging base URLs, explicit routes, viewports and an optional AI provider/model. Project readers can inspect these saved settings in the project section. Configuration edits require maintainer/admin access and reject stale versions. The saved configuration is data only: credentials, cookies, hooks and executable config files stay on the runner. Existing offline CLI config files remain independent.

Project maintainers/admins can choose **Run test** in the selected project. A connected private runner claims the saved configuration, captures the comparison and uploads the evidence. The dashboard shows the live capture/comparison/upload stage, completed route/viewport counts and a comparison progress bar, then links to the resulting run. Progress is retained across refreshes and failures; upload/finalization stay indeterminate rather than displaying a made-up overall percentage. After upload, the runner retries completion with the same run ID if acknowledgement fails; if delivery remains unavailable, its terminal output preserves the result link. The worker has a dedicated expiring project credential; upload-only tokens cannot claim work. Each project permits one active execution, with lease/timeout handling for disconnects. This on-demand workflow works with locally run and hosted dashboards; it requires a connected foreground runner rather than browser execution inside a web request. See [setup and commands](NPM-PACKAGE-SETUP.md#run-a-test-from-the-dashboard).

## Capture stays on your worker

A dashboard can queue a test from a saved project profile. A connected private runner executes the browser and uploads evidence. Hosting a dashboard alone does not provide a managed browser or schedule. [Start locally](/dashboard/local/), then [connect a runner](/dashboard/private-runners/) or [publish CLI evidence](/dashboard/publishing/).
