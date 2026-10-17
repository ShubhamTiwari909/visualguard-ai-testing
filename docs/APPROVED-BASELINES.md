# Approved baselines (F04)

An approved baseline is an immutable, reviewed expected appearance for a project. Named sets such as `main` or `release-1` contain the complete check coverage for that target. Each numbered version records source run/revision, landed revision, image/DOM hashes, rendering identities, review decisions, actor, policy version, reason, and parent version. Restoring v1 while v3 is current creates v4 with `restoredFrom: 1`; it never rewrites v1 or v3.

Viewers can read; reviewers make F03 visual decisions; maintainers and workspace administrators promote/restore. Project upload credentials can read approved snapshots and their indexed artifacts **only in their project**, without receiving dashboard browsing or promotion permission. Offline comparisons still work without accounts, upload tokens, MongoDB, PostgreSQL, or a running dashboard. A local dashboard uses SQLite automatically.

## From scratch: local color-change example

Run the commands from the repository root in a POSIX shell. Use Node.js 22.12+ and pnpm 9. Keep the same OS, browser, locale, theme, viewport, and screenshot settings for both captures and later comparisons.

### 1. Install and build the runnable package

```sh
git switch codex/approved-baselines-f04
pnpm install --frozen-lockfile
pnpm --filter visualguard exec playwright install chromium
pnpm --filter visualguard build:dashboard
```

`build:dashboard` builds the package JavaScript, offline report, and dashboard assets without declaration generation. Formatting, lint, and type checks remain deferred under this repository's current instructions.

### 2. Start production and staging fixtures (terminal A)

This small server serves the repository's existing fixtures. Production has a blue button; staging has the intentional color change. It listens only on your computer.

```sh
node --input-type=module <<'NODE'
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
for (const [variant, port] of [['production', 4100], ['staging', 4101]]) {
  createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (!/^\/[a-z0-9-]*(?:\.html)?$/.test(path)) { res.writeHead(404).end(); return; }
    const name = path.slice(1).replace(/\.html$/, '') || 'index';
    try {
      const html = await readFile(`fixtures/site/${variant}/${name}.html`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
    } catch { res.writeHead(404).end(); }
  }).listen(port, '127.0.0.1', () => console.log(`${variant}: http://127.0.0.1:${port}/color-change`));
}
NODE
```

Open both printed addresses to see the difference. Leave this terminal running.

### 3. Start an isolated local dashboard (terminal B)

Set database and hosted dashboard settings to empty values for this example, so local `.env` files cannot redirect it. Use the same absolute data directory in every terminal that imports or pulls locally.

```sh
export VISUALGUARD_DATABASE_URL="" DATABASE_URL="" VISUALGUARD_DASHBOARD_URL=""
export VISUALGUARD_PUBLIC_URL="" VISUALGUARD_UPLOAD_TOKEN=""
export VISUALGUARD_AUTH_MODE=local
export VISUALGUARD_PLATFORM_DATA_DIR="$PWD/.visualguard/approved-demo-platform"
node packages/visualguard/dist/cli.js dashboard --port 4400
```

Open [the local dashboard](http://127.0.0.1:4400). Local mode has a trusted local workspace owner. Hosted deployments continue to require login, membership, and CSRF protection.

### 4. Create the demo configuration and project (terminal C)

Use a new output directory so a previous demo cannot affect these results.

```sh
export VISUALGUARD_DATABASE_URL="" DATABASE_URL="" VISUALGUARD_DASHBOARD_URL=""
export VISUALGUARD_PUBLIC_URL="" VISUALGUARD_UPLOAD_TOKEN=""
export VISUALGUARD_PLATFORM_DATA_DIR="$PWD/.visualguard/approved-demo-platform"
cat > /tmp/visualguard-approved-demo.json <<'JSON'
{
  "baseURL": { "production": "http://127.0.0.1:4100", "staging": "http://127.0.0.1:4101" },
  "routes": ["/color-change"],
  "viewports": { "desktop": { "width": 1280, "height": 800 } },
  "ai": { "provider": "none" },
  "stabilize": { "freezeTime": "2026-01-01T00:00:00Z" }
}
JSON
node packages/visualguard/dist/cli.js dashboard project create baseline-demo --name "Approved baseline demo"
node packages/visualguard/dist/cli.js test --config /tmp/visualguard-approved-demo.json \
  --output-dir .visualguard/approved-demo-runs --no-ai
