import { runVisualGuard, VisualGuardError } from "visualguard";

const controller = new AbortController();
const stop = () => controller.abort(new Error("Visual check cancelled"));
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  const result = await runVisualGuard({
    configPath: process.argv[2],
    signal: controller.signal,
    failOn: "review",
    reports: { githubSummary: Boolean(process.env.GITHUB_STEP_SUMMARY) },
    onEvent(event) {
      if (event.type === "job:end")
        console.log(`${event.job.status}: ${event.job.name} (${event.job.viewport})`);
    },
  });
  console.log("Summary:", result.manifest.summary);
  console.log("Upload this complete evidence directory:", result.runDir);
  console.log("HTML report:", result.artifacts.html);
  console.log("JUnit report:", result.artifacts.junit);
  process.exitCode = result.exitCode;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = controller.signal.aborted
    ? 130
    : error instanceof VisualGuardError
      ? error.exitCode
      : 1;
} finally {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
