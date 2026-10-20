---
title: "Choose a comparison mode"
description: "Compare environments, saved references, one-site scans or interactive Playwright states."
audience: "developer"
docType: "explanation"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["docs/PRODUCT-FEATURES.md"]
sidebar: {"order": 2}
---

### Compare two running versions

Compare production/reference with staging/candidate. Either side can be a deployed site or a local server. You can map different paths, such as an old `/pricing` page and a new `/plans` page.

**Example:** check that a checkout redesign changes the intended button color without hiding the payment controls.

### Compare against local saved baselines

Capture a known expected appearance, then compare future runs with those stored screenshots. Reference files include rendering information and associated evidence, helping reject incompatible or missing snapshots instead of silently using an unrelated image.

**Example:** a component page has no public production environment, so the team keeps reviewed reference images in its repository or artifact storage.

Creating/updating a local reference is an explicit action. This is separate from the shared approved-baseline registry in section 15.

### Start with one URL or two URLs

The zero-configuration URL mode discovers pages and starts a comparison without a project config. A single-site scan creates an initial reference and compares/updates it on subsequent scans; two URLs compare the two sites.

This is useful for exploration. Use explicit routes and references when you need tightly controlled coverage and approval history.

### Check an interactive Playwright state

The `visualguard/playwright` fixture can check a page after the test logs in, opens a dialog or performs another interaction. A reference setup callback brings the reference page to the matching state, or the fixture can use stored snapshots.

**Example:** compare an expanded shopping cart after adding an item, rather than only the initial `/shop` page. This uses the existing Playwright test; it is not a separate named-journey catalog.

## Choose the first reference deliberately

A one-URL scan saves snapshots on its first run and compares/updates them later. Explicit baseline mode requires an intentional update by default. Do not use the scan lifecycle as an approval policy. [Create reviewed local baselines](/guides/local-baselines/) when you need controlled reference updates.
