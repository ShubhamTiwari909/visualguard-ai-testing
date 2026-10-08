import { existsSync, readFileSync } from "node:fs";
import { EnvironmentError } from "../core/errors.js";
import { COMMENT_MARKER } from "./markdown.js";

export interface GitHubContext {
  token: string;
  apiURL: string;
  owner: string;
  repo: string;
  /** PR number, if the event carries one. */
  pullNumber?: number;
  sha?: string;
}

/** Reads the GitHub Actions environment (or explicit overrides). */
export function githubContext(
  env: NodeJS.ProcessEnv = process.env,
  overrides: { repo?: string; pr?: number; token?: string } = {},
): GitHubContext {
  const token = overrides.token ?? env.GITHUB_TOKEN ?? env.GH_TOKEN;
  if (!token) {
    throw new EnvironmentError("GITHUB_TOKEN is not set", {
      hint: "In GitHub Actions, pass `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` and grant `pull-requests: write`.",
    });
  }
  const repository = overrides.repo ?? env.GITHUB_REPOSITORY;
  const [owner, repo] = repository?.split("/") ?? [];
  if (!owner || !repo) {
    throw new EnvironmentError("Unknown repository", {
      hint: "Pass --repo owner/name or run inside GitHub Actions.",
    });
  }

  let pullNumber = overrides.pr;
  if (pullNumber === undefined && env.GITHUB_EVENT_PATH && existsSync(env.GITHUB_EVENT_PATH)) {
    try {
      const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")) as {
        pull_request?: { number?: number };
        issue?: { number?: number; pull_request?: unknown };
        number?: number;
      };
      pullNumber =
        event.pull_request?.number ?? (event.issue?.pull_request ? event.issue.number : undefined);
    } catch {
      // Not a PR event; the PR is looked up from the commit instead.
    }
  }
  return {
    token,
    apiURL: (env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, ""),
    owner,
    repo,
    pullNumber,
    sha: env.GITHUB_SHA,
  };
}

async function request<T>(
  context: GitHubContext,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${context.apiURL}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${context.token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "visualguard",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const hint =
      response.status === 403 || response.status === 404
        ? "The token needs `pull-requests: write`. On pull requests from forks GITHUB_TOKEN is read-only; use the two-workflow `workflow_run` pattern from the docs."
        : undefined;
    throw new EnvironmentError(
      `GitHub API ${method} ${path} failed: HTTP ${response.status} ${text.slice(0, 200)}`,
      { hint },
    );
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

/** For events without a PR (deployment_status, push): the open PR that contains the commit. */
export async function findPullForCommit(context: GitHubContext): Promise<number | undefined> {
  if (!context.sha) return undefined;
  const pulls = await request<Array<{ number: number; state: string }>>(
    context,
    "GET",
    `/repos/${context.owner}/${context.repo}/commits/${context.sha}/pulls`,
  );
  return pulls.find((pull) => pull.state === "open")?.number ?? pulls[0]?.number;
}

export interface CommentResult {
  action: "created" | "updated";
  id: number;
  url: string;
  pullNumber: number;
}

/**
 * Creates the VisualGuard comment on the PR, or updates the existing one (found by its hidden
 * marker), so a PR has one comment that tracks the latest run.
 */
export async function upsertComment(
  context: GitHubContext,
  pullNumber: number,
  body: string,
): Promise<CommentResult> {
  const base = `/repos/${context.owner}/${context.repo}/issues`;
  let existing: { id: number } | undefined;
  for (let page = 1; page <= 10 && !existing; page++) {
    const comments = await request<Array<{ id: number; body?: string }>>(
      context,
      "GET",
      `${base}/${pullNumber}/comments?per_page=100&page=${page}`,
    );
    existing = comments.find((comment) => comment.body?.includes(COMMENT_MARKER));
    if (comments.length < 100) break;
  }
  if (existing) {
    const updated = await request<{ id: number; html_url: string }>(
      context,
      "PATCH",
      `${base}/comments/${existing.id}`,
      { body },
    );
    return { action: "updated", id: updated.id, url: updated.html_url, pullNumber };
  }
  const created = await request<{ id: number; html_url: string }>(
    context,
    "POST",
    `${base}/${pullNumber}/comments`,
    { body },
  );
  return { action: "created", id: created.id, url: created.html_url, pullNumber };
}
