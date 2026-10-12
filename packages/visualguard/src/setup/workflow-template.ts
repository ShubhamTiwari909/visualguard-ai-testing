/**
 * @file Renders comparison and scheduled monitor GitHub workflow YAML.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import type { PackageManager } from "./project.js";

interface ManagerSteps {
  setup: string[];
  cache?: string;
  install: string;
  exec: string;
  lockfile: string;
}

const MANAGERS: Record<PackageManager, ManagerSteps> = {
  pnpm: {
    setup: ["      - uses: pnpm/action-setup@v4"],
    cache: "pnpm",
    install: "pnpm install --frozen-lockfile",
    exec: "pnpm exec",
    lockfile: "pnpm-lock.yaml",
  },
  npm: { setup: [], cache: "npm", install: "npm ci", exec: "npx", lockfile: "package-lock.json" },
  yarn: {
    setup: [],
    cache: "yarn",
    install: "yarn install --frozen-lockfile",
    exec: "yarn",
    lockfile: "yarn.lock",
  },
  bun: {
    setup: ["      - uses: oven-sh/setup-bun@v2"],
    install: "bun install --frozen-lockfile",
    exec: "bunx",
    lockfile: "bun.lock*",
  },
};

/**
 * `.github/workflows/visualguard.yml` (PLAN.md Appendix C): test, upload the run as an
 * artifact, then post or update the PR comment with a link to it, and fail only after that.
 *
 * Generate a GitHub Actions workflow that tests, uploads artifacts and updates the PR comment
 * before reporting failure. Use the selected package manager's install/run commands.
 */
export function renderWorkflow(manager: PackageManager, options: { ai: boolean }): string {
  const steps = MANAGERS[manager];
  const lines = [
    "name: VisualGuard",
    "",
    "on:",
    "  pull_request:",
    "",
    "permissions:",
    "  contents: read",
    "  pull-requests: write",
    "",
    "jobs:",
    "  visualguard:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    ...steps.setup,
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: 22",
    ...(steps.cache ? [`          cache: ${steps.cache}`] : []),
    `      - run: ${steps.install}`,
    "",
    "      - name: Cache Playwright browsers",
    "        uses: actions/cache@v4",
    "        with:",
    "          path: ~/.cache/ms-playwright",
    `          key: playwright-\${{ runner.os }}-\${{ hashFiles('${steps.lockfile}') }}`,
    `      - run: ${steps.exec} playwright install --with-deps chromium`,
    "",
    "      - name: Visual regression test",
    "        id: visualguard",
    "        continue-on-error: true",
    `        run: ${steps.exec} visualguard test --ci --junit visualguard-junit.xml`,
    "        env:",
    ...(options.ai ? ["          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}"] : []),
    "          # Point staging at this PR's preview deployment, if you have one:",
    "          # VISUALGUARD_STAGING_URL: ${{ vars.STAGING_URL }}",
    "",
    "      - name: Upload the report",
    "        id: upload",
    "        if: always()",
    "        uses: actions/upload-artifact@v4",
    "        with:",
    "          name: visualguard-report",
    "          path: .visualguard/runs/",
    "          if-no-files-found: ignore",
    "",
    "      - name: Comment on the pull request",
    "        if: always()",
    `        run: ${steps.exec} visualguard comment --link "\${{ steps.upload.outputs.artifact-url }}"`,
    "        env:",
    "          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
    "",
    "      - name: Fail on regressions",
    "        if: steps.visualguard.outcome == 'failure'",
    "        run: exit 1",
    "",
  ];
  return lines.join("\n");
}

/**
 * `.github/workflows/visualguard-monitor.yml`: a scheduled run of `visualguard monitor`. The
 * previous captures live in the Actions cache: each run restores the newest one and saves its
 * own.
 *
 * Generate a scheduled monitor workflow with cached baseline restoration and saving. Keep
 * notification/report steps available even when the comparison reports a problem.
 */
export function renderMonitorWorkflow(
  manager: PackageManager,
  options: { schedule: string; url?: string },
): string {
  const steps = MANAGERS[manager];
  const lines = [
    "name: VisualGuard monitor",
    "",
    "on:",
    "  schedule:",
    `    - cron: "${options.schedule}"`,
    "  workflow_dispatch:",
    "",
    "permissions:",
    "  contents: read",
    "",
    "jobs:",
    "  monitor:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    ...steps.setup,
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: 22",
    ...(steps.cache ? [`          cache: ${steps.cache}`] : []),
    `      - run: ${steps.install}`,
    "",
    "      - name: Cache Playwright browsers",
    "        uses: actions/cache@v4",
    "        with:",
    "          path: ~/.cache/ms-playwright",
    `          key: playwright-\${{ runner.os }}-\${{ hashFiles('${steps.lockfile}') }}`,
    `      - run: ${steps.exec} playwright install --with-deps chromium`,
    "",
    "      - name: Restore the previous captures",
    "        uses: actions/cache/restore@v4",
    "        with:",
    "          path: .visualguard/monitor",
    "          key: visualguard-monitor-${{ github.run_id }}",
    "          restore-keys: visualguard-monitor-",
    "",
    "      - name: Compare with the previous captures",
    "        id: monitor",
    "        continue-on-error: true",
    `        run: ${steps.exec} visualguard monitor${options.url ? ` ${options.url}` : ""} --ci`,
    "        env:",
    "          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}",
    "          # Slack incoming webhook, n8n, Zapier…: gets a summary when the run ends.",
    "          VISUALGUARD_WEBHOOK_URL: ${{ secrets.VISUALGUARD_WEBHOOK_URL }}",
    "",
    "      - name: Save the captures for the next run",
    "        if: always()",
    "        uses: actions/cache/save@v4",
    "        with:",
    "          path: .visualguard/monitor",
    "          key: visualguard-monitor-${{ github.run_id }}",
    "",
    "      - name: Upload the report",
    "        if: always()",
    "        uses: actions/upload-artifact@v4",
    "        with:",
    "          name: visualguard-monitor-report",
    "          path: .visualguard/runs/",
    "          if-no-files-found: ignore",
    "",
    "      - name: Fail on regressions",
    "        if: steps.monitor.outcome == 'failure'",
    "        run: exit 1",
    "",
  ];
  return lines.join("\n");
}
