# VisualGuard: self-hosting, customer setup, and market launch

Prepared: 17 October 2026. Source reviewed: merged `main` at `8cf7c86`.

This document recommends a distribution model, describes the customer onboarding experience to build, and gives a portable deployment reference. The requested primary hosts are now **Vercel and Google Cloud Run**: use the [cloud hosting guide](CLOUD-HOSTING-VERCEL-CLOUD-RUN.md) for the full step-by-step setup and screenshot storage explanation. It does not announce an existing deploy button, container release, hosted service, or completed production validation.

## Contents

- [Recommended hosting and ownership](#1-recommended-model)
- [Minimal setup and release gaps](#2-keep-first-setup-small)
- [Publisher release preparation](#4-publisher-preparation-make-the-installation-artifact)
- [Vercel and Cloud Run setup](#5-customer-setup-a-vercel-or-google-cloud-run)
- [VPS and Docker Compose setup](#6-customer-setup-b-docker-compose-on-a-vps)
- [First project and visual test](#7-first-project-and-first-screenshot-comparison)
- [Optional Google, GitHub and AI](#8-add-integrations-after-first-value)
- [Market introduction](#9-market-introduction)
- [Next implementation work](#10-recommended-next-implementation-work)

## 1. Recommended model

Launch **self-hosted VisualGuard for teams**, with a customer-owned deployment and an optional assisted setup service.

Use **one installation per customer organization**, with multiple people and projects inside it. For example, an agency could host `visualguard.agency.com` and give developers, designers and client reviewers different project permissions. Separate customer organizations receive separate instances, databases and credentials. Do not make every person on the same team maintain a server.

Recommended offering:

| Route | Who it serves | What the customer manages | Priority |
| --- | --- | --- | --- |
| Vercel + managed PostgreSQL | Teams wanting familiar frontend hosting | Their Vercel account, PostgreSQL resource, settings and optional domain | Primary guided route to validate |
| Google Cloud Run + Cloud SQL | Teams using Google Cloud | Their cloud project, IAM, database/backups and secrets | Supported installation route to validate |
| Docker Compose on a VPS | Teams with a server or infrastructure requirements | Server, DNS, Docker, backups and updates | Portable reference deployment |
| Coolify/Dokploy | Customers already running one of these platforms | Existing platform and the VisualGuard stack | Document after the reference stack is tested |
| Hosted VisualGuard service | Customers who want you to operate everything | Account, projects and integrations | Consider later if demand justifies ongoing operations |

The selected providers are **Vercel and Google Cloud Run**. Lead with Vercel plus managed PostgreSQL for a familiar onboarding flow; offer Cloud Run plus Cloud SQL for customers who prefer Google Cloud. Both require an external database for persistent screenshots and platform state. The [cloud hosting guide](CLOUD-HOSTING-VERCEL-CLOUD-RUN.md) covers each provider, required variables, first-run testing, domains, database backups and current deployment limitations.

Keep Docker as a portable alternative. Do not make Kubernetes, separate object storage, Google OAuth, AI keys or a private browser scheduler prerequisites for a first screenshot comparison. A provider-generated HTTPS hostname is sufficient initially; a custom domain can come later.

### Responsibility split

| You provide | Customer provides |
| --- | --- |
| Versioned software, tested deployment bundle, release notes and migration instructions | Their hosting account and infrastructure bill |
| Deployment template, defaults, documentation and support | Administrator identity and access decisions |
| Compatibility tests and supported upgrade paths | Backup destination/retention and restore ownership |
| Optional setup assistance | Their domain, identity provider and repository credentials when used |

The core workflow should run without a vendor-operated account service. Customer-enabled GitHub, Google and AI integrations still make their own outbound connections; avoid claiming that enabling those integrations sends no data outside the installation.

## 2. Keep first setup small

The first customer experience should be:

1. Choose **Vercel** or **Google Cloud Run**, with its database setup; Docker Compose remains an optional portable route.
2. Enter an administrator email; generate or enter a strong initial password.
3. Deploy, open the dashboard and sign in.
4. Create a project, create a project upload token, and run one visual comparison.
5. Add colleagues, custom domain, approved baselines and GitHub checks as needed.

The target is a first useful visual comparison within ten minutes **after infrastructure is available**. This is a proposed usability target, not a measured installation time.

### Default stack

Use one dashboard service and PostgreSQL for the standard team installation. The current implementation stores run metadata, accounts, review decisions, baseline history, policy state and new screenshot/DOM artifact chunks in the database. A separate Redis or object-storage account is not currently required.

Offer SQLite with a durable volume for local evaluation or a small single-instance installation. Do not use an ephemeral filesystem for its database, or advertise shared SQLite as the horizontally scaled option. Cloud Run and Vercel explicitly require external database configuration in the current runtime.

MongoDB remains supported, but invitations, identity linking and baseline mutations need a transaction-capable replica set/sharded deployment. PostgreSQL keeps the initial team setup simpler than asking customers to configure MongoDB topology.

Keep password login as the first path. Customer-owned Google login is optional and needs a Google OAuth client plus an exact redirect URI. Shipping the same Google client secret to every customer installation is not an acceptable shortcut.

### Settings customers should see first

| Setting | Customer action | Product/template action |
| --- | --- | --- |
| Admin email | Enter their email | Use `VISUALGUARD_ADMIN_EMAIL` |
| Initial admin password | Enter or copy generated password | Store `VISUALGUARD_ADMIN_PASSWORD` privately; require at least 12 characters |
| Dashboard URL | Usually accept generated HTTPS URL | Set `VISUALGUARD_PUBLIC_URL` to the canonical origin |
| Database | Accept the provisioned PostgreSQL service | Wire `VISUALGUARD_DATABASE_URL` automatically |
| Access mode | No decision needed for a public deployment | Set `VISUALGUARD_AUTH_MODE=login` and `VISUALGUARD_USER_ADMISSION=invite` |

The domain and database are configuration, but a good template avoids making customers paste connection strings. AI keys, Google credentials and GitHub integration credentials belong in later integration screens/instructions.

## 3. What is available today, and what is still needed

### Available in the reviewed source

- Standalone dashboard and packaged `visualguard dashboard` entry.
- SQLite, PostgreSQL and MongoDB storage adapters.
- Password/Google-OIDC access, project roles, users and invitations.
- Shared review decisions, approved baselines and F07 visual regression policies.
- Project-scoped evidence publishing and baseline downloads.
- `dashboard init --target cloud-run` and `--target vercel` deployment scaffolds.
- Informative GitHub check delivery using configured server credentials, webhook handling and explicit reconciliation commands.

### Release work before a minimal-setup public launch

1. Publish a tested dashboard-enabled release with a distinct version and matching release notes.
2. Provide tested Vercel and Cloud Run deployment bundles; publish an optional runtime container with an immutable digest for portable/container installs.
3. Create and test Vercel and Cloud Run installation bundles/templates, including database wiring, canonical URL and private secrets.
4. Provide a demo project/example and first-run instructions that work with that exact release.
5. Supply a reconciliation scheduling recipe, backup/restore procedure and upgrade instructions.
6. Validate both requested host installations in clean customer accounts before advertising deploy buttons.

On 17 October 2026, npm metadata reported `visualguard@3.1.0`, with `gitHead` `b8f2cb04f33684410f5ad4bc5c493f6bcfa83f4e`. This is different from the reviewed F07 source revision. Do not assume an unpinned `npx visualguard` already contains every feature in this guide. Check the package capabilities and release notes, or use a tested tarball. No GitHub releases were returned during this inspection; the repository's release workflow currently targets npm, and the inspected workflow does not publish a container.

The earlier rollout work also found a missing `/policies` rewrite in the generated Vercel scaffold. That correction is on `codex/production-rollout-validation`; it is not part of the `main` revision reviewed here. The ordinary Node dashboard serves `/policies`. The cloud hosting guide includes the generated-file route correction; verify route coverage, raw webhook forwarding and external database behavior on the actual deployment before launching this route.

## 4. Publisher preparation: make the installation artifact

This section is for the VisualGuard maintainer. Customers should eventually receive the artifact rather than build the development repository.

### Step 1 — Select the release

Use a reviewed commit and a clean checkout. Record its full SHA. Choose a new release version through the repository's existing release process; do not republish changed contents under an existing version.

### Step 2 — Build and package

The normal release build emits JavaScript, dashboard/report assets and declarations. Run it in the release pipeline with Node.js 22.12+ and pnpm 9:

```sh
pnpm install --frozen-lockfile
pnpm build
mkdir -p output/selfhost-release
pnpm --dir packages/visualguard pack --pack-destination "$PWD/output/selfhost-release"
```

These are release-pipeline instructions, not commands executed to write this document. The repository's current local formatting/lint/type deferral still applies unless explicitly changed.

### Step 3 — Validate the package before sharing

Install the tarball into a fresh directory and verify these commands are present:

```sh
npx --no-install visualguard dashboard --help
npx --no-install visualguard dashboard baseline pull --help
npx --no-install visualguard dashboard policy assess --help
npx --no-install visualguard dashboard policy reconcile --help
```

Run the standalone-package smoke test and the supported database/host checks in the release pipeline. Publish the tarball checksum, package version, source commit, supported Node/database versions and tested upgrade path. A passing source test suite alone does not establish that the distributed artifact contains the right assets.

### Step 4 — Prepare the runtime image and template

Build the dashboard-only runtime image from that artifact. The current Cloud Run scaffold supplies a generic Node Dockerfile; its runtime command can also be used on a VPS or a container-capable platform. Browser execution stays in customer development/CI runners, so the dashboard image does not need Playwright browser binaries.

Publish a versioned public image, attach provenance, and document its digest. Use the same tested image in Compose and image-based Cloud Run deployments. Vercel uses the package/function scaffold rather than this container. GitHub documents container publishing and pulling by digest; the specific VisualGuard image name/tag must be created before it is advertised. [Publishing images](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images), [container registry and digest references](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

## 5. Customer setup A: Vercel or Google Cloud Run

Follow the dedicated [Vercel and Google Cloud Run setup guide](CLOUD-HOSTING-VERCEL-CLOUD-RUN.md). It provides:

- Shared package preparation and required environment variables.
- Vercel project import, managed PostgreSQL wiring, production/preview isolation, routes and domain setup.
- Cloud Run source deployment with Cloud SQL, runtime identity, Secret Manager and canonical URL setup.
- A precise explanation of screenshot storage: uploaded image/DOM chunks currently live in the customer's configured database, not an automatically created storage bucket.
- The first visual comparison, optional Google/GitHub integrations, backups and rollout checks.

These are manual installation instructions using existing scaffolds. Provider deploy buttons and fully automated provisioning still require packaging and live validation.

## 6. Customer setup B: Docker Compose on a VPS

This is a **manual reference recipe** using the existing package/scaffold interface. It has been checked against the source, but this document does not claim that this exact Compose stack has been deployed or load-tested. The publisher must test and distribute the final files and pinned images before marketing them as the supported installation bundle.

### Step 1 — Prepare a server and DNS

Use a server the customer controls. Install Docker Engine and Docker Compose following the [official Docker installation instructions](https://docs.docker.com/engine/install/). Verify:

```sh
docker --version
docker compose version
openssl version
```

Point `visualguard.customer.com` to the server. Make ports 80 and 443 reachable; keep SSH restricted to the customer's administration access. Use a domain whose DNS records resolve to this server, including any configured IPv6 record. Caddy can provision and renew HTTPS certificates when the domain and connectivity are correct. [Caddy HTTPS prerequisites](https://caddyserver.com/docs/quick-starts/https).

### Step 2 — Generate a deployment folder from the tested artifact

Obtain the maintainer-provided dashboard-enabled `.tgz` and verify its published checksum. Run the following in a new setup directory on a machine with Node.js 22.12+; replace `/absolute/path/visualguard-RELEASE.tgz` with the real artifact path in both commands:

```sh
mkdir visualguard-installer
cd visualguard-installer
npm init -y
npm install --ignore-scripts /absolute/path/visualguard-RELEASE.tgz
npx --no-install visualguard dashboard init \
  --target cloud-run \
  --out visualguard-selfhost \
  --package /absolute/path/visualguard-RELEASE.tgz
cd visualguard-selfhost
```

The `cloud-run` target here generates the reusable Dockerfile, `package.json` and bundled tarball; this command does not deploy to Google Cloud. Transfer this deployment folder to the customer's server if it was generated elsewhere. Customers using the future prebuilt Compose distribution should be able to skip this installer step.

### Step 3 — Create private settings

Generate two different secrets with `openssl rand -hex 24`, one for the admin and one for PostgreSQL. Put these values in `.env`:

```dotenv
DASHBOARD_DOMAIN=visualguard.customer.com
VISUALGUARD_ADMIN_EMAIL=owner@customer.com
VISUALGUARD_ADMIN_PASSWORD=PASTE_FIRST_GENERATED_SECRET
POSTGRES_PASSWORD=PASTE_SECOND_GENERATED_SECRET
```

```sh
chmod 600 .env
```

Use the generated hexadecimal database password in this recipe so it can safely appear in the database connection URI. Arbitrary passwords containing URI delimiters need proper URI encoding. Keep `.env` outside version control and out of the image; the generated Docker context already excludes environment files.

### Step 4 — Add `compose.yaml`

```yaml
services:
  db:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_DB: visualguard
      POSTGRES_USER: visualguard
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U visualguard -d visualguard"]
      interval: 10s
      timeout: 5s
      retries: 12

  app:
    build: .
    restart: unless-stopped
    environment:
      PORT: "4400"
      VISUALGUARD_AUTH_MODE: login
      VISUALGUARD_USER_ADMISSION: invite
      VISUALGUARD_PUBLIC_URL: https://${DASHBOARD_DOMAIN:?Set DASHBOARD_DOMAIN in .env}
      VISUALGUARD_DATABASE_URL: postgresql://visualguard:${POSTGRES_PASSWORD}@db:5432/visualguard
      VISUALGUARD_ADMIN_EMAIL: ${VISUALGUARD_ADMIN_EMAIL:?Set admin email in .env}
      VISUALGUARD_ADMIN_PASSWORD: ${VISUALGUARD_ADMIN_PASSWORD:?Set admin password in .env}
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "fetch('http://127.0.0.1:4400/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 60s

  proxy:
    image: caddy:2
    restart: unless-stopped
    environment:
      DASHBOARD_DOMAIN: ${DASHBOARD_DOMAIN}
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app

volumes:
  pg_data:
  caddy_data:
  caddy_config:
```

This recipe publishes only the HTTPS proxy, not the database or application port. The app stores new artifacts in PostgreSQL, so it does not need a separate screenshot filesystem volume in this setup. The example major-version image tags are readable starting points; the publisher should lock the distributed production bundle to tested image digests/patch releases.

### Step 5 — Add `Caddyfile`

```caddyfile
{$DASHBOARD_DOMAIN} {
  reverse_proxy app:4400
}
```

Preserve the external `Host` header if a different proxy is used. The dashboard rejects hosts that do not match `VISUALGUARD_PUBLIC_URL`.

### Step 6 — Start and verify

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail 100 app
curl --fail https://visualguard.customer.com/api/health
```

Open `https://visualguard.customer.com` and sign in with the bootstrap admin. Creating the initial admin is a one-time database operation: changing the environment password later does not overwrite an existing account password. Change existing passwords through the account/admin workflows.

Create a project and verify it survives `docker compose restart app`. Restarting an application is not a database restore test.

### Step 7 — Establish backups and upgrades

For this exact PostgreSQL service, take a native logical backup:

```sh
mkdir -p backups
chmod 700 backups
umask 077
docker compose exec -T db pg_dump -U visualguard -d visualguard -Fc \
  > "backups/visualguard-$(date +%Y%m%d-%H%M%S).dump"
```

Copy backups to a separate customer-controlled location, automate their schedule and test restore to a **separate database/environment**. Preserve deployment configuration/secrets separately. Native database backups retain accounts, reviews, approved baselines, policies and artifact chunks; portable evidence export does not retain all of that state.

Before an upgrade, back up the database and configuration, read migration notes, validate the new release against a restored copy, then change the pinned artifact/image and restart. Do not assume an older application can run against a migrated schema. If rollback needs a database restore, perform it using the documented release-specific procedure. Do not delete named volumes as a troubleshooting shortcut.

## 7. First project and first screenshot comparison

These steps apply to both hosting routes.

### Step 1 — Create a project and upload token

Sign in as the customer admin. Create a project such as `storefront`, then create a project upload token under **People & integrations**. Store that token locally/inside the customer's CI secrets. It is separate from the administrator password.

A small team can begin with password accounts. Add colleagues and assign viewer/reviewer/maintainer roles. Copy invitation links privately when used; the product does not need SMTP to copy/share a link, and the dashboard does not currently send invitation emails for the customer.

### Step 2 — Install the matching client in the application's repository

Use the same tested release family as the dashboard. While evaluating a release candidate, install its actual tarball; replace the placeholder path:

```sh
npm install -D /absolute/path/visualguard-RELEASE.tgz playwright
npx playwright install chromium
```

After the maintainer publishes a verified npm release, substitute `visualguard@THE_VERIFIED_VERSION`. Do not use a moving `latest` tag as the reproducibility policy.

### Step 3 — Create `visualguard.config.json`

Replace the two example URLs with the customer's production and staging application URLs:

```json
{
  "baseURL": {
    "production": "https://www.customer.com",
    "staging": "https://staging.customer.com"
  },
  "routes": ["/"],
  "viewports": { "desktop": { "width": 1280, "height": 800 } },
  "ai": { "provider": "none" }
}
```

These are the application-under-test URLs, not the VisualGuard dashboard URL. The browser runs on the developer's machine or CI, so that runner needs network access to both application environments.

### Step 4 — Compare and publish

Save the following in an ignored `.env.local` in the application repository, or configure the same values in the CI secret manager. The test command loads `.env` and `.env.local`; existing process environment values take precedence:

```dotenv
VISUALGUARD_DASHBOARD_URL=https://visualguard.customer.com
VISUALGUARD_UPLOAD_TOKEN=THE_PROJECT_UPLOAD_TOKEN
```

Run:

```sh
npx visualguard test storefront --config visualguard.config.json --no-ai
```

This uses the project-bound test workflow to capture and publish new evidence. A nonzero test exit can indicate a detected regression; inspect the saved report and dashboard result rather than treating every nonzero exit as an installation failure.

Open the run in the dashboard and compare the screenshots. The first useful outcome is a visible visual change with evidence; Google login and GitHub gates are not required to reach it.

### Step 5 — Adopt approved baselines

When the team is ready, review an exact run, promote it into an approved `main` baseline set, pull that set and compare against the pinned snapshot. Keep browser/platform/viewport settings consistent. Follow the [approved baseline walkthrough](APPROVED-BASELINES.md) and [visual policy guide](VISUAL-REGRESSION-POLICY.md) for the exact review/promotion sequence.

A local acceptance file, a dashboard comment and a shared visual approval are different actions; only the recorded exact-evidence decision satisfies a policy requiring that approval.

## 8. Add integrations after first value

### Google sign-in

Each customer creates their own OAuth web client and registers:

```text
https://visualguard.customer.com/api/auth/callback
```

Configure on that customer's dashboard:

```dotenv
VISUALGUARD_OIDC_ISSUER=https://accounts.google.com
VISUALGUARD_OIDC_CLIENT_ID=THE_CUSTOMER_CLIENT_ID
VISUALGUARD_OIDC_CLIENT_SECRET=THE_CUSTOMER_CLIENT_SECRET
```

Keep the existing canonical URL and admission mode. For an existing password admin, use the account's Google-linking flow so it remains the same administrator identity. Updating the domain requires updating the exact callback registration. Do not require customers to configure Google Cloud just to try screenshot comparisons.

### GitHub checks

Use the current F07 server configuration:

```dotenv
VISUALGUARD_GITHUB_TOKEN=SUPPORTED_CHECKS_WRITE_AND_PULL_REQUESTS_READ_CREDENTIAL
VISUALGUARD_GITHUB_REPOSITORIES=storefront=customer-org/customer-repo
VISUALGUARD_GITHUB_WEBHOOK_SECRET=UNIQUE_RANDOM_SECRET
```

Configure a repository webhook at `https://visualguard.customer.com/api/github/webhook`, JSON content, matching secret and Pull requests events. Preserve the original request bytes through the host/proxy. The current GitHub CLI OAuth login is not a replacement for the server-side Check Runs credential; supported token types and permissions are documented by [GitHub](https://docs.github.com/en/rest/checks/runs#create-a-check-run).

Start the project's visual policy in **Informative** mode. Publish evidence for the actual PR head SHA and PR number, reconcile after upload/review/reference changes, and schedule:

```sh
visualguard dashboard policy reconcile --project storefront --all \
  --server https://visualguard.customer.com
```

The scheduled command needs the matching installed release and a project upload token. Configure it through the customer's CI scheduler/hosting scheduler at an agreed interval, with alerts for failure or lack of recent execution. A suggested initial interval is five minutes; validate its actual behavior. GitHub check conclusions are point-in-time observations, so the scheduler/recovery behavior matters before making the check required.

A token expiry/revocation must generate an actionable operational failure. Installation-token refresh is currently the deployment's responsibility; a static copied token is not an automatic refresh integration. A future **Connect GitHub** flow should remove this burden. Never distribute the publisher's GitHub App private key to customer installations; a customer-owned App/manifest flow or a deliberately designed optional broker is separate integration work.

### AI

Leave AI off in the first setup. Customers can later add a supported provider key or configure a local provider according to their policies. Explain what inputs are sent to any enabled external provider. AI does not authorize a release or bypass missing evidence.

## 9. Market introduction

### Positioning

Lead with: **“Visual regression testing your team can run on its own infrastructure.”**

Show the complete workflow: capture a visual change, compare evidence, review it, approve the expected appearance and see an informative PR result. Treat AI as optional assistance. State which deployment and release combinations are actually supported.

### First audience

Start with frontend/product teams already using Playwright and agencies that handle several client projects. They understand screenshot comparisons, already have CI and can evaluate customer-owned infrastructure. Interview pilot users to test this audience hypothesis rather than treating it as established market demand.

### Launch sequence

1. Publish the versioned release and tested Vercel/Cloud Run deployment bundles, with a portable Docker option.
2. Record a short example showing a button color change and baseline review; use synthetic demo data.
3. Put **Try locally**, **Deploy in your account**, **View demo** and **Read setup guide** on the product page.
4. Run assisted pilots with a small set of teams; observe installation instead of assuming the documentation is sufficient.
5. Improve the points where pilots hesitate: initial admin access, first project/token, baseline creation, GitHub credential setup and updates.
6. Announce the self-hosted beta through the repository, provider template directory and relevant developer communities after the install path has been reproduced by someone outside the maintainer's environment.

Success measures should include completion of installation, time to first comparison, the first review by a second team member, repeat capture noise, upgrade success and support time per installation. Define acceptance thresholds with the pilot; avoid public performance or setup-time guarantees until measured.

### Commercial approach

A practical first offer is self-hosted software plus optional paid installation, upgrades and support. Consider a hosted convenience offering later for teams that do not want operations responsibility. The current repository identifies itself as MIT-licensed; commercial packaging, support terms and any future paid feature boundaries require a deliberate decision. No paid entitlement, license-key enforcement, billing or hosted control plane is implemented by this guide.

Customer-owned hosting transfers the infrastructure bill and daily operations to the customer. It does not remove your responsibility to publish clear fixes, supported versions and upgrade instructions. Use assisted setup as a service with a defined handoff, rather than an unspecified promise to administer every customer server indefinitely.

## 10. Recommended next implementation work

| Order | Deliverable | Done when |
| --- | --- | --- |
| 1 | Reproducible dashboard release and public runtime image | A clean customer machine installs the exact artifact and all advertised pages/commands work |
| 2 | Tested Compose bundle and backup/upgrade instructions | A second person deploys, backs up, restores and upgrades an isolated installation |
| 3 | Vercel and Cloud Run setup automation | Fresh customer accounts deploy with correct database, secrets and canonical URL wiring |
| 4 | First-run setup assistance | A new admin reaches the first shared screenshot comparison with only necessary decisions |
| 5 | Easier customer-owned GitHub connection and scheduled reconciliation | Permission scope, token refresh/expiry, duplicate events and missed runs are demonstrated |
| 6 | Supported provider/OS/database matrix and release checklist | Each advertised combination has evidence and an owner for failures |

This is deployment and onboarding work for the existing visual regression product. It does not require restarting the F05 named-journey feature or implementing all remaining organization-growth ideas.

## 11. Document scope and references

This guide was created through source/configuration inspection and current provider documentation. Its local links, JSON, shell syntax and YAML structure were checked. Docker Compose configuration validation could not run because a usable Compose plugin was unavailable in the authoring environment; these checks do not certify a deployment. No cloud resources, customer database, DNS records, OAuth client, GitHub webhook, template or container registry publication was created while writing it. The example Compose configuration is a proposed manual recipe; only a real deployment can validate its DNS, TLS, database, backups and customer environment.

Product references: [Vercel and Cloud Run hosting](CLOUD-HOSTING-VERCEL-CLOUD-RUN.md), [standalone dashboard](STANDALONE-DASHBOARD-WALKTHROUGH.md), [Google sign-in](GOOGLE-SIGN-IN.md), [team invitations](TEAM-INVITATIONS.md), [approved baselines](APPROVED-BASELINES.md), [visual regression policy](VISUAL-REGRESSION-POLICY.md).

Provider references: [Vercel Marketplace storage](https://vercel.com/docs/marketplace-storage), [Vercel environments](https://vercel.com/docs/deployments/environments), [Vercel function limits](https://vercel.com/docs/functions/limitations), [Cloud Run source deployment](https://docs.cloud.google.com/run/docs/deploying-source-code), [Cloud SQL connectivity](https://docs.cloud.google.com/sql/docs/postgres/connect-run), [Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets), [Caddy HTTPS](https://caddyserver.com/docs/quick-starts/https), [GitHub container publishing](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).
