/** Import saved evidence, not executable HTML or cookies. Database publication is the final step. */
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { RunManifest, Status } from "../../../packages/visualguard/src/core/types.js";
import type { ArtifactDescriptor, RunMetadata, RunStatus } from "../shared/contracts.js";
import type { ArtifactStore } from "./artifacts.js";
import { sha256 } from "./artifacts.js";
import { PlatformError } from "./errors.js";
import type { PlatformRepository } from "./storage-contracts.js";
import { artifactPath, parseManifest, parseMetadata } from "./validation.js";

export const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
export const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_RUN_BYTES = 512 * 1024 * 1024;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function requiredArtifacts(manifest: RunManifest): string[] {
  const paths = new Set<string>();
  for (const job of manifest.jobs) {
    for (const capture of Object.values(job.captures)) {
      if (capture) { paths.add(artifactPath(capture.image)); if (capture.dom) paths.add(artifactPath(capture.dom)); }
    }
    if (job.diff?.image) paths.add(artifactPath(job.diff.image));
    for (const region of job.regions) for (const path of Object.values(region.crops ?? {})) paths.add(artifactPath(path));
  }
  return [...paths].sort();
}

export function completeness(manifest: RunManifest): string[] {
  const reasons: string[] = [];
  if (manifest.incomplete) reasons.push("Engine marked this run incomplete");
  if (manifest.shard && manifest.shard.total > 1) reasons.push("Individual shard: merge the complete execution before relying on coverage");
  if (!manifest.jobs.length) reasons.push("No checks were captured");
  if (manifest.provenance) {
    const actual = new Set(manifest.jobs.map((job) => job.id));
    const expected = new Set(manifest.provenance.expectedJobs);
    if (expected.size !== actual.size || [...expected].some((id) => !actual.has(id))) reasons.push("Captured checks do not match the recorded expected scope");
  }
  for (const job of manifest.jobs) {
    if (job.status === "error") continue;
    if (!job.captures.production || !job.captures.staging) reasons.push(`Check ${job.id} is missing a reference or candidate capture`);
  }
  return reasons;
}

const statuses: Status[] = ["error", "regression", "review", "accepted", "pass"];

export async function readRunFile(root: string, path: string, limit: number): Promise<Buffer> {
  artifactPath(path);
  const resolved = await realpath(join(root, path));
  const inside = relative(root, resolved);
  if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new PlatformError(400, "Artifact resolves outside the run directory");
  const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new PlatformError(400, `Invalid or oversized run file: ${path}`);
    const data = await handle.readFile();
    if (data.length > limit) throw new PlatformError(400, `Oversized run file: ${path}`);
    return data;
  } finally { await handle.close(); }
}

export async function importRun(repository: PlatformRepository, store: ArtifactStore, input: { projectId: string; runDir: string; metadata: RunMetadata }) {
  const root = await realpath(input.runDir);
  const manifest = parseManifest(JSON.parse((await readRunFile(root, "manifest.json", MAX_MANIFEST_BYTES)).toString("utf8")));
  const metadata = parseMetadata({ ...input.metadata, commit: input.metadata.commit ?? manifest.provenance?.sourceRevision });
  const artifacts: ArtifactDescriptor[] = [];
  let bytes = 0;
  for (const path of requiredArtifacts(manifest)) {
    const data = await readRunFile(root, path, MAX_ARTIFACT_BYTES);
    bytes += data.length;
    if (bytes > MAX_RUN_BYTES) throw new PlatformError(400, "Run exceeds the 512 MB artifact budget");
    let mediaType: ArtifactDescriptor["mediaType"];
    if (path.endsWith(".png") && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mediaType = "image/png";
    else if (path.endsWith(".json")) { JSON.parse(data.toString("utf8")); mediaType = "application/json"; }
    else throw new PlatformError(400, `Unsupported evidence type: ${path}; only PNG and JSON artifacts are imported`);
    artifacts.push({ path, hash: await store.put(data), size: data.length, mediaType });
  }
  const reasons = completeness(manifest);
  const summary = { pass: 0, accepted: 0, review: 0, regression: 0, error: 0 };
  for (const job of manifest.jobs) summary[job.status]++;
  const status: RunStatus = reasons.length ? "incomplete" : statuses.find((value) => summary[value] > 0) ?? "incomplete";
  const digest = sha256(canonical({ envelopeVersion: 1, manifest, metadata, artifacts }));
  return repository.insertRun({
    envelopeVersion: 1, projectId: input.projectId, engineRunId: manifest.id,
    number: manifest.number, startedAt: new Date(manifest.startedAt).toISOString(), importedAt: new Date().toISOString(),
    durationMs: manifest.durationMs, mode: manifest.mode, status, complete: reasons.length === 0,
    completenessReasons: reasons, summary, metadata, digest, jobCount: manifest.jobs.length,
    manifest, artifacts,
  });
}
