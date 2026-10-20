---
title: "Enable dashboard login"
description: "Switch from trusted local access to login mode and bootstrap an administrator with an exact public origin."
audience: "developer"
docType: "tutorial"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md", "apps/platform/server/auth.ts"]
sidebar: {"order": 8}
---

## Before you start

Use an installed VisualGuard release containing the described features and administrator access to the selected dashboard. Complete [local dashboard setup](/dashboard/local/) first. Work from your application root unless a step names a deployment folder. The shell examples use macOS/Linux POSIX syntax; use WSL for shell/Docker walkthroughs on Windows. Keep existing application/dashboard processes running in separate terminals.

Stop the dashboard and edit its ignored `.env.visualguard`. Keep your chosen database URI, or an explicit empty value for local SQLite, and add:

```dotenv
VISUALGUARD_AUTH_MODE=login
VISUALGUARD_PUBLIC_URL=http://127.0.0.1:4400
VISUALGUARD_ADMIN_EMAIL=owner@example.com
VISUALGUARD_ADMIN_PASSWORD='YOUR_UNIQUE_12_TO_256_CHARACTER_PASSWORD'
```

On a release containing admission controls, set `VISUALGUARD_USER_ADMISSION=invite` for a fresh team installation on SQLite/PostgreSQL/transactional MongoDB. Older `3.1.0` does not gain invitation behavior by setting this variable. Use a fresh separate data directory/database for an isolated trial rather than repurposing live data casually.

Restart with `dashboard --env-file .env.visualguard`, open the exact configured origin and sign in. Bootstrap creates the initial admin once; later environment changes do not overwrite an existing password. Profile/account pages expose the signed-in identity on releases containing those controls.

## Application login is separate

Dashboard accounts control access to saved evidence. Application storage state/cookies let the runner capture private application pages. Configure those on the worker using [application authentication](/guides/application-auth/). An upload token is neither a dashboard password nor an application session.

## Recovery boundary

Changing bootstrap environment credentials does not reset an existing administrator. Use documented account controls or supported host-side recovery; do not edit password rows. Keep a tested recovery administrator before adding Google-only sign-in.


## Verify the setup

Sign in at the exact configured origin. Sign out and verify protected history cannot be browsed without access; confirm login-mode publication requires its scoped token.

## Troubleshooting and next steps

Check the canonical origin, selected project, environment file and installed dashboard/runner versions. [Diagnose dashboard symptoms](/troubleshooting/dashboard/) before creating another workspace. [Continue the dashboard workflow](/dashboard/google-sign-in/). Keep long-running dashboard/runner processes open; stop with Ctrl+C when finished.
