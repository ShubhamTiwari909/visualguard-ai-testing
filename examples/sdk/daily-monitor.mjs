import { resolve } from "node:path";
import { runVisualGuard } from "visualguard";

/**
 * Wire your existing storage/notification functions into one daily script.
 * No cloud clients are included. Setup/upload/notification errors reject so the
 * calling script can record execution failure and choose its process exit code.
 * @param {{snapshotDir: string, runOptions?: import('visualguard').RunVisualGuardOptions,
 * restoreSnapshots: (dir: string) => Promise<void>,
 * publishRun: (result: import('visualguard').VisualGuardResult) => Promise<void>,
 * persistSnapshots: (dir: string, result: import('visualguard').VisualGuardResult) => Promise<void>,
 * notify: (result: import('visualguard').VisualGuardResult) => Promise<void>}} input
 */
export async function runDailyMonitor(input) {
  const cwd = resolve(input.runOptions?.cwd ?? process.cwd());
  const dir = resolve(cwd, input.snapshotDir);
  await input.restoreSnapshots(dir);
  const result = await runVisualGuard({
    ...input.runOptions,
    cwd,
    monitor: { dir, update: "unless-regression" },
  });
  if (result.manifest.mode !== "monitor" || result.snapshotDir !== dir) {
    throw new Error(
      "This installed SDK did not run monitor mode. Upgrade before publishing daily evidence.",
    );
  }
  // A failed comparison is still a completed run with publishable evidence.
  await input.publishRun(result);
  await input.persistSnapshots(dir, result);
  await input.notify(result);
  return result;
}
