import { parseArgs } from "node:util";
import { uploadRun } from "./upload-client.js";

async function main() {
  const { values } = parseArgs({
    options: {
      server: { type: "string" },
      project: { type: "string" },
      run: { type: "string" },
      "run-name": { type: "string" },
      environment: { type: "string", default: "staging" },
      branch: { type: "string" },
      commit: { type: "string" },
      pr: { type: "string" },
      deployment: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(
      "pnpm platform:publish --server https://dashboard.example.com --project storefront --run /absolute/run [--environment staging] [--branch name] [--commit sha] [--pr 42] [--deployment id]\nRead upload credentials from VISUALGUARD_UPLOAD_TOKEN.",
    );
    return;
  }
  if (!values.server || !values.project || !values.run)
    throw new Error("Provide --server, --project, and --run");
  const result = await uploadRun({
    server: values.server,
    project: values.project,
    runDir: values.run,
    token: process.env.VISUALGUARD_UPLOAD_TOKEN,
    metadata: {
      runName: values["run-name"],
      environment: values.environment ?? "staging",
      branch: values.branch,
      commit: values.commit,
      pullRequest: values.pr === undefined ? undefined : Number(values.pr),
      deployment: values.deployment,
    },
    onProgress: console.log,
  });
  console.log(
    `${result.duplicate ? "Already published" : "Published"}: ${result.url} [${result.status}]`,
  );
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
