import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importRun } from "./ingest.js";
import type { ArtifactStore } from "./artifacts.js";
import type { PlatformRepository } from "./storage-contracts.js";
import type { TestExecutions } from "./test-executions.js";

export const BUILT_IN_RUNNER = "built-in";
const browserMissing =
  /Executable doesn't exist|npx playwright install|Cannot find (?:module|package) '(?:@?playwright)|browserType\.launch/i;

/** Serverless hosts cannot keep a browser alive after the response, so they stay opt-in. */
export function builtInRunnerEnabled(env: NodeJS.ProcessEnv) {
  const choice = env.VISUALGUARD_BUILT_IN_RUNNER?.toLowerCase();
  if (choice) return !["0", "false", "off", "no"].includes(choice);
  return !env.VERCEL;
}

/**
 * Lets the dashboard capture a project's test on the machine that serves it, authorised by the
 * signed-in user's own request instead of a separate runner credential. A private runner still
 * takes priority when one is connected.
 */
export class BuiltInRunner {
  private reservations = 0;
  constructor(
    private executions: TestExecutions,
    private repository: PlatformRepository,
    private store: ArtifactStore,
    private options: { enabled: boolean; concurrency?: number; root?: string },
  ) {}
  get enabled() {
    return this.options.enabled;
  }
  get hasCapacity() {
    return this.reservations < (this.options.concurrency ?? 1);
  }
  /** Reserve synchronously, before request persistence yields to another project. */
  reserve(): (() => void) | undefined {
    if (!this.enabled || !this.hasCapacity) return undefined;
    this.reservations++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.reservations--;
    };
  }
  /** Runs in the background; the execution record carries every outcome. */
  start(project: string, release: () => void) {
    void this.run(project)
      .catch((error: unknown) => console.error("Built-in test runner failed", error))
      .finally(release);
  }
  private async run(project: string) {
    const job = await this.executions.claim(project, BUILT_IN_RUNNER);
    if (!job) return;
    const { executeClaimedTest } = await import("./test-runner.js");
    const root = this.options.root ?? join(tmpdir(), "visualguard-built-in-runner");
    try {
      await executeClaimedTest(job, {
        root,
        link: (path) => path,
        failureReason: (error) =>
          error instanceof Error && browserMissing.test(error.message)
            ? "browser-unavailable"
            : undefined,
        transport: {
          heartbeat: (body) => this.executions.heartbeat(project, BUILT_IN_RUNNER, body),
          complete: (body) => this.executions.complete(project, BUILT_IN_RUNNER, body),
          upload: async ({ runDir, metadata }) => {
            const { run } = await importRun(this.repository, this.store, {
              projectId: project,
              runDir,
              metadata,
            });
            return { id: run.id, url: `/runs/${run.id}`, status: run.status };
          },
        },
      });
    } finally {
      await rm(join(root, job.id), { recursive: true, force: true }).catch(() => {});
    }
  }
}
