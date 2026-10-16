/** Validate the engine's known v1 fields while preserving unknown historical evidence. */
import { z } from "zod";
import type { RunManifest } from "../../../packages/visualguard/src/core/types.js";
import { PlatformError } from "./errors.js";
import type { RunMetadata } from "../shared/contracts.js";

const finite = z.number().finite().nonnegative();
const size = z.object({ width: finite.positive(), height: finite.positive() }).passthrough();
const box = z
  .object({ x: z.number().finite(), y: z.number().finite(), width: finite, height: finite })
  .passthrough();
const delta = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("style"),
      selector: z.string(),
      property: z.string(),
      production: z.string(),
      staging: z.string(),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("text"),
      selector: z.string(),
      production: z.string(),
      staging: z.string(),
    })
    .passthrough(),
  z
    .object({ kind: z.literal("box"), selector: z.string(), production: box, staging: box })
    .passthrough(),
  z
    .object({
      kind: z.literal("presence"),
      selector: z.string(),
      presentIn: z.enum(["production", "staging"]),
    })
    .passthrough(),
]);
const status = z.enum(["pass", "accepted", "review", "regression", "error"]);
const capture = z
  .object({
    image: z.string().min(1),
    dom: z.string().optional(),
    size,
    health: z
      .object({
        consoleErrors: z.array(z.string()),
        failedRequests: z.array(z.string()),
        brokenImages: z.array(z.string()),
        accessibility: z
          .array(
            z
              .object({
                id: z.string(),
                impact: z.enum(["minor", "moderate", "serious", "critical"]),
                help: z.string(),
                helpUrl: z.string().regex(/^https?:\/\//),
                count: finite.int(),
                targets: z.array(z.string()),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough(),
    durationMs: finite,
    attempts: finite,
  })
  .passthrough();
const job = z
  .object({
    id: z.string().min(1),
    route: z.string(),
    name: z.string(),
    viewport: z.string(),
    status,
    durationMs: finite,
    urls: z.object({ production: z.string(), staging: z.string() }).passthrough(),
    captures: z
      .object({ production: capture.optional(), staging: capture.optional() })
      .passthrough(),
    diff: z
      .object({
        width: finite,
        height: finite,
        diffPixels: finite,
        diffRatio: finite.max(1),
        image: z.string().optional(),
      })
      .passthrough()
      .optional(),
    regions: z.array(
      z
        .object({
          id: finite,
          box,
          diffPixels: finite,
          crops: z
            .object({ production: z.string(), staging: z.string(), diff: z.string() })
            .optional(),
          elements: z.array(
            z.object({ selector: z.string(), tag: z.string(), box: box.optional() }).passthrough(),
          ),
          deltas: z.array(delta),
        })
        .passthrough(),
    ),
    findings: z
      .array(
        z
          .object({
            severity: z.enum(["regression", "review", "info"]),
            message: z.string(),
            source: z.enum(["health", "heuristic", "baseline"]),
          })
          .passthrough(),
      )
      .optional(),
    analysis: z
      .object({
        title: z.string(),
        summary: z.string(),
        classification: z.string(),
        confidence: finite.max(1),
        provider: z.string(),
        model: z.string(),
        promptVersion: z.string(),
        cached: z.boolean(),
        evidence: z.array(z.string()),
        affected: z.array(z.object({ selector: z.string() }).passthrough()),
        intent: z
          .object({ title: z.string(), changedFiles: z.array(z.string()) })
          .passthrough()
          .optional(),
        suggestedFix: z
          .object({ description: z.string(), snippet: z.string().optional() })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    error: z
      .object({ stage: z.enum(["capture", "diff", "mapping", "ai"]), message: z.string() })
      .passthrough()
      .optional(),
  })
  .passthrough();
const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    number: finite.int(),
    startedAt: z
      .string()
      .refine((value) => Number.isFinite(Date.parse(value)), "Invalid start time"),
    durationMs: finite,
    mode: z.enum(["compare", "baseline", "scan", "monitor"]),
    incomplete: z.boolean().optional(),
    shard: z
      .object({ index: z.number().int().positive(), total: z.number().int().positive() })
      .optional(),
    provenance: z
      .object({
        group: z.string(),
        fingerprint: z.string(),
        sourceRevision: z.string().optional(),
        expectedJobs: z.array(z.string()),
      })
      .passthrough()
      .optional(),
    tool: z.object({ version: z.string() }).passthrough(),
    config: z
      .object({
        baseURL: z
          .object({ production: z.string().optional(), staging: z.string().optional() })
          .passthrough(),
        viewports: z.record(z.string(), size),
        ai: z.object({ provider: z.string() }).passthrough(),
        failOn: z.enum(["regression", "review", "any"]),
      })
      .passthrough(),
    summary: z.object({
      pass: finite.int(),
      accepted: finite.int(),
      review: finite.int(),
      regression: finite.int(),
      error: finite.int(),
    }),
    jobs: z.array(job).max(25_000),
  })
  .passthrough();

export function parseManifest(value: unknown): RunManifest {
  const result = manifestSchema.safeParse(value);
  if (!result.success) {
    const problem = result.error.issues[0];
    throw new PlatformError(
      400,
      `Unsupported or invalid run manifest at ${problem?.path.join(".") || "root"}: ${problem?.message}`,
    );
  }
  const manifest = result.data as unknown as RunManifest;
  const ids = manifest.jobs.map((item) => item.id);
  if (new Set(ids).size !== ids.length)
    throw new PlatformError(400, "Run contains duplicate job IDs");
  if (
    manifest.provenance &&
    new Set(manifest.provenance.expectedJobs).size !== manifest.provenance.expectedJobs.length
  )
    throw new PlatformError(400, "Expected scope contains duplicate job IDs");
  if (manifest.shard && manifest.shard.index > manifest.shard.total)
    throw new PlatformError(400, "Invalid shard index");
  // Return the original object: validation never discards or rewrites engine evidence.
  return value as RunManifest;
}

const metadataSchema = z
  .object({
    environment: z.string().trim().min(1).max(100),
    runName: z.string().trim().min(1).max(120).optional(),
    branch: z.string().max(300).optional(),
    commit: z.string().max(200).optional(),
    pullRequest: z.number().int().positive().max(2_147_483_647).optional(),
    deployment: z.string().max(500).optional(),
  })
  .strict();

export function parseMetadata(value: unknown): RunMetadata {
  const result = metadataSchema.safeParse(value);
  if (!result.success)
    throw new PlatformError(
      400,
      "Invalid run name, environment, branch, commit, PR, or deployment metadata",
    );
  return result.data;
}

export function projectId(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(value))
    throw new PlatformError(
      400,
      "Project ID must contain 1–63 lowercase letters, numbers, or hyphens",
    );
  return value;
}

export function artifactPath(value: string): string {
  if (
    !value ||
    value.length > 1000 ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    value.split("/").some((part) => !part || part === "." || part === "..") ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)
  )
    throw new PlatformError(400, "Artifact paths must be relative paths inside the run directory");
  return value;
}
