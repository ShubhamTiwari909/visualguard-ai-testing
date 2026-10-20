import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createRun } from "../../../packages/visualguard/src/core/run.js";
import { configSchema } from "../../../packages/visualguard/src/config/schema.js";
import { resolveConfig } from "../../../packages/visualguard/src/config/resolve.js";
import { uploadRun } from "./upload-client.js";
import { projectTestConfig } from "./project-tests.js";
import type { ClaimedProjectTest, ProjectTestProgress } from "../shared/project-tests.js";

export async function runDashboardRunner(options: {
  server: string;
  project: string;
  token: string;
  once?: boolean;
  poll?: number;
  workDir?: string;
  signal?: AbortSignal;
}) {
  const server = new URL(options.server);
  if (
    !["http:", "https:"].includes(server.protocol) ||
    server.username ||
    server.password ||
    server.pathname !== "/" ||
    server.search ||
    server.hash ||
    (server.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(server.hostname))
  )
    throw new Error("Use an HTTPS dashboard origin, or HTTP on loopback");
  if (!options.token.startsWith("vg_runner_") || options.token.length > 200)
    throw new Error("Set VISUALGUARD_RUNNER_TOKEN to this project's runner credential");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(options.project)) throw new Error("Use the project's ID");
  const poll = options.poll ?? 3000;
  if (!Number.isInteger(poll) || poll < 1000 || poll > 30000)
    throw new Error("Polling must be 1000–30000 milliseconds");
  const root = resolve(options.workDir ?? ".visualguard/runner");
  await mkdir(root, { recursive: true });
  const request = async <T>(action: string, data: unknown, signal?: AbortSignal): Promise<T> => {
    const response = await fetch(
      new URL(`/api/projects/${options.project}/test-runner/${action}`, server),
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
        headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok)
      throw Object.assign(
        new Error(
          `Runner ${action} request rejected (${response.status}); check the runner credential, project and server`,
        ),
        { status: response.status },
      );
    return response.json() as Promise<T>;
  };
  console.log(`Connecting runner to ${server.origin}, project ${options.project}.`);
  let connected = false;
  do {
    options.signal?.throwIfAborted();
    const job = await request<ClaimedProjectTest | null>("claim", {}, options.signal);
    if (!connected) {
      console.log("Runner connected. Waiting for dashboard tests.");
      connected = true;
    }
    if (job) {
      if (
        !/^[a-f0-9-]{36}$/.test(job.id) ||
        !/^[a-z0-9][a-z0-9-]{0,62}$/.test(job.projectId) ||
        !/^[a-f0-9]{64}$/.test(job.lease) ||
        !Number.isSafeInteger(job.configVersion)
      )
        throw new Error("Dashboard returned an invalid test request");
      const lease = { id: job.id, lease: job.lease };
      const controller = new AbortController();
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(15 * 60_000),
        ...(options.signal ? [options.signal] : []),
      ]);
      let progress: ProjectTestProgress = { stage: "starting", completedJobs: 0, totalJobs: 0 };
      let sent: ProjectTestProgress | undefined;
      let renewedAt = 0;
      let confirmedAt = Date.now();
      let renewing: Promise<void> | undefined;
      let stopped = false;
      const renew = () => {
        if (stopped || renewing) return renewing;
        const snapshot = progress;
        renewedAt = Date.now();
        renewing = request("heartbeat", { ...lease, progress: snapshot }, signal)
          .then(() => {
            sent = snapshot;
            confirmedAt = Date.now();
          })
          .catch((error: unknown) => {
            const status =
              error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
            // Retry transient reporting failures while the last confirmed lease is still
            // safely live. Authorization/schema/lease rejection must stop capture immediately.
            if (
              (status >= 400 && status < 500 && status !== 429) ||
              Date.now() - confirmedAt >= 45000 ||
              signal.aborted
            )
              controller.abort(error);
          })
          .finally(() => {
            renewing = undefined;
          });
        return renewing;
      };
      // Coalesce periodic engine reports at one-second intervals; flush stage boundaries explicitly.
      // Lease renewals use the same single-flight channel so they cannot race progress writes.
      const timer = setInterval(() => {
        if (sent !== progress || Date.now() - renewedAt >= 15000) void renew();
      }, 1000);
      const flushProgress = async () => {
        await renewing;
        signal.throwIfAborted();
        if (sent !== progress) await renew();
        signal.throwIfAborted();
      };
      const stopHeartbeat = async () => {
        stopped = true;
        clearInterval(timer);
        await renewing;
      };
      let uploaded: Awaited<ReturnType<typeof uploadRun>> | undefined;
      try {
        const config = projectTestConfig.parse(job.config);
        const workDir = resolve(root, job.id);
        const parsed = configSchema.parse({ ...config, concurrency: 1, output: { dir: "runs" } });
        const resolved = resolveConfig(parsed, {
          cwd: workDir,
          overrides: {
            production: config.baseURL.production,
            staging: config.baseURL.staging,
            aiProvider: config.ai.provider,
            aiModel: config.ai.model,
            browser: "chromium",
            concurrency: 1,
            outputDir: "runs",
          },
        });
        console.log(`Starting dashboard test ${job.id} (configuration v${job.configVersion}).`);
        await flushProgress();
        const completed = new Set<string>();
        const outcome = await createRun(resolved, {
          signal,
          reporters: [
            {
              name: "dashboard-progress",
              onEvent(event) {
                if (event.type === "run:start") {
                  progress = { stage: "capturing", completedJobs: 0, totalJobs: event.jobs.length };
                } else if (event.type === "job:start" || event.type === "job:captured") {
                  progress = {
                    ...progress,
                    stage:
                      event.type === "job:captured" && event.env === "staging"
                        ? "comparing"
                        : "capturing",
                    route: event.job.route.slice(0, 1000),
                    viewport: event.job.viewport,
                  };
                } else if (event.type === "job:end") {
                  completed.add(event.job.id);
                  progress = { ...progress, completedJobs: completed.size };
                }
              },
            },
          ],
        }).start();
        progress = {
          stage: "uploading",
          completedJobs: progress.completedJobs,
          totalJobs: progress.totalJobs,
        };
        await flushProgress();
        const result = (uploaded = await uploadRun({
          server: server.origin,
          project: job.projectId,
          token: options.token,
          runDir: outcome.runDir,
          signal,
          metadata: {
            environment: "dashboard",
            deployment: job.id,
            runName: `Dashboard test · config v${job.configVersion}`,
          },
        }));
        progress = { ...progress, stage: "finalizing" };
        await flushProgress();
        await stopHeartbeat();
        signal.throwIfAborted();
        // Completion is idempotent: retry the same uploaded run if its acknowledgement
        // was lost. Never replace a finalized upload with a capture-failure outcome.
        for (let attempt = 0; ; attempt++) {
          try {
            await request("complete", { ...lease, runId: result.id }, signal);
            break;
          } catch (error) {
            if (attempt === 2 || signal.aborted) throw error;
            await delay(500 * (attempt + 1), undefined, { signal });
          }
        }
        console.log(
          `Dashboard test finished: ${new URL(result.url, server).href} [${result.status}]`,
        );
      } catch (error) {
        await stopHeartbeat();
        if (uploaded) {
          console.error(
            `Run uploaded: ${new URL(uploaded.url, server).href}. Completion could not be acknowledged; retain this result instead of repeating the capture.`,
            error instanceof Error ? error.message : "Runner error",
          );
        } else {
          await request("complete", { ...lease, failed: true }).catch(() => {});
          console.error(
            `Dashboard test failed; evidence remains under ${root}.`,
            error instanceof Error ? error.message : "Runner error",
          );
        }
        if (options.once) throw error;
      } finally {
        clearInterval(timer);
      }
    }
    if (options.once) return;
    await delay(poll, undefined, { signal: options.signal });
  } while (!options.signal?.aborted);
}
