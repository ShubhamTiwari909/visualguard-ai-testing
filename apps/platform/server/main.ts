import { startDashboard } from "./runtime.js";

async function main() {
  const server = process.argv.includes("--dev")
    ? await import("./dev.js").then((module) => module.startDevDashboard())
    : await startDashboard();
  console.log(`VisualGuard dashboard: ${server.url}`);
  const stop = () => {
    void server.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
