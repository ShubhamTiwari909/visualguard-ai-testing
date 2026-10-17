import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, cp, mkdir, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { openPlatform } from "./config.js";
import { createApi } from "./http.js";

export interface RuntimeOptions {
  env?: NodeJS.ProcessEnv;
  dataDir?: string;
}
export async function createDashboardHandler(options: RuntimeOptions = {}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    ...(options.dataDir ? { VISUALGUARD_PLATFORM_DATA_DIR: resolve(options.dataDir) } : {}),
  };
  if ((env.VERCEL || env.K_SERVICE) && !(env.VISUALGUARD_DATABASE_URL || env.DATABASE_URL))
    throw new Error("Cloud Run and Vercel require VISUALGUARD_DATABASE_URL for persistent data");
  const platform = await openPlatform(env);
  try {
    const api = createApi(platform.repository, platform.store, { state: platform.state, env });
    await api.ready;
    const handle = async (request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url ?? "/", "http://localhost"),
        rewritten = url.searchParams.get("__vg_path");
      if (rewritten !== null) {
        url.searchParams.delete("__vg_path");
        if (
          rewritten.includes("?") ||
          rewritten.includes("#") ||
          rewritten.split("/").includes("..")
        ) {
          response.writeHead(400);
          response.end();
          return true;
        }
        request.url = `/api/${rewritten}${url.search}`;
      }
      if (
        request.method === "GET" &&
        new URL(request.url ?? "/", "http://localhost").pathname === "/api/health"
      ) {
        try {
          await platform.state.get("health", "ping");
          response.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          response.end('{"status":"ok"}');
        } catch {
          response.writeHead(503, { "Content-Type": "application/json" });
          response.end('{"status":"unavailable"}');
        }
        return true;
      }
      return api(request, response);
    };
    return { handle, close: platform.close };
  } catch (error) {
    await platform.close();
    throw error;
  }
}

export async function dashboardAssets(): Promise<string> {
  const candidates = [
    fileURLToPath(new URL("./dashboard-app", import.meta.url)),
    fileURLToPath(new URL("../dist/client", import.meta.url)),
  ];
  for (const path of candidates) {
    try {
      if ((await stat(resolve(path, "index.html"))).isFile()) return path;
    } catch {
      /* Try the next packaged/source layout. */
    }
  }
  throw new Error(
    "Dashboard assets are missing. Use a dashboard-enabled VisualGuard package or run pnpm --filter visualguard build:dashboard in the repository.",
  );
}
export async function copyDashboardAssets(out: string) {
  const target = resolve(out);
  await mkdir(target, { recursive: true });
  await cp(await dashboardAssets(), target, { recursive: true });
  return target;
}

export async function startDashboard(
  options: RuntimeOptions & { port?: number; host?: string; assetDir?: string } = {},
) {
  const env = { ...process.env, ...options.env };
  const port = options.port ?? Number(env.VISUALGUARD_PLATFORM_PORT ?? env.PORT ?? 4400);
  const host =
    options.host ??
    env.VISUALGUARD_HOST ??
    (env.K_SERVICE || env.VISUALGUARD_PUBLIC_URL ? "0.0.0.0" : "127.0.0.1");
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Dashboard port must be between 0 and 65535");
  const mode =
    env.VISUALGUARD_AUTH_MODE ??
    (env.VISUALGUARD_PUBLIC_URL || env.VERCEL || env.K_SERVICE ? "login" : "local");
  if (mode === "local" && !["127.0.0.1", "localhost", "::1"].includes(host))
    throw new Error("Configure a public URL and login before listening on an external interface");
  const runtime = await createDashboardHandler(options);
  try {
    const root = options.assetDir ? resolve(options.assetDir) : await dashboardAssets();
    const indexPath = resolve(root, "index.html"),
      index = await readFile(indexPath, "utf8");
    const server = createServer((request, response) => {
      void (async () => {
        if (await runtime.handle(request, response)) return;
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.writeHead(405);
          response.end();
          return;
        }
        const path = new URL(request.url ?? "/", "http://localhost").pathname;
        if (path === "/invite") {
          response.setHeader("Referrer-Policy", "no-referrer");
          response.setHeader("Cache-Control", "no-store");
        }
        if (
          path === "/" ||
          path === "/settings" ||
          path === "/operations" ||
          path === "/invite" ||
          path === "/reviews" ||
          path === "/baselines" ||
          /^\/runs\/[a-f0-9-]{36}(?:\/report)?$/.test(path)
        ) {
          const html = index;
          response.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          });
          response.end(request.method === "HEAD" ? undefined : html);
        } else if (path.startsWith("/assets/")) {
          const file = resolve(root, `.${decodeURIComponent(path)}`);
          if (!file.startsWith(resolve(root, "assets") + sep)) {
            response.writeHead(404);
            response.end();
            return;
          }
          try {
            const bytes = await readFile(file),
              types: Record<string, string> = {
                ".js": "text/javascript",
                ".css": "text/css",
                ".woff2": "font/woff2",
              };
            response.writeHead(200, {
              "Content-Type": types[extname(file)] ?? "application/octet-stream",
              "Cache-Control": "public, max-age=31536000, immutable",
            });
            response.end(request.method === "HEAD" ? undefined : bytes);
          } catch {
            response.writeHead(404);
            response.end("Not found");
          }
        } else {
          response.writeHead(404);
          response.end("Not found");
        }
      })().catch((error: unknown) => {
        console.error("Dashboard request failed", error);
        if (!response.headersSent) response.writeHead(500);
        response.end("Dashboard request failed");
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Dashboard listener did not start");
    return {
      url:
        env.VISUALGUARD_PUBLIC_URL || `http://${host === "::1" ? "[::1]" : host}:${address.port}`,
      port: address.port,
      async close() {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await runtime.close();
      },
    };
  } catch (error) {
    await runtime.close();
    throw error;
  }
}
