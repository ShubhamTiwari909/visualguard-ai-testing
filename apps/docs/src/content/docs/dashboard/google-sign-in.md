---
title: "Configure and link Google sign-in"
description: "Create the Web OAuth client, configure the exact callback and link an existing account without losing identity."
audience: "operator"
docType: "tutorial"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["docs/LOCAL-SETUP.md", "apps/platform/.env.example"]
sidebar: {"order": 9}
---

## Before you start

Complete [login setup](/dashboard/login/), sign in as the existing administrator and keep tested recovery access. Use a Google Cloud project where you can manage OAuth clients and audience/test users. The instructions below are source-reviewed; a real Google authorization deployment was not exercised during the documentation build. Follow [Google OpenID Connect documentation](https://developers.google.com/identity/openid-connect/openid-connect) if console labels change.

## Configure the provider

1. In the customer's Google Cloud project, configure Google Auth Platform branding/audience and a **Web application** OAuth client. If using a testing audience, add the participating Google accounts.
2. Register the exact redirect URI `http://127.0.0.1:4400/api/auth/callback`. Hosted callbacks use the canonical HTTPS origin plus `/api/auth/callback`.
3. Add these values to the same private environment file, load it again and restart:

```dotenv
VISUALGUARD_OIDC_ISSUER=https://accounts.google.com
VISUALGUARD_OIDC_CLIENT_ID=YOUR_GOOGLE_WEB_CLIENT_ID
VISUALGUARD_OIDC_CLIENT_SECRET='YOUR_GOOGLE_CLIENT_SECRET'
```

4. Sign in with the existing password admin. In **Your sign-in methods**, choose **Link Google account**, provide current-account proof, and complete Google authorization. This preserves the administrator's account ID/history. Email text alone never merges two accounts.
5. Sign out and choose **Sign in with Google**. Verify the same account and project access. Check the profile/account section for email and sign-in methods.
6. Keep a tested recovery password administrator. Linking revokes earlier sessions; sign in again if another browser session stops working.

All three OIDC values are required together. Blank/unset values disable company login; partially configured placeholders can prevent startup. Local-owner mode intentionally ignores OIDC. [Google's OIDC setup](https://developers.google.com/identity/openid-connect/openid-connect).

## Load settings for the installed package

The source guide above says to load/restart the source process. For an installed package, put the same OIDC values alongside the login settings in an ignored `.env.visualguard`, then restart:

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard
```

For a hosted dashboard, set all values in its server-side deployment secret settings and redeploy/restart; a local file does not configure the cloud process. Keep an exact HTTPS callback origin. Do not use frontend/public-prefixed variables for the client secret.

## Verify and troubleshoot

Sign out, use Google and confirm the same account ID/history/project access. Email matching alone never merges accounts. An incorrect callback/origin, partial OIDC settings, missing test user or wrong recipient can stop the flow. Recheck all three provider settings and explicit file loading, then use [account troubleshooting](/troubleshooting/dashboard/).

[Invite people and assign access](/dashboard/people-and-permissions/) only after sign-in/linking works.
