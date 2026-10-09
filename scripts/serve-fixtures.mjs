/**
 * @file Starts the production/staging fixture sites for manual local exploration.
 *
 * This is a repository-support script run by Node.js, outside the published package API.
 * Top-level await waits for setup before proceeding; async helpers return Promises. Read the
 * helpers below before invoking a script that starts processes or writes artifacts.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

// Serves the fixture site for manual testing:
//   production → http://127.0.0.1:4100   staging → http://127.0.0.1:4101
// Usage: node scripts/serve-fixtures.mjs [productionPort] [stagingPort]
import { startFixtureServer } from "./fixture-server.mjs";

const production = await startFixtureServer("production", Number(process.argv[2] ?? 4100));
const staging = await startFixtureServer("staging", Number(process.argv[3] ?? 4101));
console.log(`production ${production.url}`);
console.log(`staging    ${staging.url}`);
