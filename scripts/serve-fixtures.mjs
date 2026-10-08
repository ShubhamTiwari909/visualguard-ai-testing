// Serves the fixture site for manual testing:
//   production → http://127.0.0.1:4100   staging → http://127.0.0.1:4101
// Usage: node scripts/serve-fixtures.mjs [productionPort] [stagingPort]
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../fixtures/site");
const types = {
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml",
  ".txt": "text/plain",
};

function serve(variant, port) {
  const dir = join(root, variant);
  createServer((request, response) => {
    let path = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
    if (path.endsWith("/")) path += "index";
    const file = [join(dir, path), join(dir, `${path}.html`)].find(
      (candidate) =>
        candidate.startsWith(dir) && existsSync(candidate) && statSync(candidate).isFile(),
    );
    if (!file)
      return response.writeHead(404, { "content-type": "text/html" }).end("<h1>Not found</h1>");
    const type = types[extname(file)] ?? "application/octet-stream";
    let body = readFileSync(file);
    if (type === "application/xml" || type === "text/plain") {
      body = body.toString("utf8").replaceAll("{{origin}}", `http://${request.headers.host}`);
    }
    response.writeHead(200, { "content-type": type }).end(body);
  }).listen(port, "127.0.0.1", () => console.log(`${variant.padEnd(10)} http://127.0.0.1:${port}`));
}

serve("production", Number(process.argv[2] ?? 4100));
serve("staging", Number(process.argv[3] ?? 4101));
