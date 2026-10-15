/** Platform envelope v1 wraps immutable engine manifests without changing engine schema v1. */
import type { RunManifest, Status } from "../../../packages/visualguard/src/core/types.js";

export type RunStatus = Status | "incomplete";
export interface Project {
  id: string;
  name: string;
  createdAt: string;
  runCount: number;
  role?: "viewer" | "reviewer" | "maintainer";
}
export interface RunMetadata {
  runName?: string;
  environment: string;
  branch?: string;
  commit?: string;
  pullRequest?: number;
  deployment?: string;
}
export interface ArtifactDescriptor {
  path: string;
  hash: string;
  size: number;
  mediaType: "image/png" | "application/json";
}
export interface StoredRun {
  id: string;
  name?: string;
  nameVersion?: number;
  projectId: string;
  engineRunId: string;
  number: number;
  startedAt: string;
  importedAt: string;
  durationMs: number;
  mode: RunManifest["mode"];
  status: RunStatus;
  complete: boolean;
  completenessReasons: string[];
  summary: Record<Status, number>;
  metadata: RunMetadata;
  digest: string;
  jobCount: number;
}
export interface RunDetail extends StoredRun {
  envelopeVersion: 1;
  manifest: RunManifest;
  artifacts: ArtifactDescriptor[];
}
export interface RunFilters {
  project?: string;
  q?: string;
  status?: RunStatus;
  environment?: string;
  branch?: string;
  commit?: string;
  pullRequest?: number;
  deployment?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}
export interface RunPage {
  runs: StoredRun[];
  total: number;
  limit: number;
  offset: number;
}
export function runLabel(run: Pick<StoredRun, "name" | "number">): string {
  return run.name || `Run #${run.number}`;
}
export interface DeletionResult {
  runs: number;
  artifactsDeleted: number;
  cleanupPending: boolean;
}
export const RUN_STATUSES: RunStatus[] = [
  "incomplete",
  "error",
  "regression",
  "review",
  "accepted",
  "pass",
];
