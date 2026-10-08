// A tiny dev server for fixer tests: serves <dir> like the fixture server ("/x" → x.html).
// Usage: node static-site-server.mjs <dir> <port>
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? ".");
const port = Number(process.argv[3] ?? 4300);
const types = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".css": "text/css" };
createServer((request, response) => {
  let path = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
  if (path.endsWith("/")) path += "index";
  const file = [join(dir, path), join(dir, `${path}.html`)].find(
    (candidate) =>
      candidate.startsWith(dir) && existsSync(candidate) && statSync(candidate).isFile(),
  );
  if (!file) return response.writeHead(404).end("Not found");
  response
    .writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" })
    .end(readFileSync(file));
}).listen(port, "127.0.0.1");
