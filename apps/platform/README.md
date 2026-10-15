# VisualGuard platform — F01

A separate central evidence dashboard for VisualGuard projects. It indexes saved runs, preserves their original manifests and referenced screenshots/DOM evidence, and reuses the existing comparison viewer. The CLI and portable offline reports work independently.

## Start locally

From the repository root, with Node 22.12+:

```sh
pnpm install
pnpm platform:dev
```

Open [the dashboard](http://127.0.0.1:4400). SQLite metadata and private content-addressed objects live under the ignored repository `.visualguard/platform/` directory. Node 22 emits an experimental-feature notice for its built-in SQLite driver. PostgreSQL is also supported.

The server binds exclusively to `127.0.0.1`. F01 is a local workspace implementation: organizational identity/project authorization belongs to F02, and collaborative review belongs to F03. Do not expose this version through a public reverse proxy or treat its local action token as user authentication.

## Import real runs

Create a project with **New project**, or let the importer create one. Import executes on the same machine/storage as the platform; remote CI upload sessions belong to F06.

```sh
pnpm platform:import \
  --project storefront \
  --name Storefront \
  --run /absolute/path/to/.visualguard/runs/0001_example \
  --environment staging \
  --branch feature/header \
  --commit abc123 \
  --pr 42 \
  --deployment preview-42
```

`--run` points to a directory containing `manifest.json` and its referenced evidence. Use absolute paths because workspace scripts execute inside `apps/platform`. When omitted, commit metadata comes from the manifest's source revision. Environment defaults to `staging`; branch, PR, and deployment metadata are optional. The importer does not guess them from another checkout.

Import an existing history directory with:

```sh
pnpm platform:import \
  --project storefront \
  --runs-dir /absolute/path/to/.visualguard/runs \
  --environment staging
```

Bulk import processes each child directory independently, reports failures, and exits nonzero if any fail. Only directories are considered, so `runs/index.json` is ignored. Additional metadata flags apply to **all** imported runs; omit overrides when importing mixed history.

Imports copy evidence into independent storage. Original CLI retention does not break imported history. Identical evidence/metadata is deduplicated. Reusing project + engine-run ID with changed evidence or metadata is rejected; original history remains immutable. Engine-run IDs can repeat across projects.

## Included functionality

- Persistent projects with run counts; cross-project searchable history; pagination and URL-persisted filters.
- Filters for project, result, environment, branch, exact revision, PR, deployment, and UTC dates. The through date includes that entire UTC day.
- Stable run-detail/report links, per-check results, screenshot thumbnails, DOM JSON, provenance, and evidence digest.
- Existing side-by-side, slider, onion-skin, diff, region, DOM/style, health, and AI explanation views, with imported artifact URLs.
- Versioned platform envelope around engine manifest schema v1. Additive historical fields are retained; unknown schema versions are rejected.
- Atomic database publication, checksummed PNG/JSON objects, idempotent imports, normalized project/run/job indexes.
- Explicit incomplete status for engine-incomplete runs, individual shards, empty runs, missing reference/candidate captures, or mismatched expected scope.
- Summary recomputed from actual check statuses. The original engine summary stays intact in saved evidence.
- Local action-token protection, cross-origin API rejection, and loopback Host validation.

F01 does not add organization accounts, review decisions, baseline promotion, source editing, remote uploads, managed runners, or release gates. The imported viewer is read-only. Existing local CLI report actions retain their original workflow. A passing run describes evidence and is not release approval.

## Evidence guarantees and limits

All required referenced artifacts must exist and be readable before publication. Missing, oversized, or unsupported files fail import rather than creating partially uploaded passing evidence. Capture-error runs remain visible as errors when captures are absent. Structurally valid partial coverage is retained with explicit reasons.

Only referenced PNG/JSON files are copied. Imported HTML/JavaScript, environment files, cookies, arbitrary side files, and repair source patches are not served or executed. Sensitive content can still exist in screenshots, DOM, URLs, and manifests: apply capture/redaction policies before import. JSON is served as JSON with `nosniff`.

Limits: 16 MiB manifest; 32 MiB per referenced artifact; 512 MiB total referenced artifacts/run; 25,000 jobs; 100 history rows/page. Paths must be relative and remain within the run directory after symlink resolution. Objects are SHA-256 checked on read.

Object writes precede database publication. Failed/conflicting imports may leave unreferenced objects; garbage collection and organization retention are deferred. Do not delete objects by age without checking retained-run references.

The default object backend is a private filesystem implementation behind `ArtifactStore`, not hosted S3. Back up both the database and object directory. The interface permits a future remote storage adapter without changing engine manifests or the dashboard contract.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `VISUALGUARD_PLATFORM_PORT` | `4400` | Loopback HTTP port |
| `VISUALGUARD_PLATFORM_DATA_DIR` | Repository `.visualguard/platform` | SQLite and private object directory |
| `DATABASE_URL` | Unset | PostgreSQL connection string; otherwise use SQLite |

Set the same environment for server and importer. The app does not load `.env` automatically. Use absolute data-directory paths; relative paths resolve from the platform package directory.

### PostgreSQL

Create a dedicated database through your usual setup, then use its actual user/host and approved connection/TLS settings:

```sh
DATABASE_URL=postgresql://localhost/visualguard pnpm platform:dev
DATABASE_URL=postgresql://localhost/visualguard pnpm platform:import \
  --project storefront --run /absolute/path/to/run
```

The platform initializes `vg_projects`, `vg_runs`, `vg_jobs`, and their indexes if absent. It never drops existing tables. SQLite and PostgreSQL use the same envelope/schema contract. Use a persistent object directory alongside the database.

### Compiled UI

```sh
pnpm --filter @visualguard/platform build
pnpm --filter @visualguard/platform start
```

This builds UI assets; the Node service executes TypeScript through `jiti`. Development mode transforms UI modules on demand. Formatting, linting, and type checking are separate commands, deferred until after F36 under the current implementation sequence.

## HTTP API

| Endpoint | Result |
| --- | --- |
| `GET /api/projects` | Projects and run counts |
| `GET /api/runs` | Filtered paginated run summaries |
| `GET /api/runs/:id` | Envelope, original manifest, artifact descriptors |
| `GET /api/runs/:id/artifacts/*` | Only evidence indexed in this run; no public raw object-key endpoint |

Filters: `project`, `q`, `status`, `environment`, `branch`, `commit`, `pr`, `deployment`, `from`, `to`, `limit`, `offset`. Ordering is descending start time and platform ID. Count and page come from one database statement. Search matches literal substrings; wildcard characters remain literal.

Local project creation uses `POST /api/projects`, JSON `{ "id": "storefront", "name": "Storefront" }`, and `x-visualguard-platform-token` from `GET /api/session`. This is a local mutation control, not an organization authentication API.

## Focused verification

```sh
pnpm --filter @visualguard/platform test

# Optional: point only to a disposable PostgreSQL validation database.
VISUALGUARD_TEST_DATABASE_URL=postgresql://localhost/visualguard_test \
  pnpm --filter @visualguard/platform test
```

Tests cover 20 representative imports, restart persistence, duplicate/concurrent imports, conflicts, atomic publication, filters, incomplete scope, invalid versions, unsafe paths, object corruption, APIs, and viewer URL adaptation. PostgreSQL tests run only when explicitly given a test URL and remove only their own records.

## Module map

| Module | Responsibility |
| --- | --- |
| `shared/contracts.ts` | Project/run/artifact/filter contracts |
| `server/database.ts` | SQLite/PostgreSQL schema and transactions |
| `server/repository.ts` | Immutable publication and indexed history |
| `server/artifacts.ts` | Private content-addressed objects |
| `server/validation.ts` | Manifest/metadata/path validation |
| `server/ingest.ts` | Required artifacts, bounded copying, completeness, digest |
| `server/import-cli.ts` | Single/bulk import and metadata flags |
| `server/http.ts` | Local read API and project actions |
| `server/main.ts` | HTTP server and development/compiled UI serving |
| `client/main.tsx` | Dashboard, filters, detail, reused report viewer |
| `client/api.ts` | API access and copied-manifest path adaptation |

See [the growth plan](../../docs/ORGANIZATION-GROWTH-PLAN.md) for remaining features and dependencies.
