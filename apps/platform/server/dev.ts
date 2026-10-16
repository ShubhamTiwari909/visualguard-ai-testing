/** Workspace-only development adapter; never imported by the published dashboard runtime. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { createDashboardHandler } from "./runtime.js";

export async function startDevDashboard(options: { port?: number } = {}) {
  const runtime = await createDashboardHandler();
  const port = options.port ?? Number(process.env.VISUALGUARD_PLATFORM_PORT ?? 4400);
  if (!Number.isInteger(port) || port < 0 || port > 65535 || (port === 0 && options.port !== 0)) {
    await runtime.close();
    throw new Error("Invalid development port");
  }
  const index = fileURLToPath(new URL("../client/index.html", import.meta.url));
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  const server = createServer((request, response) => {
    void (async () => {
      if (await runtime.handle(request, response)) return;
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (path === "/invite") {
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("Cache-Control", "no-store");
      }
      if (
        path === "/" ||
        path === "/settings" ||
        path === "/reviews" ||
        path === "/invite" ||
        /^\/runs\/[a-f0-9-]{36}(?:\/report)?$/.test(path)
      ) {
        const html = await vite!.transformIndexHtml(path, await readFile(index, "utf8"));
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(html);
      } else
        vite!.middlewares(request, response, () => {
          response.writeHead(404);
          response.end();
        });
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end("Dashboard development request failed");
    });
  });
  try {
    vite = await createViteServer({
      configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
      server: { middlewareMode: true, ws: { server } },
      appType: "custom",
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing development listener");
    return {
      url: `http://127.0.0.1:${address.port}`,
      async close() {
        await vite?.close();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await runtime.close();
      },
    };
  } catch (error) {
    await vite?.close();
    await runtime.close();
    throw error;
  }
}
