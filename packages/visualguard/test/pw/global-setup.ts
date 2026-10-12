/**
 * @file Starts/stops fixture production/staging servers for the nested Playwright runner.
 *
 * Starts both fixture servers before the suite and returns teardown that closes them.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

// Starts the fixture site: production on 4210, staging on 4211.
import { startFixtureServer } from "../../../../scripts/fixture-server.mjs";

/**
 * Start both reference/current fixture servers before Playwright tests. Return an async
 * teardown callback so the runner closes them after the suite.
 */
export default async function globalSetup() {
  const production = await startFixtureServer("production", 4210);
  const staging = await startFixtureServer("staging", 4211);
  return async () => {
    await production.close();
    await staging.close();
  };
}
