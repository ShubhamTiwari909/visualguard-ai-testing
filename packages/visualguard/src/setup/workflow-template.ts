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
 * `.github/workflows/visualguard.yml` (PLAN.md Appendix C): test, upload the run as an artifact,
 * then post or update the PR comment with a link to it, and fail only after that.
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
