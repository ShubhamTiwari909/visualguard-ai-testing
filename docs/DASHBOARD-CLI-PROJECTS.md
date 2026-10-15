# Create a dashboard project from the CLI

```sh
npx visualguard dashboard project create storefront --name "Storefront Web"
```

`dashboard project add` is an alias for the same command. `storefront` is the stable project ID; `--name` is the optional display name and defaults to the ID.

The command creates an empty project only when that ID is missing. It prints either `Created: Storefront Web (storefront)` or `Already exists: Storefront Web (storefront)`. Repeating the command does not rename the existing project, change its creation date, reset permissions, or remove runs. Different IDs may have the same display name, so use IDs for reliable automation. Deleted/reserved IDs still return a conflict.

## Run from this VisualGuard checkout

Existing installed packages and compiled CLI files must be rebuilt before they contain this command. No build or checks were run for this change. When you are ready to build manually:

```sh
pnpm --filter visualguard build:dashboard
```

Then, from the repository root:

```sh
node packages/visualguard/dist/cli.js dashboard project create storefront \
  --name "Storefront Web"
```

With no dashboard URL configured, this writes to the same local database as `visualguard dashboard`. A server does not need to be running. Refresh an open dashboard to see the project. Local SQLite, PostgreSQL, and MongoDB use the existing database/data-directory settings.

For the already-running local server instead:

```sh
node packages/visualguard/dist/cli.js dashboard project create storefront \
  --name "Storefront Web" \
  --server http://127.0.0.1:4400
```

Restart `pnpm platform:dev` after updating the backend so the running server uses the new idempotent creation API. The default loopback dashboard needs no login or upload token for project creation.

You can now run the visual comparison and bind it to the new project:

```sh
node packages/visualguard/dist/cli.js test storefront \
  --dashboard http://127.0.0.1:4400 \
  --production http://localhost:3101 \
  --staging http://localhost:3100 \
  --route / \
  --no-ai
```

Both application servers must be running for that comparison. Project creation itself does not launch browsers or require the applications to be reachable. See [test project binding](DASHBOARD-TEST-BINDING.md) for name lookup, metadata labels, and publishing saved evidence.

## Choose another local database or folder

Global dashboard options go before `project create`:

```sh
npx visualguard dashboard --data-dir ./team-data project create storefront \
  --name "Storefront Web"

npx visualguard dashboard --env-file .env.visualguard project create storefront \
  --name "Storefront Web"
```

The command also loads the calling directory's `.env` and `.env.local`, without overriding environment variables or settings already loaded by `--env-file`. `VISUALGUARD_DATABASE_URL` selects PostgreSQL/MongoDB; `DATABASE_URL` remains the dashboard compatibility fallback. Prefer a dedicated dashboard database rather than an unrelated application database.

`--server` overrides `VISUALGUARD_DASHBOARD_URL`. If that variable is set, creation uses that running dashboard; database/data-directory options apply only when no server destination is selected. Unset the dashboard URL variable to work directly against local storage.

## A dashboard with login enabled

Project creation remains an administrator action. A project upload token can publish runs but cannot create a project.

For a hosted server or a loopback server in login mode, put an existing password administrator's **current** credentials in your environment or an ignored environment file:

```dotenv
VISUALGUARD_DASHBOARD_URL=https://dashboard.example.com
VISUALGUARD_ADMIN_EMAIL=owner@example.com
VISUALGUARD_ADMIN_PASSWORD=YOUR_CURRENT_ADMIN_PASSWORD
```

Then run:

```sh
npx visualguard dashboard --env-file .env.dashboard-admin project create storefront \
  --name "Storefront Web"
```

Do not pass passwords as command arguments or commit that file. Use the current account password if it was rotated after bootstrap. The CLI signs in, checks administrator access, submits the normal CSRF-protected project request, and attempts logout in `finally`. It does not store or print the session cookie. A failed logout leaves a server session to expire under the existing session policy.

Non-loopback servers require HTTPS, and redirects are not followed with administration credentials. For an organization using only OIDC without a password administrator, create the project through the existing browser login instead; this command does not introduce an OIDC login flow or an administrator API token.

The CLI and server must both support the new command/API response. New API project creation returns 201 with `created: true`, or 200 with `created: false` for an existing ID. It preserves the existing project response fields for the dashboard UI and records a creation audit event only when a project was actually added.

## Optional package API

```js
import { createDashboardProject } from "visualguard/dashboard";

const { project, created } = await createDashboardProject({
  id: "storefront",
  name: "Storefront Web",
});
console.log(created ? "Created" : "Already exists", project.id);
```

Pass `server` to use a running dashboard, or `env` to supply explicit database/administrator settings. This API uses the same validation, permissions, and idempotency as the command; callers load their desired environment files themselves.

## Manual checks

No formatting, lint, type checks, builds, browser checks, or tests were run for this feature. Regression cases were prepared for later execution.

1. Create a new local project, refresh the dashboard, and check its ID, name, and zero-run count.
2. Repeat the same command. Expect `Already exists`, with one project remaining.
3. Repeat with a different `--name`. The original name must remain unchanged.
4. Bind a visual test to the ID and confirm the run appears under that project.
5. Repeat creation after a run exists. Confirm the count, evidence, and permissions remain.
6. Use `--server` with the running local dashboard; verify the same idempotency behavior.
7. Try login-enabled creation as an administrator, a non-administrator, and with only an upload token. Only the administrator should succeed.
8. Try an invalid ID, a blank name, and a deleted/reserved ID. Each should fail without adding a project.
9. Point the database settings at disposable PostgreSQL and MongoDB databases and repeat.

See the [standalone walkthrough](STANDALONE-DASHBOARD-WALKTHROUGH.md) for package installation, storage, and hosting.
