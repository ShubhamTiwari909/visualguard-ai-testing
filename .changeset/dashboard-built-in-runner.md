---
"visualguard": minor
---

Let the dashboard run **Run test** itself with just the signed-in user's authorization: no runner credential is needed on a local or container-hosted dashboard. A connected private runner still takes priority. Cloud Run scaffolds now install Chromium; serverless hosts such as Vercel keep requiring a private runner unless `VISUALGUARD_BUILT_IN_RUNNER=on` is set. Add `VISUALGUARD_BUILT_IN_RUNNER` and `VISUALGUARD_BUILT_IN_RUNNER_CONCURRENCY`.

Reserve built-in runner capacity before persisting requests so simultaneous projects respect the process concurrency limit. Release slots after failed saves and completed captures.
