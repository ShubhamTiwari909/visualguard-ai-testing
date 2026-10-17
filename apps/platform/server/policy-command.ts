import { z } from "zod";
import { openPlatform } from "./config.js";
import { AuthService, type Actor } from "./auth.js";
import { Policies, sourceRevision, pullRequestNumber } from "./policies.js";
import { PolicyGitHub } from "./policy-github.js";
import { projectId } from "./validation.js";
import { PlatformError } from "./errors.js";
import type { PolicyAssessment, PolicyDelivery } from "../shared/policies.js";

export interface PolicyCommandOptions {
  project: string;
  action: "assess" | "reconcile";
  revision?: string;
  runId?: string;
  pullRequest?: number;
  all?: boolean;
  server?: string;
  env?: NodeJS.ProcessEnv;
}
export async function runPolicyCommand(options: PolicyCommandOptions) {
  projectId(options.project);
  if (options.action === "assess") {
    sourceRevision.parse(options.revision);
    if (options.runId) z.string().uuid().parse(options.runId);
  } else if (!options.all) pullRequestNumber.parse(options.pullRequest);
  const env = options.env ?? process.env;
  const origin = options.server ?? env.VISUALGUARD_DASHBOARD_URL;
  let close = async () => {};
  let assess: () => Promise<PolicyAssessment>;
  let reconcile: (pr: number) => Promise<PolicyDelivery>;
  let deliveries: () => Promise<PolicyDelivery[]>;
  try {
    if (origin) {
      const url = new URL(origin);
      if (
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        url.username ||
        url.password ||
        !["http:", "https:"].includes(url.protocol) ||
        (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      )
        throw new PlatformError(400, "Use an HTTPS dashboard origin (HTTP is allowed on loopback)");
      let csrf = "";
      if (!env.VISUALGUARD_UPLOAD_TOKEN) {
        const response = await fetch(new URL("/api/session", url), {
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
        const value = (await response.json()) as { access?: string; token?: string };
        if (value.access !== "local")
          throw new PlatformError(401, "Use a project upload token for a hosted dashboard");
        csrf = value.token ?? "";
      }
      const request = async <T>(path: string, data?: unknown): Promise<T> => {
        const response = await fetch(
          new URL(`/api/projects/${options.project}/policy${path}`, url),
          {
            method: data === undefined ? "GET" : "POST",
            redirect: "error",
            signal: AbortSignal.timeout(180000),
            headers: {
              "Content-Type": "application/json",
              ...(env.VISUALGUARD_UPLOAD_TOKEN
                ? { Authorization: `Bearer ${env.VISUALGUARD_UPLOAD_TOKEN}` }
                : { "x-visualguard-platform-token": csrf }),
            },
            body: data === undefined ? undefined : JSON.stringify(data),
          },
        );
        const value = (await response.json()) as T & { error?: string };
        if (!response.ok)
          throw new PlatformError(response.status, value.error ?? "Policy request failed");
        return value;
      };
      assess = () =>
        request("/assess", {
          revision: options.revision,
          ...(options.runId ? { runId: options.runId } : {}),
        });
      reconcile = (pullRequest) => request("/reconcile", { pullRequest });
      deliveries = async () =>
        (await request<{ deliveries: PolicyDelivery[] }>("/deliveries")).deliveries;
    } else {
      const platform = await openPlatform(env);
      close = platform.close;
      const auth = new AuthService(platform.state, {
        ...env,
        VISUALGUARD_AUTH_MODE: "local",
        VISUALGUARD_PUBLIC_URL: undefined,
      });
      await auth.ready;
      const project = await platform.repository.resolveProjectId(options.project);
      const actor: Actor = {
        id: "local-owner",
        name: "Local workspace",
        email: "",
        admin: true,
        csrf: "",
      };
      const policies = new Policies(platform.repository, platform.state, auth);
      const github = new PolicyGitHub(policies);
      assess = () => policies.assess(actor, project, options.revision!, options.runId);
      reconcile = (pr) => github.reconcile(actor, project, pr);
      deliveries = () => github.deliveries(actor, project);
    }
    if (options.action === "assess") return { assessment: await assess() };
    const requests = options.all
      ? (await deliveries()).filter((item) => !item.closed).map((item) => item.pullRequest)
      : [options.pullRequest!];
    const results: PolicyDelivery[] = [];
    const errors: { pullRequest: number; error: string }[] = [];
    for (const pr of requests) {
      try {
        results.push(await reconcile(pr));
      } catch (error) {
        if (!options.all) throw error;
        errors.push({
          pullRequest: pr,
          error: error instanceof Error ? error.message : "Reconciliation failed",
        });
      }
    }
    return { deliveries: results, errors };
  } finally {
    await close();
  }
}
