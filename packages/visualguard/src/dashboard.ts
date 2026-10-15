/** Standalone runtime; browser execution remains in the existing CLI/CI engine. */
export {
  createDashboardHandler,
  startDashboard,
  copyDashboardAssets,
} from "../../../apps/platform/server/runtime.js";
export { uploadRun as publishDashboardRun } from "../../../apps/platform/server/upload-client.js";
export { scaffoldDashboard } from "../../../apps/platform/server/scaffold.js";
export { createDashboardProject } from "../../../apps/platform/server/project-command.js";
import { openPlatform } from "../../../apps/platform/server/config.js";
import { importRun } from "../../../apps/platform/server/ingest.js";
import { exportEvidence, restoreEvidence } from "../../../apps/platform/server/backup.js";
import type { RunMetadata } from "../../../apps/platform/shared/contracts.js";

export async function importDashboardRun(options: {
  project: string;
  name?: string;
  runDir: string;
  metadata: RunMetadata;
  env?: NodeJS.ProcessEnv;
}) {
  const platform = await openPlatform(options.env);
  try {
    await platform.repository.createProject(options.project, options.name ?? options.project);
    return await importRun(platform.repository, platform.store, {
      projectId: options.project,
      runDir: options.runDir,
      metadata: options.metadata,
    });
  } finally {
    await platform.close();
  }
}
export async function exportDashboard(file: string, env?: NodeJS.ProcessEnv) {
  const platform = await openPlatform(env);
  try {
    return await exportEvidence(platform.repository, platform.store, file);
  } finally {
    await platform.close();
  }
}
export async function restoreDashboard(file: string, env?: NodeJS.ProcessEnv) {
  const platform = await openPlatform(env);
  try {
    return await restoreEvidence(platform.repository, platform.store, file);
  } finally {
    await platform.close();
  }
}
