# VisualGuard dashboard application

See the [product feature guide](../../docs/PRODUCT-FEATURES.md) for a readable overview. Use the two maintained setup guides:

- [Local source setup](../../docs/LOCAL-SETUP.md): repository installation, fixture demo, dashboard, team features and operator recovery.
- [npm package setup](../../docs/NPM-PACKAGE-SETUP.md): consumer installation, offline tests, SQLite/PostgreSQL/MongoDB, publishing and Vercel/Cloud Run deployment.

This app is the shared dashboard/API. Browser captures execute on developer machines or CI runners. Its development adapter is separate from the installed package runtime.

For architecture, see the [package architecture](../../docs/PACKAGE-ARCHITECTURE.md). Validation records describe their own historical revisions; the setup guides describe the current supported workflows and release boundaries.