```

A REVIEW result is expected. A nonzero exit is also possible under a stricter fail-on policy. Keep the evidence. Copy the saved **run directory** printed by the CLI (the directory containing `manifest.json`).

### 5. Import and review the exact evidence

Replace `RUN_DIRECTORY` below. Source revisions must be full Git hashes (40 or 64 hexadecimal characters).

```sh
node packages/visualguard/dist/cli.js dashboard import RUN_DIRECTORY \
  --project baseline-demo --branch main --commit "$(git rev-parse HEAD)" \
  --run-name "Reviewed color change"
```

Open that run in the dashboard. In **Check reviews**, select the color-change check, inspect both screenshots, enter a reason, and choose **Approve visual change**. A local `accept` file or a comment alone does not provide shared visual approval.

### 6. Create version 1

1. Open **Approved baselines** and select **Approved baseline demo**.
2. Keep set `main`, then choose **Open set**.
3. Select the imported complete run. Use **Load an older run by ID** if it is outside the recent candidate list.
4. Verify the source commit and enter the full revision landed on the target branch.
5. Enter a promotion reason and confirm that the exact source change has landed.
6. Choose **Create version 1**.

For this fixture demo, the checked-out commit is the source/landed revision. For real PRs, make the confirmation only after the actual source change lands. F04 records a maintainer's attestation; it does **not** verify GitHub merge state or Git ancestry. Automatic release/repository gates are later features.

Expected: version 1 shows the check, browser/theme/locale/viewport/platform, source run, actor, and policy v1. Promotion fails if evidence is incomplete, source identity is missing, any check lacks current exact-evidence approval, or errors/independent failures remain. Historical runs captured before rendering-identity recording need a fresh capture.

### 7. Pull and compare against the approved snapshot

```sh
node packages/visualguard/dist/cli.js dashboard baseline pull main \
  --project baseline-demo --version 1 --out .visualguard/approved-demo-v1
```

The output directory must be new. Pull installs verified PNG/DOM/health/metadata sidecars plus `approved-baseline.json`. Once pulled, comparison needs no dashboard, database, or upload token. Stop terminal B if you want to prove this.

Create a second configuration:

```sh
cat > /tmp/visualguard-approved-compare.json <<'JSON'
{
  "mode": "baseline",
  "baseURL": { "staging": "http://127.0.0.1:4101" },
  "routes": ["/color-change"],
  "viewports": { "desktop": { "width": 1280, "height": 800 } },
  "ai": { "provider": "none" },
  "stabilize": { "freezeTime": "2026-01-01T00:00:00Z" },
  "baseline": { "dir": ".visualguard/approved-demo-v1", "missing": "error" }
}
JSON
node packages/visualguard/dist/cli.js test --config /tmp/visualguard-approved-compare.json \
  --output-dir .visualguard/approved-demo-comparisons --no-ai
```

Expected: unchanged staging matches the approved staging image. The offline report and `manifest.json` identify `baseline-demo/main v1`, its source run/revision and the selection reason: matching check/rendering identity with verified artifact hashes. When imported, the dashboard run also links to the selected baseline set. To see a difference, override staging with `--staging http://127.0.0.1:4100` to compare the old blue design against the approved changed design.

Playwright fixture sets export into the `playwright/` subdirectory automatically. Set `baseline.dir` to the **parent** downloaded directory, keep the same Playwright project name/browser/context/viewport, and omit `baseURL.production` so the fixture uses stored references. Its result records the same approved-reference provenance.

### 8. Check protections, further promotions, and restore

