import type { IncomingMessage, ServerResponse } from "node:http";
import type { ArtifactStore } from "./artifacts.js";
import { PlatformError } from "./errors.js";
import type { PlatformRepository, StateStore } from "./storage-contracts.js";
import { AuthService, MemoryStateStore, type ProjectRole } from "./auth.js";
import { z } from "zod";
import { artifactPath } from "./validation.js";
import { RUN_STATUSES, type RunFilters, type RunStatus } from "../shared/contracts.js";
import { body, json, readBytes } from "./transport.js";
import { Uploads, UPLOAD_CHUNK_BYTES } from "./uploads.js";
import { sha256 } from "./artifacts.js";
import { findProject, projectSelector } from "./project-selector.js";
import { Invitations } from "./invitations.js";
import { Onboarding } from "./onboarding.js";
import { Reviews, reviewMutation } from "./reviews.js";
import { Baselines, baselineSet, baselinePromotion, baselineRestore } from "./baselines.js";
import { Operations } from "./operations.js";
import { Policies, policyMutation, assessmentInput, pullRequestNumber } from "./policies.js";
import { PolicyGitHub } from "./policy-github.js";
import { ProjectTests } from "./project-tests.js";
import { TestExecutions } from "./test-executions.js";

function integer(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new PlatformError(400, "Invalid numeric filter");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
    throw new PlatformError(400, "Numeric filter is outside its allowed range");
  return parsed;
}

function filters(params: URLSearchParams): RunFilters {
  const result: RunFilters = {
    limit: integer(params.get("limit"), 25, 1, 100),
    offset: integer(params.get("offset"), 0, 0, 10_000_000),
  };
  for (const key of ["project", "q", "environment", "branch", "commit", "deployment"] as const) {
    const value = params.get(key);
    if (value) {
      if (value.length > 500) throw new PlatformError(400, "Filter is too long");
      result[key] = value;
    }
  }
  const status = params.get("status");
  if (status && !RUN_STATUSES.includes(status as RunStatus))
    throw new PlatformError(400, "Unknown run status");
  if (status) result.status = status as RunStatus;
  if (params.has("pr")) result.pullRequest = integer(params.get("pr"), 1, 1, 2_147_483_647);
  for (const key of ["from", "to"] as const) {
    const value = params.get(key);
    if (value) {
      if (!Number.isFinite(Date.parse(value))) throw new PlatformError(400, "Invalid date filter");
      const date = new Date(value);
      if (key === "to" && /^\d{4}-\d{2}-\d{2}$/.test(value)) date.setUTCHours(23, 59, 59, 999);
      result[key] = date.toISOString();
    }
  }
  if (result.from && result.to && result.from > result.to)
    throw new PlatformError(400, "Start date must precede end date");
  return result;
}

const logOidcFailure = (stage: "start" | "callback", error: unknown) => {
  if (!(error instanceof PlatformError) || error.status >= 500)
    console.error(`Platform OIDC ${stage} failed`);
};

