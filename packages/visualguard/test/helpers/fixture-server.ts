import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve } from "node:path";

export const FIXTURE_ROOT = resolve(import.meta.dirname, "../../../../fixtures/site");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".png": "image/png",
  ".css": "text/css",
  ".js": "text/javascript",
};

export interface FixtureServer {
  url: string;
  close: () => Promise<void>;
}

/** Serves fixtures/site/<variant>: "/name" -> name.html, "/" -> index.html. */
export async function startFixtureServer(
  variant: "production" | "staging",
  root = FIXTURE_ROOT,
): Promise<FixtureServer> {
  const dir = join(root, variant);
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index";
    const candidates = [join(dir, path), join(dir, `${path}.html`)];
    const file = candidates.find(
      (candidate) =>
        candidate.startsWith(dir) && existsSync(candidate) && statSync(candidate).isFile(),
    );
    if (!file) {
      response.writeHead(404, { "content-type": "text/html" }).end("<h1>Not found</h1>");
      return;
    }
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    let body: Buffer | string = readFileSync(file);
    if (type.startsWith("application/xml") || type.startsWith("text/plain")) {
      body = body.toString("utf8").replaceAll("{{origin}}", `http://${request.headers.host}`);
    }
    response.writeHead(200, { "content-type": type }).end(body);
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
  };
}
