import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import sirv from "sirv";
import { readManifest } from "../core/runs.js";
import { renderReportHTML } from "../reporters/html.js";

/** A POST handler for the local action API. Receives the parsed JSON body. */
export type ApiHandler = (body: unknown) => Promise<unknown> | unknown;

export interface ReportServerOptions {
  runDir: string;
  port?: number;
  /** Always 127.0.0.1 unless overridden in tests. */
  host?: string;
  /** Mutating endpoints, e.g. { "accept": handler } → POST /api/accept. */
  api?: Record<string, ApiHandler>;
  /** Show "Generate fix" in the page (fix.enabled). */
  fixEnabled?: boolean;
}

export interface ReportServer {
  url: string;
  token: string;
  close: () => Promise<void>;
}

const MAX_BODY_BYTES = 1_000_000;

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendJSON(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function tokenMatches(expected: string, given: string | string[] | undefined): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Serves one run directory on localhost (PLAN.md §11.4). The page is rendered per request so it
 * reflects manifest changes (accepted changes, re-analysis). Actions go through POST /api/* and
 * require the per-session token that is embedded in the page.
 */
export async function startReportServer(options: ReportServerOptions): Promise<ReportServer> {
  const token = randomBytes(24).toString("base64url");
  const assets = sirv(options.runDir, { dev: true, dotfiles: false });
  const api = options.api ?? {};

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (url.pathname === "/" || url.pathname === "/index.html") {
      try {
        const html = renderReportHTML(readManifest(options.runDir), {
          server: { token, fixEnabled: options.fixEnabled },
        });
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
        });
        response.end(html);
      } catch (error) {
        response.writeHead(500, { "content-type": "text/plain" }).end(String(error));
      }
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      const name = url.pathname.slice("/api/".length);
      if (name === "health" && request.method === "GET")
        return sendJSON(response, 200, { ok: true });
      const handler = api[name];
      if (!handler) return sendJSON(response, 404, { error: `Unknown action: ${name}` });
      if (request.method !== "POST") return sendJSON(response, 405, { error: "Use POST" });
      if (!tokenMatches(token, request.headers["x-visualguard-token"])) {
        return sendJSON(response, 403, { error: "Missing or invalid token" });
      }
      void readBody(request)
        .then((raw) => handler(raw ? JSON.parse(raw) : {}))
        .then((result) => sendJSON(response, 200, result ?? { ok: true }))
        .catch((error: unknown) =>
          sendJSON(response, 400, {
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      return;
    }

    assets(request, response, () => {
      response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    });
  });

  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${host}:${port}/`,
    token,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