- **Local immutability:** run the baseline test with `--update-baselines`. It must fail without changing approved files. Use another directory for ordinary local baselines.
- **Integrity:** edit a copied approved PNG, DOM, or health sidecar. The next comparison must fail checksum validation. Pull again into a fresh directory to recover.
- **Rendering isolation:** change the viewport, browser, theme, or locale. The comparison must reject the incompatible reference. A missing check in a pinned snapshot also fails, even with local baseline creation enabled.
- **Review scope:** import a new run and try promoting before reviewing it. Approval from the earlier run cannot be reused. Withdrawing the current decision blocks promotion; disabled/downgraded reviewers cannot authorize it.
- **Current reference:** new candidates for an existing set must compare compatible checks against the current approved image. Evidence based on older pixels is rejected; pull current, rerun, and review the new evidence.
- **Coverage:** adding/removing checks or replacing rendering identities requires a nonempty **Coverage change reason**. There is no automatic trimming to the candidate's subset.
- **Concurrent maintainers:** open the same set in two tabs, promote in one, then submit in the stale tab. The stale operation fails with a conflict and requires refresh/re-evaluation.
- **New version:** import the comparison from step 7 with its source revision, review its check, then promote as v2. Identical pixels still require explicit shared review.
- **Restore:** in history choose **Restore v1**, provide a reason, and confirm. This creates v3, parent v2, restored from v1. The restore form receives keyboard focus; history is paginated in 20-version pages.
- **Retention:** deleting a run used by any baseline version fails. Portable restoration of an unretained run waits for its deletion cleanup to finish; an interrupted deletion stays closed for storage recovery. Explicitly deleting the whole project removes its evidence and baseline history. Keep native database backups for recovery.

## Hosted use and environment variables

No new required environment variables are introduced. Existing database/authentication configuration applies:

| Use               | Settings                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Local demo        | `VISUALGUARD_PLATFORM_DATA_DIR` (optional; defaults to `.visualguard/platform`)                                            |
| PostgreSQL        | Existing `VISUALGUARD_DATABASE_URL=postgresql://…`                                                                         |
| MongoDB           | Existing `VISUALGUARD_DATABASE_URL=mongodb://…`; mutations require a transaction-capable replica set                       |
| Hosted download   | `VISUALGUARD_DASHBOARD_URL=https://…` or `--server`; project-scoped `VISUALGUARD_UPLOAD_TOKEN`                             |
| Local direct pull | Same SQLite file/data directory or database URL as the dashboard; host database access grants direct administrative access |

```sh
# Set the token in your environment/secret manager; do not put it in a command argument.
visualguard dashboard baseline pull main --project YOUR_PROJECT \
  --server https://YOUR_DASHBOARD --version 2 --out approved-main-v2
```

Remote origins require HTTPS; HTTP is allowed only on loopback. Downloads pin the resolved version before reading artifacts, use bounded chunks, verify sizes/hashes, and stage into a new directory before installation. Upload credentials remain unable to browse unrelated runs, administer users, promote, or restore. Configure a normal signed-in reviewer/maintainer for those actions.

Limits: 100 sets per project; 1–1000 checks and 2 MiB metadata per snapshot; 512 MiB total downloaded artifacts. Split large suites into separately named sets. Promotion policy v1 rejects capture errors, instability/truncation, console/request/image/check failures, serious/critical accessibility violations, and independent regression findings. Approval of pixels never suppresses those failures.

Portable `dashboard export`/`restore` remain evidence-only: they do not transfer users, reviews, or the approved registry. Use a native database backup to preserve authorization, reviews, registry history, retention guards, and artifact objects together. Keep SQLite stopped/checkpointed during file copying; use normal PostgreSQL/MongoDB backup procedures for those deployments.

## HTTP surface

All paths are under `/api/projects/PROJECT/baselines` and accept project aliases.

- `GET /`: list named sets/current versions.
- `GET /SET[?version=N]`: immutable snapshot (current if omitted).
- `GET /SET/history[?after=CURSOR]`: bounded summaries with an exclusive next cursor.
- `POST /SET/promote`: `{expectedVersion, runId, evidenceDigest, sourceRevision, targetRevision, landed:true, reason, coverageChangeReason?}`. Use `expectedVersion:0` to initialize.
- `POST /SET/restore`: `{expectedVersion, version, reason}`.
- `GET /SET/artifacts/HASH?version=N&chunk=INDEX`: only artifacts indexed by that approved version; chunks are 1 MiB.

Mutations require a browser session/CSRF token in hosted mode. A conflict (409) means refresh and re-evaluate; no partial version/head/audit/retention write is committed. Snapshot history remains immutable even when subsequent reviews or account permissions change.
