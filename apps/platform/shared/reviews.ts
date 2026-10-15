/** F03 decisions are a separate ledger; they never rewrite engine results or local accepts. */
export type VisualDecision = "approve_visual_change" | "reject_visual_change" | "withdraw_decision";
export type ReviewStatus = "pending" | "approved" | "rejected";
export type ReviewAction =
  | { action: "comment"; reason: string; replyTo?: string }
  | { action: "assign"; reason: string; assigneeId: string | null; dueAt: string | null }
  | { action: VisualDecision; reason: string };
export interface ReviewPerson {
  id: string;
  name: string;
}
export interface ReviewEvent {
  id: string;
  actor: ReviewPerson;
  at: string;
  action: "comment" | "assign" | VisualDecision;
  reason: string;
  replyTo?: string;
  assignee?: ReviewPerson;
  dueAt?: string;
}
export interface ReviewThread {
  projectId: string;
  runId: string;
  jobId: string;
  evidenceDigest: string;
  scopeDigest: string;
  sourceRevision?: string;
  events: ReviewEvent[];
}
export interface ReviewView extends ReviewThread {
  version: number;
  canReview: boolean;
  status: ReviewStatus;
  decision?: ReviewEvent;
  invalidDecisionReason?: string;
  assignee?: ReviewPerson;
  assigneeAvailable: boolean;
  dueAt?: string;
  overdue: boolean;
  visualReviewAvailable: boolean;
}
export interface ReviewInboxItem {
  cursor: string;
  runId: string;
  runNumber: number;
  projectId: string;
  jobId: string;
  name: string;
  route: string;
  viewport: string;
  sourceRevision?: string;
  status: ReviewStatus;
  assignee?: ReviewPerson;
  assigneeAvailable: boolean;
  dueAt?: string;
  overdue: boolean;
  updatedAt: string;
}
export interface ReviewInboxPage {
  items: ReviewInboxItem[];
  nextCursor?: string;
}
