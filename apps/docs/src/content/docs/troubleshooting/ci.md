---
title: "CI, preview and sharding problems"
description: "Diagnose CI-only browser failures, missing secrets, stale commits and incomplete merge evidence."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["action/README.md", "docs/RELIABILITY-CHANGES.md"]
sidebar: {"order": 5}
---

| Symptom | Diagnostic | Fix and verify |
| --- | --- | --- |
| Local pass, CI browser failure | Compare Playwright version/binaries and OS libraries. | Install locked dependencies plus `playwright install --with-deps`; rerun one route. |
| Preview URL not ready or private | Inspect deployment event/actual response from the runner. | Await the intended deployment and configure required app access on the worker; verify screenshot content. |
| PR comment missing | Check token/event permissions and fork origin. | Use the job artifact/summary; enable comments only in an authorized workflow context. |
| Gemini/upload key absent on fork | Fork CI may not receive repository secrets. | Keep a no-secret path; do not run untrusted code in a privileged secret-bearing event. |
| Artifacts disappear on test failure | Upload step runs only on success or points to wrong output. | Preserve the full run/JUnit paths with an always-running upload; keep the test exit failure. |
| New PR commit inherits old evidence | Capture/deployment SHA or published metadata is wrong. | Capture the real current head, publish that SHA and reconcile the policy. |
| Merge rejects shards | Groups, revisions, configs, indices or job sets differ. | Gather a complete consistent execution; diagnostic partial merge must still fail. |

See the [GitHub Action](/ci/github-actions/), [preview revision](/ci/preview-deployments/) and [sharding](/ci/sharding/) guides. Save redacted logs and the full evidence directory when investigating a failure.
