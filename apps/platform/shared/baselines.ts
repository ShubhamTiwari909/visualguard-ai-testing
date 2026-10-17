import type { ArtifactDescriptor } from "./contracts.js";

export interface BaselineReference {
  projectId: string;
  set: string;
  version: number;
  checkKey: string;
  runId: string;
  evidenceDigest: string;
  sourceRevision: string;
  targetRevision: string;
  promotedAt: string;
  policyVersion: 1;
}
export interface BaselineEntry {
  key: string;
  jobId: string;
  name: string;
  route: string;
  viewport: string;
  renderingIdentity: unknown;
  image: ArtifactDescriptor;
  dom?: ArtifactDescriptor;
  health: unknown;
  review: { eventId: string; actorId: string; scopeDigest: string };
}
export interface BaselineVersion {
  projectId: string;
  set: string;
  version: number;
  parentVersion: number;
  restoredFrom?: number;
  runId: string;
  evidenceDigest: string;
  sourceRevision: string;
  targetRevision: string;
  promotedAt: string;
  actor: { id: string; name: string };
  reason: string;
  coverageChangeReason?: string;
  policyVersion: 1;
  entries: BaselineEntry[];
}
export type BaselineSummary = Omit<BaselineVersion, "entries"> & { checkCount: number };
export interface BaselineHistory {
  currentVersion: number;
  items: BaselineSummary[];
  nextCursor?: string;
  canPromote: boolean;
}
