---
title: "Glossary"
description: "Learn the terms used throughout VisualGuard testing, review and operations."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["docs/PRODUCT-FEATURES.md"]
sidebar: {"order": 4}
---

| Term | Meaning |
| --- | --- |
| Reference / production | Expected application appearance used in a comparison. |
| Candidate / staging | Application appearance being evaluated. These names do not require public deployments. |
| Route | An application path, such as `/checkout`; it can map to different paths between environments. |
| Viewport | Named dimensions and device settings used for a browser capture. |
| Comparison / job | One planned route/viewport comparison, or one interactive checkpoint. |
| Run | One recorded visual execution and its immutable engine evidence. |
| Manifest | Structured record linking settings, job results and artifacts. |
| Local baseline | Saved expected screenshot plus metadata/sidecars on the capture machine. |
| Approved baseline set/version | Dashboard-managed references with approval, lineage and immutable versions. |
| Project | Dashboard grouping with identifiers, history, access and credentials. |
| Public project ID | Human-facing project identifier; renaming can retain historical aliases. |
| Internal project key | Immutable storage identity underlying renamable IDs and names. |
| Revision | Source commit associated with the captured application; it must match the actual tested preview. |
| Upload token | Scoped credential for publishing evidence; not an administrator login. |
| Runner credential | Separate scoped credential that lets a private worker claim requested tests. |
| Execution request | Dashboard request to run a specific saved project profile version. |
| Review | Human decision tied to exact evidence; distinct from an original engine status. |
| Visual policy | Configured rule for whether current evidence/review/baseline requirements are satisfied. |

[Start a comparison](/start/quickstart/) or [read the execution model](/concepts/how-it-works/).
