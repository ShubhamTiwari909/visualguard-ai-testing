import type { IncomingMessage, ServerResponse } from "node:http";
import { PlatformError } from "./errors.js";

export function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); response.end(JSON.stringify(value));
}
export async function readBytes(request: IncomingMessage, limit: number): Promise<Buffer> {
  const parsed = (request as IncomingMessage & { body?: unknown }).body;
  if (parsed !== undefined) {
    const data = Buffer.isBuffer(parsed) ? parsed : Buffer.from(typeof parsed === "string" ? parsed : JSON.stringify(parsed));
    if (data.length > limit) throw new PlatformError(413, "Request body too large"); return data;
  }
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > limit) throw new PlatformError(413, "Request body too large"); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
export async function body(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new PlatformError(415, "Expected application/json");
  const data = await readBytes(request, 16_384);
  try { return JSON.parse(data.toString("utf8")); } catch { throw new PlatformError(400, "Invalid JSON body"); }
}
