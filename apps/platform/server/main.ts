import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { openPlatform } from "./config.js";
import { createApi } from "./http.js";

async function main() {
  const development = process.argv.includes("--dev");
  const port = Number(process.env.VISUALGUARD_PLATFORM_PORT ?? 4400);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("VISUALGUARD_PLATFORM_PORT must be between 1 and 65535");
  const platform = await openPlatform();
  let vite: ViteDevServer | undefined;
  const api = createApi(platform.repository, platform.store);
  const root = fileURLToPath(new URL("../dist/client", import.meta.url));
  const indexPath = development ? fileURLToPath(new URL("../client/index.html", import.meta.url)) : resolve(root, "index.html");
  let index: string;
  try { index = await readFile(indexPath, "utf8"); }
  catch { await platform.close(); throw new Error("Platform UI is missing. Run pnpm --filter @visualguard/platform build or use pnpm platform:dev."); }
  const server = createServer((request, response) => {
    void (async () => {
      if (await api(request, response)) return;
      if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405); response.end(); return; }
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (pathname === "/" || /^\/runs\/[a-f0-9-]{36}(?:\/report)?$/.test(pathname)) {
        const html = vite ? await vite.transformIndexHtml(pathname, await readFile(indexPath, "utf8")) : index;
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(request.method === "HEAD" ? undefined : html);
      } else if (vite) {
        vite.middlewares(request, response, () => { response.writeHead(404); response.end("Not found"); });
      } else if (pathname.startsWith("/assets/")) {
        const file = resolve(root, `.${decodeURIComponent(pathname)}`);
        if (!file.startsWith(resolve(root, "assets") + sep)) { response.writeHead(404); response.end(); return; }
        try {
          const data = await readFile(file);
          const types: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };
          response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
          response.end(request.method === "HEAD" ? undefined : data);
        } catch { response.writeHead(404); response.end("Not found"); }
      } else { response.writeHead(404); response.end("Not found"); }
    })().catch((error: unknown) => {
      console.error("Platform request failed", error);
      if (!response.headersSent) response.writeHead(500);
      response.end("Platform request failed");
    });
  });
  try {
    if (development) {
      const { createServer: createViteServer } = await import("vite");
      vite = await createViteServer({
        configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
        server: { middlewareMode: true, ws: { server } }, appType: "custom",
      });
    }
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  } catch (error) { await vite?.close(); await platform.close(); throw error; }
  console.log(`VisualGuard dashboard: http://127.0.0.1:${port}`);
  console.log("Local workspace access. Shared organization authentication is planned in F02.");
  const stop = () => {
    server.close(() => { void platform.close(); });
    server.closeAllConnections();
    void vite?.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
