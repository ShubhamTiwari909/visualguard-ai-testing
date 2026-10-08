// Serves fixtures/site/<variant>: "/name" → name.html, "/" → index.html; {{origin}} in .xml/.txt
// files becomes the server's origin. Used by serve-fixtures.mjs and the eval runner.
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";

export const FIXTURE_ROOT = resolve(import.meta.dirname, "../fixtures/site");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml",
  ".txt": "text/plain",
};

/** Starts a server for one variant; resolves to { url, close }. Port 0 picks a free port. */
export function startFixtureServer(variant, port = 0) {
  const dir = join(FIXTURE_ROOT, variant);
  const server = createServer((request, response) => {
    let path = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
    if (path.endsWith("/")) path += "index";
    const file = [join(dir, path), join(dir, `${path}.html`)].find(
      (candidate) =>
        candidate.startsWith(dir) && existsSync(candidate) && statSync(candidate).isFile(),
    );
    if (!file)
      return response.writeHead(404, { "content-type": "text/html" }).end("<h1>Not found</h1>");
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    let body = readFileSync(file);
    if (type === "application/xml" || type === "text/plain") {
      body = body.toString("utf8").replaceAll("{{origin}}", `http://${request.headers.host}`);
    }
    response.writeHead(200, { "content-type": type }).end(body);
  });
  return new Promise((resolvePromise) =>
    server.listen(port, "127.0.0.1", () =>
      resolvePromise({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(() => done())),
      }),
    ),
  );
}
