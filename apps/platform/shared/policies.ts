export type AssessmentStatus = "pending" | "satisfied" | "blocked" | "error";
export interface VisualPolicy {
  mode: "informative" | "required";
  baselineSet: string;
  targetBranch: string;
  environment: string;
  requiredChecks: string[];
  requireApproval: boolean;
  maxAgeHours: number;
  repository?: string;
  exceptions: { revision: string; jobId: string; reason: string; expiresAt: string }[];
}
export interface PolicyVersion extends VisualPolicy {
  projectId: string;
  version: number;
  at: string;
  actor: { id: string; name: string };
  reason: string;
}
export interface PolicyHistory {
  current?: PolicyVersion;
  versions: PolicyVersion[];
  canEdit: boolean;
  githubConfigured: boolean;
}
export interface PolicyAssessment {
  projectId: string;
  revision: string;
  runId?: string;
  evidenceDigest?: string;
  policyVersion: number;
  baselineVersion?: number;
  mode: VisualPolicy["mode"];
  status: AssessmentStatus;
  reasons: string[];
  waivedChecks: string[];
  assessedAt: string;
  fingerprint: string;
}
export interface PolicyDelivery {
  projectId: string;
  pullRequest: number;
  revision: string;
  repository?: string;
  closed?: boolean;
  assessment?: PolicyAssessment;
  checkId?: number;
  checkUrl?: string;
  error?: string;
  updatedAt: string;
}
