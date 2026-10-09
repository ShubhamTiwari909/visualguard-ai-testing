/**
 * @file GitHub context/REST helpers for PR lookup, sticky comment updates and PR creation.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { existsSync, readFileSync } from "node:fs";
import { EnvironmentError } from "../core/errors.js";
import { COMMENT_MARKER } from "./markdown.js";

export interface GitHubContext {
  token: string;
  apiURL: string;
  owner: string;
  repo: string;
  /**
   * PR number, if the event carries one.
   */
  pullNumber?: number;
  sha?: string;
}

/**
 * Reads the GitHub Actions environment (or explicit overrides).
 *
 * Resolve GitHub credentials, repository and optional PR information from overrides or CI
 * variables. Return no context when required credentials/repository data are unavailable.
 */
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

/**
 * Send an authenticated GitHub API request and reject non-success responses. Return undefined
 * for 204 No Content, otherwise parse JSON into the caller's expected result shape.
 */
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

/**
 * For events without a PR (deployment_status, push): the open PR that contains the commit.
 *
 * Look up PRs associated with a CI commit when the event does not directly identify a PR.
 * Prefer an open result, falling back to the first associated PR when present.
 */
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
 *
 * Find the existing comment by VisualGuard's hidden marker, then update it or create one.
 * Reusing a marked comment prevents every run from adding another PR comment.
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

/**
 * Opens a pull request (used by `fix --auto --pr` when the `gh` CLI isn't available).
 *
 * Open a GitHub PR from the supplied branch/title/body and return its number/URL. This is an
 * external write used by the explicitly requested automatic-fix PR flow.
 */
export async function createPullRequest(
  context: GitHubContext,
  pull: { title: string; body: string; head: string; base: string },
): Promise<{ number: number; url: string }> {
  const created = await request<{ number: number; html_url: string }>(
    context,
    "POST",
    `/repos/${context.owner}/${context.repo}/pulls`,
    pull,
  );
  return { number: created.number, url: created.html_url };
}