export interface ApiOptions {
  state?: StateStore;
  env?: NodeJS.ProcessEnv;
}
export function createApi(
  repository: PlatformRepository,
  store: ArtifactStore,
  options: ApiOptions = {},
) {
  const auth = new AuthService(options.state ?? new MemoryStateStore(), options.env ?? process.env);
  if (auth.mode === "login" && !options.state)
    throw new Error("Hosted access requires persistent authentication state");
  const uploads = new Uploads(repository, store, auth.state, auth);
  const invitations = new Invitations(
    auth.state,
    repository,
    auth.publicUrl?.origin ?? "http://localhost",
  );
  const onboarding = new Onboarding(auth, invitations);
  const reviews = new Reviews(repository, auth.state, auth);
  const operations = new Operations(auth.state);
  const baselines = new Baselines(repository, auth.state, auth);
  const policies = new Policies(repository, auth.state, auth);
  const policyGitHub = new PolicyGitHub(policies);
  const projectTests = new ProjectTests(repository, auth.state, auth);
  const testExecutions = new TestExecutions(projectTests);
  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("X-Frame-Options", "DENY");
    let url: URL;
    try {
      url = auth.url(request);
    } catch (error) {
      json(response, error instanceof PlatformError ? error.status : 400, {
        error: error instanceof Error ? error.message : "Invalid URL",
      });
      return true;
    }
    if (!url.pathname.startsWith("/api/")) return false;
    if (
      url.pathname === "/api/session" ||
      url.pathname.startsWith("/api/auth/") ||
      url.pathname.startsWith("/api/onboarding") ||
      url.pathname.startsWith("/api/invitations") ||
      url.pathname === "/api/audit" ||
      url.pathname === "/api/operations"
    )
      response.setHeader("Cache-Control", "no-store");
    try {
      await auth.ready;
      if (request.method === "POST" && url.pathname === "/api/github/webhook") {
        const parsedBody = (request as IncomingMessage & { body?: unknown }).body;
        if (
          parsedBody !== undefined &&
          !Buffer.isBuffer(parsedBody) &&
          typeof parsedBody !== "string"
        )
          throw new PlatformError(
            415,
            "GitHub webhooks require the original raw request body; disable host JSON body parsing for this endpoint",
          );
        const bytes = await readBytes(request, 1024 * 1024);
        const signature = request.headers["x-hub-signature-256"];
        const event = request.headers["x-github-event"];
        json(
          response,
          200,
          await policyGitHub.webhook(
            bytes,
            typeof signature === "string" ? signature : undefined,
            typeof event === "string" ? event : undefined,
          ),
        );
        return true;
      }
      const actor = await auth.actor(request);
      if (request.method === "GET" && url.pathname === "/api/session") {
        json(response, 200, {
          token: actor?.credentialId ? undefined : actor?.csrf,
          access: auth.mode,
          user:
            actor && !actor.credentialId
              ? { id: actor.id, name: actor.name, email: actor.email, admin: actor.admin }
              : null,
          admission: auth.admission,
          oidc: auth.oidcProvider !== null,
          oidcProvider: auth.oidcProvider,
          envelopeVersion: 1,
        });
        return true;
      }
      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        const input = z
          .object({ email: z.string().max(254), password: z.string().max(256) })
          .parse(await body(request));
        json(response, 200, await auth.login(input.email, input.password, response));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/api/auth/login") {
        try {
          await auth.throttle(sha256(`oidc-login:${request.socket.remoteAddress}`));
          await auth.beginOidc(response);
        } catch (error) {
          if (error instanceof PlatformError && error.status === 429) {
            json(response, 429, { error: error.message });
            return true;
          }
          logOidcFailure("start", error);
          response.writeHead(302, { Location: "/?signin_error=oidc" });
          response.end();
        }
        return true;
      }
      if (request.method === "GET" && url.pathname === "/api/auth/callback") {
        let failureLocation = "/?signin_error=oidc";
        try {
          failureLocation = await auth.oidcFailureLocation(request);
          await auth.finishOidc(request, response, url, (binding, identity, profile) =>
            onboarding.complete(request, binding, identity, profile),
          );
        } catch (error) {
          logOidcFailure("callback", error);
          // Provider errors can contain authorization codes or credential details.
          // Send a fixed error code to the login page, never the provider response.
          response.writeHead(302, {
            Location: failureLocation,
          });
          response.end();
        }
        return true;
      }
      if (url.pathname.startsWith("/api/onboarding")) {
        response.setHeader("Referrer-Policy", "no-referrer");
        if (request.method === "GET" && url.pathname === "/api/onboarding") {
          await auth.throttle(sha256(`onboarding-preview:${request.socket.remoteAddress}`), 60);
          json(response, 200, await onboarding.browser(request, response));
          return true;
        }
        if (request.method === "POST" && url.pathname === "/api/onboarding/exchange") {
          const input = z
            .object({ token: z.string().max(200) })
            .strict()
            .parse(await body(request));
          json(response, 200, await onboarding.exchange(request, input.token, actor));
          return true;
        }
        if (request.method === "POST" && url.pathname === "/api/onboarding/login") {
          z.object({})
            .strict()
            .parse(await body(request));
          json(response, 200, await onboarding.login(request, response, actor));
          return true;
        }
        if (request.method === "POST" && url.pathname === "/api/onboarding/prove") {
          const input = z
            .object({ currentPassword: z.string().max(256).optional() })
            .strict()
            .parse(await body(request));
          if (!actor) throw new PlatformError(401, "Sign in to your existing account first");
          json(response, 200, await onboarding.prove(request, actor, input.currentPassword));
          return true;
        }
        if (request.method === "POST" && url.pathname === "/api/onboarding/accept") {
          z.object({ confirmed: z.literal(true) })
            .strict()
            .parse(await body(request));
          json(response, 200, await onboarding.accept(request, response, actor));
          return true;
        }
        throw new PlatformError(404, "API endpoint not found");
      }
      const runnerRoute = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/test-runner\/(claim|heartbeat|complete)$/);
      if (runnerRoute && request.method === "POST") {
        if (!actor) throw new PlatformError(401, "Runner credential rejected");
        response.setHeader("Cache-Control", "no-store");
        const project = await repository.resolveProjectId(runnerRoute[1]!);
        const bearer = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : "";
        const runnerId = await testExecutions.runner(actor, project, bearer);
        const input = await body(request);
        const value = runnerRoute[2] === "claim"
          ? (z.object({}).strict().parse(input), await testExecutions.claim(project, runnerId))
          : runnerRoute[2] === "heartbeat"
            ? await testExecutions.heartbeat(project, runnerId, input)
            : await testExecutions.complete(project, runnerId, input);
        json(response, 200, value);
        return true;
      }
      if (!actor) throw new PlatformError(401, "Sign in to access this dashboard");
      if (request.method !== "GET" && request.method !== "HEAD") auth.csrf(request, actor);
      if (request.method === "GET" && url.pathname === "/api/auth/identities") {
        json(response, 200, await auth.accountIdentities(actor));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/api/auth/identities/google/link") {
        const input = z
          .object({ currentPassword: z.string().max(256).optional() })
          .strict()
          .parse(await body(request));
        json(response, 200, await auth.beginGoogleLink(actor, input.currentPassword, response));
        return true;
      }
      const requestedProjectId = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)(?:\/|$)/)?.[1];
      if (requestedProjectId) {
        const canonical = await repository.resolveProjectId(requestedProjectId);
        url.pathname = url.pathname.replace(
          `/api/projects/${requestedProjectId}`,
          `/api/projects/${canonical}`,
        );
      }
      const testExecution = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/test-execution$/);
      if (testExecution) {
        response.setHeader("Cache-Control", "no-store");
        if (request.method === "GET") {
          json(response, 200, await testExecutions.status(actor, testExecution[1]!));
          return true;
        }
        if (request.method === "POST") {
          json(response, 202, await testExecutions.request(actor, testExecution[1]!, await body(request)));
          return true;
        }
      }
      const runnerKey = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/test-runner-key$/);
      if (runnerKey && request.method === "POST") {
        await projectTests.access(actor, runnerKey[1]!, true);
        const input = z.object({ name: z.string().min(1).max(120), days: z.number().int().min(1).max(90) }).strict().parse(await body(request));
        json(response, 201, await auth.mintToken(actor, runnerKey[1]!, input.name, input.days, true));
        return true;
      }
      const testConfig = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/test-config$/);
      if (testConfig) {
        response.setHeader("Cache-Control", "no-store");
        if (request.method === "GET") {
          json(response, 200, await projectTests.read(actor, testConfig[1]!));
          return true;
        }
        if (request.method === "PUT") {
          json(response, 200, await projectTests.save(actor, testConfig[1]!, await body(request)));
          return true;
        }
      }
      if (await uploads.handle(request, response, url, actor)) return true;
      if (request.method === "GET" && url.pathname === "/api/publishing/project") {
        const selector = projectSelector(url.searchParams.get("project") ?? "");
        const access = actor.credentialId
          ? [actor.uploadProject!]
          : actor.admin
            ? undefined
            : (await auth.projectAccess(actor))
                ?.filter((item) => item.role === "maintainer")
                .map((item) => item.projectId);
        const project = findProject(await repository.projects(access), selector);
        if (!project)
          throw new PlatformError(
            404,
            "Project not found or not permitted; use an existing project ID and its upload token",
          );
        json(response, 200, { id: project.id, name: project.name, publicId: project.publicId });
        return true;
      }
      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        await auth.logout(actor, response);
        json(response, 200, { ok: true });
        return true;
      }
      const policyRoute = url.pathname.match(
        /^\/api\/projects\/([a-z0-9-]+)\/policy(?:\/(assess|reconcile|deliveries))?$/,
      );
      if (policyRoute) {
        const project = policyRoute[1]!;
        const action = policyRoute[2];
        if (request.method === "GET" && !action) {
          json(response, 200, await policies.history(actor, project));
        } else if (request.method === "POST" && !action) {
          json(
            response,
            201,
            await policies.save(actor, project, policyMutation.parse(await body(request))),
          );
        } else if (request.method === "POST" && action === "assess") {
          const input = assessmentInput.parse(await body(request));
          json(response, 200, await policies.assess(actor, project, input.revision, input.runId));
        } else if (request.method === "GET" && action === "deliveries") {
          json(response, 200, { deliveries: await policyGitHub.deliveries(actor, project) });
        } else if (request.method === "POST" && action === "reconcile") {
          const input = z
            .object({ pullRequest: pullRequestNumber })
            .strict()
            .parse(await body(request));
          json(response, 200, await policyGitHub.reconcile(actor, project, input.pullRequest));
        } else throw new PlatformError(405, "Unsupported policy action");
        return true;
      }
      const baselineRoute = url.pathname.match(
        /^\/api\/projects\/([a-z0-9-]+)\/baselines(?:\/([a-z0-9-]+)(?:\/(history|promote|restore|artifacts\/([a-f0-9]{64})))?)?$/,
      );
      if (baselineRoute) {
        const [, project, set, action, hash] = baselineRoute;
        if (set) baselineSet.parse(set);
        if (request.method === "GET") {
          if (!set) json(response, 200, { sets: await baselines.list(actor, project!) });
          else if (action === "history")
            json(
              response,
              200,
              await baselines.history(
                actor,
                project!,
                set,
                url.searchParams.get("after") ?? undefined,
              ),
            );
          else {
            const version = await baselines.version(
              actor,
              project!,
              set,
              url.searchParams.has("version")
                ? integer(url.searchParams.get("version"), 1, 1, 1000000000)
                : undefined,
            );
            if (hash) {
              const artifact = version.entries
                .flatMap((entry) => [entry.image, ...(entry.dom ? [entry.dom] : [])])
                .find((item) => item.hash === hash);
              if (!artifact)
                throw new PlatformError(404, "Artifact is not part of this approved version");
              const index = integer(
                url.searchParams.get("chunk"),
                0,
                0,
                Math.max(0, Math.ceil(artifact.size / UPLOAD_CHUNK_BYTES) - 1),
              );
              const data = store.getChunk
                ? await store.getChunk(hash, index)
                : (await store.get(hash)).subarray(
                    index * UPLOAD_CHUNK_BYTES,
                    (index + 1) * UPLOAD_CHUNK_BYTES,
                  );
              response.writeHead(200, {
                "Content-Type": "application/octet-stream",
                "Content-Length": data.length,
                "Cache-Control": "private, no-store",
                "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
              });
              response.end(data);
            } else if (!action) json(response, 200, version);
            else throw new PlatformError(405, "Unsupported baseline action");
          }
          return true;
        }
        if (actor.credentialId)
          throw new PlatformError(403, "Upload credentials cannot change approved baselines");
        if (request.method === "POST" && set && action === "promote") {
          json(
            response,
            201,
            await baselines.promote(
              actor,
              project!,
              set,
              baselinePromotion.parse(await body(request)),
            ),
          );
          return true;
        }
        if (request.method === "POST" && set && action === "restore") {
          json(
            response,
            201,
            await baselines.restore(
              actor,
              project!,
              set,
              baselineRestore.parse(await body(request)),
            ),
          );
          return true;
        }
        throw new PlatformError(405, "Unsupported baseline action");
      }
      if (actor.credentialId)
        throw new PlatformError(
          403,
          "Upload credentials cannot browse or administer the dashboard",
        );
      if (url.pathname === "/api/invitations") {
        if (auth.mode !== "login" || !actor.admin || !actor.sessionId)
          throw new PlatformError(403, "A signed-in administrator is required");
        if (request.method === "GET") {
          const input = z
            .object({ after: z.string().uuid().optional() })
            .strict()
            .parse(Object.fromEntries(url.searchParams));
          json(response, 200, await invitations.list(actor, input.after));
          return true;
        }
        if (request.method === "POST") {
          const input = z
            .object({
              email: z.string().max(254),
              projectId: z.string().regex(/^[a-z0-9-]{1,63}$/),
              role: z.enum(["viewer", "reviewer", "maintainer"]),
              hours: z.number().int().min(1).max(168).optional(),
            })
            .strict()
            .parse(await body(request));
          input.projectId = await repository.resolveProjectId(input.projectId);
          json(response, 201, await invitations.create(actor, input));
          return true;
        }
      }
      const invitationChange = url.pathname.match(
        /^\/api\/invitations\/([a-f0-9-]{36})\/(cancel|replace)$/,
      );
      if (request.method === "POST" && invitationChange) {
        const input = z
          .object({
            expectedVersion: z.number().int().positive(),
            role: z.enum(["viewer", "reviewer", "maintainer"]).optional(),
            hours: z.number().int().min(1).max(168).optional(),
          })
          .strict()
          .parse(await body(request));
        if (invitationChange[2] === "replace" && !input.role)
          throw new PlatformError(400, "Choose a role for the replacement invitation");
        json(
          response,
          200,
          await invitations.change(
            actor,
            invitationChange[1]!,
            input.expectedVersion,
            invitationChange[2] === "replace"
              ? { role: input.role!, hours: input.hours }
              : undefined,
          ),
        );
        return true;
      }
      if (request.method === "GET" && url.pathname === "/api/reviews") {
        const input = z
          .object({
            project: z.string().regex(/^[a-z0-9-]{1,63}$/),
            after: z.string().max(200).optional(),
            owner: z.enum(["all", "mine", "unassigned"]).optional(),
            status: z.enum(["all", "open", "pending", "approved", "rejected"]).optional(),
            overdue: z.enum(["true", "false"]).optional(),
          })
          .strict()
          .parse(Object.fromEntries(url.searchParams));
        json(
          response,
          200,
          await reviews.inbox(actor, {
            ...input,
            project: await repository.resolveProjectId(input.project),
            overdue: input.overdue === "true",
          }),
        );
        return true;
      }
      const reviewPeople = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/reviewers$/);
      if (request.method === "GET" && reviewPeople) {
        json(response, 200, { reviewers: await reviews.reviewers(actor, reviewPeople[1]!) });
        return true;
      }
      const reviewRun = url.pathname.match(/^\/api\/runs\/([a-f0-9-]{36})\/reviews$/);
      if (reviewRun) {
        if (request.method === "GET") {
          const job = z.string().min(1).max(500).parse(url.searchParams.get("job"));
          json(response, 200, await reviews.read(actor, reviewRun[1]!, job));
          return true;
        }
        if (request.method === "POST") {
          const input = reviewMutation.parse(await body(request));
          json(response, 200, await reviews.append(actor, reviewRun[1]!, input));
          return true;
        }
      }
      if (request.method === "POST" && url.pathname === "/api/auth/password") {
        const input = z
          .object({ current: z.string().max(256), password: z.string().min(12).max(256) })
          .parse(await body(request));
        await auth.changePassword(actor, input.current, input.password, response);
        json(response, 200, { ok: true });
        return true;
      }
      if (url.pathname === "/api/users") {
        if (!actor.admin) throw new PlatformError(403, "Administrator access required");
        if (request.method === "GET") {
          if (auth.mode === "local")
            json(response, 200, { users: await auth.users(), administrationAvailable: false });
          else {
            const input = z
              .object({
                query: z.string().max(120).optional(),
                role: z.enum(["admin", "member"]).optional(),
                status: z.enum(["active", "disabled"]).optional(),
                after: z.string().max(200).optional(),
              })
              .strict()
              .parse(Object.fromEntries(url.searchParams));
            json(response, 200, await auth.administration.directory(actor, input));
          }
          return true;
        }
        if (request.method === "POST") {
          const input = z
            .object({
              email: z.string(),
              password: z.string(),
              name: z.string(),
              role: z.enum(["admin", "member"]).optional(),
            })
            .parse(await body(request));
          const user = await auth.createManagedUser(actor, input);
          if (auth.mode === "local") await auth.audit(actor, "user.created", { userId: user.id });
          json(response, 201, user);
          return true;
        }
      }
      const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
      if (request.method === "GET" && userMatch) {
        const input = z
          .object({ after: z.string().max(500).optional() })
          .strict()
          .parse(Object.fromEntries(url.searchParams));
        json(
          response,
          200,
          await auth.administration.detail(actor, decodeURIComponent(userMatch[1]!), input.after),
        );
        return true;
      }
      const revokeSessions = url.pathname.match(/^\/api\/users\/([^/]+)\/revoke-sessions$/);
      if (request.method === "POST" && revokeSessions) {
        const input = z
          .object({
            expectedVersion: z.number().int().positive(),
            currentPassword: z.string().max(256).optional(),
          })
          .strict()
          .parse(await body(request));
        json(
          response,
          200,
          await auth.updateUser(actor, decodeURIComponent(revokeSessions[1]!), {
            ...input,
            revoke: true,
          }),
        );
        return true;
      }
      if (request.method === "PATCH" && userMatch) {
        const input = z
          .object({
            expectedVersion: z.number().int().positive(),
            currentPassword: z.string().max(256).optional(),
            disabled: z.boolean().optional(),
            role: z.enum(["admin", "member"]).optional(),
            password: z.string().min(12).max(256).optional(),
          })
          .strict()
          .parse(await body(request));
        json(response, 200, await auth.updateUser(actor, decodeURIComponent(userMatch[1]!), input));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/api/audit") {
        if (!actor.admin) throw new PlatformError(403, "Administrator access required");
        const input = z
          .object({
            after: z.string().min(1).max(200).optional(),
            action: z.string().max(120).optional(),
            person: z.string().max(120).optional(),
            since: z.string().datetime({ offset: true }).optional(),
            until: z.string().datetime({ offset: true }).optional(),
          })
          .strict()
          .parse(Object.fromEntries(url.searchParams));
        if (input.since && input.until && Date.parse(input.since) > Date.parse(input.until))
          throw new PlatformError(400, "Start date must precede end date");
        json(response, 200, await operations.audit(input));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/api/operations") {
        if (!actor.admin) throw new PlatformError(403, "Administrator access required");
        json(response, 200, await operations.status());
        return true;
      }
      const access = url.pathname.match(
        /^\/api\/projects\/([a-z0-9-]+)\/(members|tokens)(?:\/([a-f0-9]{64}))?$/,
      );
      if (access) {
        const project = access[1]!;
        await auth.requireRole(actor, project, "maintainer");
        if (!(await repository.projects([project])).length)
          throw new PlatformError(404, "Project not found");
        if (access[2] === "members") {
          if (request.method === "GET") {
            json(response, 200, { members: await auth.members(project) });
            return true;
          }
          if (request.method === "POST") {
            const input = z
              .object({
                userId: z.string(),
                role: z.enum(["viewer", "reviewer", "maintainer"]).nullable(),
              })
              .parse(await body(request));
            await auth.assign(actor, project, input.userId, input.role as ProjectRole | null);
            json(response, 200, { ok: true });
            return true;
          }
        } else {
          if (request.method === "GET") {
            json(response, 200, { tokens: await auth.tokens(project) });
            return true;
          }
          if (request.method === "POST") {
            const input = z
              .object({ name: z.string(), days: z.number().int() })
              .parse(await body(request));
            json(response, 201, await auth.mintToken(actor, project, input.name, input.days));
            return true;
          }
          if (request.method === "DELETE" && access[3]) {
            await auth.revokeToken(actor, project, access[3]);
            json(response, 200, { ok: true });
            return true;
          }
        }
      }
      if (request.method === "GET" && url.pathname === "/api/projects") {
        const access = await auth.projectAccess(actor),
          roles = new Map(access?.map((item) => [item.projectId, item.role]));
        const projects = await repository.projects(access?.map((item) => item.projectId));
        json(response, 200, {
          projects: projects.map((project) => ({
            ...project,
            role: actor.admin ? "maintainer" : roles.get(project.id),
          })),
        });
        return true;
      }
      if (request.method === "POST" && url.pathname === "/api/projects") {
        if (!actor.admin)
          throw new PlatformError(403, "Administrator access required to create projects");
        const input = await body(request);
        if (
          !input ||
          typeof input !== "object" ||
          !("id" in input) ||
          !("name" in input) ||
          typeof input.id !== "string" ||
          typeof input.name !== "string"
        )
          throw new PlatformError(400, "Project id and name are required");
        const { project, created } = await repository.ensureProject(input.id, input.name);
        if (created) await auth.audit(actor, "project.created", { projectId: project.id });
        json(response, created ? 201 : 200, { ...project, created });
        return true;
      }
      const projectDeletion = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)$/);
      if (request.method === "PATCH" && projectDeletion) {
        const id = projectDeletion[1]!;
        await auth.requireRole(actor, id, "maintainer");
        const input = z
          .object({
            name: z.string().trim().min(1).max(120),
            publicId: z.string().max(63),
            expectedVersion: z.number().int().nonnegative(),
          })
          .strict()
          .parse(await body(request));
        const project = await repository.updateProject(
          id,
          input.name,
          input.publicId,
          input.expectedVersion,
        );
        await auth
          .audit(actor, "project.renamed", {
            projectId: id,
            name: project.name,
            publicId: project.publicId,
          })
          .catch((error) =>
            console.error("Project details saved; unable to record audit event", error),
          );
        json(response, 200, project);
        return true;
      }
      if (request.method === "DELETE" && projectDeletion) {
        const id = projectDeletion[1]!;
        await auth.requireRole(actor, id, "maintainer");
        const input = z
          .object({
            confirmation: z.union([z.literal(id), z.literal(requestedProjectId ?? id)]),
            expectedRuns: z.number().int().nonnegative(),
          })
          .strict()
          .parse(await body(request));
        const result = await repository.deleteProject(id, input.expectedRuns);
        await auth
          .audit(actor, "project.deleted", { projectId: id, ...result })
          .catch((error) => console.error("Unable to record project deletion audit", error));
        json(response, 200, result);
        return true;
      }
      if (request.method === "GET" && url.pathname === "/api/runs") {
        json(
          response,
          200,
          await repository.runs(filters(url.searchParams), await auth.projectIds(actor)),
        );
        return true;
      }
      const match = url.pathname.match(/^\/api\/runs\/([a-f0-9-]{36})(?:\/(.*))?$/);
      if (request.method === "PATCH" && match && !match[2]) {
        const run = await repository.getRun(match[1]!);
        await auth.requireRole(actor, run.projectId, "maintainer");
        const input = z
          .object({
            name: z.string().trim().max(120),
            expectedVersion: z.number().int().nonnegative(),
          })
          .strict()
          .parse(await body(request));
        const renamed = await repository.renameRun(run.id, input.name, input.expectedVersion);
        await auth
          .audit(actor, "run.renamed", {
            projectId: run.projectId,
            runId: run.id,
            name: renamed.name ?? null,
          })
          .catch((error) => console.error("Run name saved; unable to record audit event", error));
        json(response, 200, {
          id: renamed.id,
          name: renamed.name ?? null,
          nameVersion: renamed.nameVersion,
        });
        return true;
      }
      if (request.method === "DELETE" && match && !match[2]) {
        const id = match[1]!,
          run = await repository.getRun(id);
        await auth.requireRole(actor, run.projectId, "maintainer");
        z.object({ confirmation: z.literal(id) })
          .strict()
          .parse(await body(request));
        const result = await repository.deleteRun(id, run.projectId);
        await auth
          .audit(actor, "run.deleted", { projectId: run.projectId, runId: id, ...result })
          .catch((error) => console.error("Unable to record run deletion audit", error));
        json(response, 200, result);
        return true;
      }
      if (request.method === "GET" && match) {
        const run = await repository.getRun(match[1]!);
        await auth.requireRole(actor, run.projectId);
        if (!match[2]) {
          const bytes = Buffer.from(JSON.stringify(run.manifest));
          json(
            response,
            200,
            bytes.length > 2 * UPLOAD_CHUNK_BYTES
              ? {
                  ...run,
                  manifest: undefined,
                  manifestTransfer: {
                    size: bytes.length,
                    hash: sha256(bytes),
                    chunks: Math.ceil(bytes.length / UPLOAD_CHUNK_BYTES),
                  },
                }
              : run,
          );
          return true;
        }
        if (match[2] === "manifest") {
          const bytes = Buffer.from(JSON.stringify(run.manifest)),
            index = integer(
              url.searchParams.get("chunk"),
              0,
              0,
              Math.max(0, Math.ceil(bytes.length / UPLOAD_CHUNK_BYTES) - 1),
            );
          const chunk = bytes.subarray(
            index * UPLOAD_CHUNK_BYTES,
            (index + 1) * UPLOAD_CHUNK_BYTES,
          );
          response.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Cache-Control": "private, no-store",
          });
          response.end(chunk);
          return true;
        }
        if (match[2].startsWith("artifacts/")) {
          let path: string;
          try {
            path = artifactPath(decodeURIComponent(match[2].slice("artifacts/".length)));
          } catch {
            throw new PlatformError(400, "Invalid artifact path");
          }
          const artifact = run.artifacts.find((item) => item.path === path);
          if (!artifact) throw new PlatformError(404, "Artifact is not part of this run");
          let data: Buffer;
          const isChunk = url.searchParams.has("chunk");
          if (isChunk) {
            const index = integer(
              url.searchParams.get("chunk"),
              0,
              0,
              Math.max(0, Math.ceil(artifact.size / UPLOAD_CHUNK_BYTES) - 1),
            );
            data = store.getChunk
              ? await store.getChunk(artifact.hash, index)
              : (await store.get(artifact.hash)).subarray(
                  index * UPLOAD_CHUNK_BYTES,
                  (index + 1) * UPLOAD_CHUNK_BYTES,
                );
          } else {
            if (auth.env.VERCEL && artifact.size > 3 * UPLOAD_CHUNK_BYTES)
              throw new PlatformError(
                413,
                "Use chunked artifact downloads on Vercel; the dashboard handles this automatically",
              );
            data = await store.get(artifact.hash);
          }
          response.writeHead(200, {
            "Content-Type": isChunk ? "application/octet-stream" : artifact.mediaType,
            "Content-Length": data.length,
            "Cache-Control": "private, no-store",
            ETag: `"${artifact.hash}"`,
            "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
          });
          response.end(data);
          return true;
        }
      }
      throw new PlatformError(404, "API endpoint not found");
    } catch (error) {
      if (error instanceof z.ZodError) {
        json(response, 400, {
          error: "Invalid request fields",
          fields: error.issues.map((issue) => issue.path.join(".")),
        });
        return true;
      }
      if (!(error instanceof PlatformError)) console.error("Platform API request failed", error);
      json(response, error instanceof PlatformError ? error.status : 500, {
        error:
          error instanceof PlatformError
            ? error.message
            : "Unable to read platform evidence; check server logs",
      });
      return true;
    }
  };
  return Object.assign(handler, { ready: auth.ready });
}
