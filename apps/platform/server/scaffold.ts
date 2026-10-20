import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function scaffoldDashboard(options: {
  target: "vercel" | "cloud-run";
  out: string;
  version: string;
  packageFile?: string;
}) {
  const out = resolve(options.out);
  try {
    if ((await readdir(out)).length)
      throw new Error(
        "Deployment output directory must be empty; existing files are not overwritten",
      );
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  await mkdir(out, { recursive: true });
  if (options.packageFile) await cp(resolve(options.packageFile), resolve(out, "visualguard.tgz"));
  const pkg = {
    name: "visualguard-dashboard",
    private: true,
    type: "module",
    engines: { node: "22.x" },
    scripts: { start: "visualguard dashboard", build: "visualguard dashboard assets --out public" },
    dependencies: {
      visualguard: options.packageFile ? "file:./visualguard.tgz" : options.version,
      // Cloud Run keeps a container alive, so the dashboard can run tests itself.
      ...(options.target === "cloud-run" ? { playwright: "^1.45.0" } : {}),
    },
  };
  await writeFile(resolve(out, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  await writeFile(
    resolve(out, ".gitignore"),
    "node_modules/\n.env\n.env.*\n!.env.example\n.visualguard/\n.vercel/\npublic/\n",
  );
  await writeFile(
    resolve(out, ".env.example"),
    "VISUALGUARD_DATABASE_URL=postgresql://USER:PASSWORD@HOST/visualguard\n# MongoDB requires a replica set or sharded deployment for invite mode.\n# Or mongodb://HOST/visualguard?replicaSet=YOUR-REPLICA-SET / mongodb+srv://USER:PASSWORD@HOST/visualguard\n# Standalone MongoDB must use VISUALGUARD_USER_ADMISSION=legacy; invitations/linking are unavailable.\nVISUALGUARD_PUBLIC_URL=https://YOUR-DASHBOARD-HOST\nVISUALGUARD_USER_ADMISSION=invite\nVISUALGUARD_ADMIN_EMAIL=owner@example.com\nVISUALGUARD_ADMIN_PASSWORD=REPLACE-WITH-A-UNIQUE-12-CHARACTER-OR-LONGER-PASSWORD\n",
  );
  if (options.target === "vercel") {
    await mkdir(resolve(out, "api"));
    await writeFile(
      resolve(out, "api/dashboard.mjs"),
      `import { createDashboardHandler } from "visualguard/dashboard";\nlet runtime;\nexport default async function handler(request, response) {\n  try {\n    runtime ??= createDashboardHandler().catch((error) => { runtime = undefined; throw error; });\n    const dashboard = await runtime;\n    if (!await dashboard.handle(request, response)) { response.statusCode = 404; response.end("Not found"); }\n  } catch (error) { console.error("Dashboard startup failed", error); if (!response.headersSent) response.statusCode = 503; response.end("Dashboard unavailable; check deployment configuration"); }\n}\n`,
    );
    await writeFile(
      resolve(out, "vercel.json"),
      `${JSON.stringify(
        {
          $schema: "https://openapi.vercel.sh/vercel.json",
          framework: null,
          buildCommand: "npm run build",
          outputDirectory: "public",
          functions: { "api/dashboard.mjs": { maxDuration: 300 } },
          headers: [
            {
              source: "/invite",
              headers: [
                { key: "Referrer-Policy", value: "no-referrer" },
                { key: "Cache-Control", value: "no-store" },
              ],
            },
          ],
          rewrites: [
            { source: "/api/:path*", destination: "/api/dashboard?__vg_path=:path*" },
            { source: "/runs/:path*", destination: "/index.html" },
            { source: "/settings", destination: "/index.html" },
            { source: "/operations", destination: "/index.html" },
            { source: "/reviews", destination: "/index.html" },
            { source: "/baselines", destination: "/index.html" },
            { source: "/policies", destination: "/index.html" },
            { source: "/invite", destination: "/index.html" },
            { source: "/", destination: "/index.html" },
          ],
        },
        null,
        2,
      )}\n`,
    );
  } else {
    await writeFile(
      resolve(out, "Dockerfile"),
      'FROM node:22-bookworm-slim\nWORKDIR /app\nCOPY --chown=node:node . .\nENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright\nRUN npm install --omit=dev --ignore-scripts && npx playwright install --with-deps chromium && chown -R node:node /app /ms-playwright\nENV NODE_ENV=production\nENV PORT=8080\nENV VISUALGUARD_AUTH_MODE=login\nUSER node\nEXPOSE 8080\nCMD ["./node_modules/.bin/visualguard", "dashboard", "--host", "0.0.0.0"]\n',
    );
    await writeFile(
      resolve(out, ".dockerignore"),
      "node_modules\n.git\n.env\n.env.*\n.visualguard\noutput\n",
    );
  }
  await writeFile(
    resolve(out, "README.md"),
    `# VisualGuard dashboard (${options.target})\n\nRun npm install. Configure the settings in .env.example in your host's environment/secret settings. Do not commit real secrets. MongoDB and PostgreSQL are detected from the URL. Metadata and screenshots persist in the external database.\n\n${options.target === "vercel" ? "Deploy this folder as a Vercel project (Other framework). The build copies prebuilt assets; api/dashboard.mjs handles API requests. Configure the canonical production URL. Preview deployments need their own URL and isolated database." : "Deploy this folder with Cloud Run source deployment or its Dockerfile. Cloud Run sets PORT. Configure database network access and the canonical service URL. The image includes Chromium so Run test works from the dashboard with just a signed-in account; deploy with CPU always allocated (--no-cpu-throttling), at least one instance and 2 GiB of memory, because captures continue after the request returns."}\n\nThis project needs no React, Vite or VisualGuard repository source files.${options.target === "vercel" ? " Vercel functions cannot keep a browser running, so connect a private runner for Run test, or set VISUALGUARD_BUILT_IN_RUNNER=on only on a host that can." : ""}\n`,
  );
  return out;
}
