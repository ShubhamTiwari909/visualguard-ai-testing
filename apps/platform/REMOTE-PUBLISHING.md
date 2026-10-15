# F06: remote evidence publishing

Run the existing VisualGuard engine on a developer machine or in CI; publish its saved run to a shared dashboard. Browsers, application credentials, and source editing remain on the execution machine. This is F06's upload scope, not a managed browser scheduler.

Create a project in the dashboard. Under **People & integrations**, choose the project and create a named upload token. Store it in the CI system's secret store as `VISUALGUARD_UPLOAD_TOKEN`; it is shown once, scoped to that project, and revocable.

```sh
pnpm platform:publish \
  --server https://dashboard.example.com \
  --project storefront \
  --run /absolute/path/to/.visualguard/runs/run-id \
  --environment staging \
  --branch feature/header \
  --pr 42
```

For a local dashboard without login, `--server http://127.0.0.1:4400` uses its local action token automatically. A local dashboard running in login mode requires an upload credential too. Remote uploads require HTTPS.

The publisher registers small file descriptors and transfers 1 MiB binary chunks. Each file is assembled and checked against its expected SHA-256 and length. The server publishes the run only after its valid manifest and all referenced artifacts are complete. Missing captures/shards remain visibly incomplete according to the shared engine contract.

Repeating the exact command resumes the same credential-bound upload for up to 24 hours. Completed files are skipped. Transient network/server errors use bounded retries; rejected credentials and invalid evidence do not. An interrupted upload does not create a green dashboard entry. Changes to screenshot bytes affect upload identity even if manifest paths stay the same; conflicting reuse of an engine-run ID preserves original evidence and fails.

Progress, sessions, revocation, and temporary chunks are database-backed, so requests may reach different instances. Successful file completion removes temporary chunk records. Abandoned sessions expire logically after 24 hours; periodic expired-state cleanup is part of hosting operations. Unreferenced final objects require reference-aware cleanup rather than blind age deletion.

Upload credentials cannot browse run history or artifacts, create projects, grant access, or approve changes. Removing a token or disabling/removing its owner's applicable access invalidates subsequent requests, including attempts to resume a session.

The dashboard also transfers large manifests and artifacts in 1 MiB responses, validates their checksum in the browser, and adapts large images to local blob URLs. This avoids relying on Vercel's request/response payload limit for a single large screenshot. Direct API clients can request `?chunk=0`, `?chunk=1`, etc.; large manifest metadata includes a `manifestTransfer` descriptor.

Run limits: 4096 referenced artifacts, 32 MiB per artifact, 16 MiB raw manifest, and 512 MiB total referenced artifacts. MongoDB additionally limits the complete metadata envelope to 12 MiB. Split exceptionally large executions into appropriately scoped complete runs.

The final standalone walkthrough covers installed-package commands, hosting, database restoration, and CI examples.
