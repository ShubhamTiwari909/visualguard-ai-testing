// Starts the fixture site: production on 4210, staging on 4211.
import { startFixtureServer } from "../../../../scripts/fixture-server.mjs";

export default async function globalSetup() {
  const production = await startFixtureServer("production", 4210);
  const staging = await startFixtureServer("staging", 4211);
  return async () => {
    await production.close();
    await staging.close();
  };
}
