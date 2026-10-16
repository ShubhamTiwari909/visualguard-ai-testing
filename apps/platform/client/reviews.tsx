import { useEffect, useState, type FormEvent } from "react";
import type { Project, RunDetail } from "../shared/contracts";
import type { ReviewAction, ReviewInboxPage, ReviewPerson, ReviewView } from "../shared/reviews";
import { api, artifactUrl } from "./api";
import { mutation, useSession } from "./auth";

const statusLabels: Record<string, string> = {
  pending: "Needs review",
  approved: "Visual change approved",
  rejected: "Changes requested",
};
const statusLabel = (status: string) => statusLabels[status] ?? status;
const actionLabels: Record<string, string> = {
  comment: "Commented",
  assign: "Updated assignment",
  approve_visual_change: "Approved visual change",
  reject_visual_change: "Requested changes",
  withdraw_decision: "Withdrew decision",
};
const actionLabel = (action: string) => actionLabels[action] ?? action;
const problemText = (problem: unknown) =>
  problem instanceof Error ? problem.message : "Unable to save review";

export function RunReviews({ run, initialJob }: { run: RunDetail; initialJob?: string }) {
  const [jobId, setJobId] = useState(initialJob ?? run.manifest.jobs[0]?.id ?? "");
  const [view, setView] = useState<ReviewView>();
  const [reviewers, setReviewers] = useState<ReviewPerson[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const [assigneeId, setAssigneeId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [assignmentReason, setAssignmentReason] = useState("");
  const job = run.manifest.jobs.find((item) => item.id === jobId);
  useEffect(() => {
    if (!jobId) return;
    const abort = new AbortController();
    setView(undefined);
    setError("");
    Promise.allSettled([
      api.review(run.id, jobId, abort.signal),
      api.reviewers(run.projectId, abort.signal),
    ])
      .then(([thread, people]) => {
        if (abort.signal.aborted) return;
        if (thread.status === "rejected") {
          setError(problemText(thread.reason));
          return;
        }
        setView(thread.value);
        setReviewers(people.status === "fulfilled" ? people.value.reviewers : []);
        if (people.status === "rejected" && thread.value.canReview)
          setError(
            `Review loaded, but reviewer choices could not be loaded: ${problemText(people.reason)}. You can still comment or record a decision.`,
          );
        setAssigneeId(thread.value.assignee?.id ?? "");
        // Keep a UTC date in the input so the deadline is explicit across teams/time zones.
        setDueAt(thread.value.dueAt?.slice(0, 16) ?? "");
      })
      .catch((problem: unknown) => {
        if (!abort.signal.aborted) setError(problemText(problem));
      });
    return () => abort.abort();
  }, [run.id, run.projectId, jobId, revision]);

  const save = async (event: ReviewAction) => {
    if (!view || pending) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const next = await mutation<ReviewView>(
        `/api/runs/${encodeURIComponent(run.id)}/reviews`,
        "POST",
        {
          jobId,
          evidenceDigest: view.evidenceDigest,
          scopeDigest: view.scopeDigest,
          expectedVersion: view.version,
          event,
        },
      );
      setView(next);
      if (event.action === "assign") {
        setAssignmentReason("");
        setAssigneeId(next.assignee?.id ?? "");
        setDueAt(next.dueAt?.slice(0, 16) ?? "");
      } else {
        setReason("");
        setReplyTo("");
      }
      setNotice("Review saved for this check and this capture.");
    } catch (problem) {
      setError(
        `${problemText(problem)}. Your draft is kept. Refresh the thread, review the latest history, then submit again.`,
      );
    } finally {
      setPending(false);
    }
  };
  const comment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save({ action: "comment", reason, ...(replyTo ? { replyTo } : {}) });
  };
  if (!run.manifest.jobs.length) return null;
  return (
    <section className="vg-panel vg-review-panel" id="reviews" aria-labelledby="review-title">
      <div className="vg-panel-heading">
        <div>
          <h2 id="review-title">Team review</h2>
          <p>Review one check at a time. Decisions stay attached to this exact capture.</p>
        </div>
        <a className="vg-button" href={`/reviews?project=${encodeURIComponent(run.projectId)}`}>
          Review inbox
        </a>
      </div>
      <div className="vg-review-body">
        <div className="vg-review-toolbar">
          <label>
            Check
            <select
              value={jobId}
              disabled={pending}
              onChange={(event) => {
                setJobId(event.target.value);
                setReason("");
                setReplyTo("");
                setAssignmentReason("");
                setNotice("");
              }}
            >
              {!job && <option value={jobId}>Unknown check</option>}
              {run.manifest.jobs.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name} · {item.viewport}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="vg-button"
            disabled={pending}
            onClick={() => setRevision((value) => value + 1)}
          >
            Refresh thread
          </button>
          <a href={`/runs/${run.id}?review=${encodeURIComponent(jobId)}#reviews`}>
            Link to this review
          </a>
        </div>
        {error && (
          <p role="alert" className="vg-form-error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {!view && !error && <p role="status">Loading review…</p>}
        {view && job && (
          <>
            <p className={`vg-review-state vg-review-state-${view.status}`}>
              {statusLabel(view.status)}
            </p>
            {view.invalidDecisionReason && (
              <p className="vg-warning">{view.invalidDecisionReason} A new review is needed.</p>
            )}
            <p className="vg-muted">
              {job.route} · {job.viewport} · Revision: {view.sourceRevision ?? "Not supplied"}
            </p>
            <div className="vg-review-images">
              {(["production", "staging"] as const).map((side) => {
                const capture = job.captures[side];
                return (
                  <figure key={side}>
                    <figcaption>{side === "production" ? "Reference" : "Candidate"}</figcaption>
                    {capture ? (
                      <a href={artifactUrl(run.id, capture.image)} target="_blank" rel="noreferrer">
                        <img
                          src={artifactUrl(run.id, capture.image)}
                          alt={`${side === "production" ? "Reference" : "Candidate"} for ${job.name}`}
                          loading="lazy"
                        />
                      </a>
                    ) : (
                      <p>Capture unavailable</p>
                    )}
                  </figure>
                );
              })}
            </div>
            <p className="vg-warning">
              A visual approval covers all visual changes in this check. It does not clear health,
              accessibility, performance, capture errors, or incomplete coverage, and does not
              approve a release or promote a baseline. Request changes if any visual defect remains.
            </p>
            {!!job.findings?.length && (
              <details>
                <summary>Captured findings ({job.findings.length})</summary>
                <ul>
                  {job.findings.map((finding, index) => (
                    <li key={index}>
                      {finding.severity} · {finding.source}: {finding.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p>
              Assigned to <strong>{view.assignee?.name ?? "Nobody"}</strong>
              {view.assignee &&
                !view.assigneeAvailable &&
                " (reviewer access removed; reassign this check)"}
              {view.dueAt && (
                <>
                  {" "}
                  · Due <time dateTime={view.dueAt}>{new Date(view.dueAt).toLocaleString()}</time>
                </>
              )}
              {view.overdue && <strong> · Overdue</strong>}
            </p>
            {view.canReview && (
              <form
                className="vg-review-assignment"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save({
                    action: "assign",
                    reason: assignmentReason,
                    assigneeId: assigneeId || null,
                    dueAt: assigneeId && dueAt ? `${dueAt}:00.000Z` : null,
                  });
                }}
              >
                <fieldset disabled={pending}>
                  <legend>Assign a reviewer</legend>
                  <label>
                    Reviewer
                    <select
                      value={assigneeId}
                      onChange={(event) => setAssigneeId(event.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {view.assignee &&
                        !reviewers.some((item) => item.id === view.assignee!.id) && (
                          <option value={view.assignee.id} disabled>
                            {view.assignee.name} (unavailable)
                          </option>
                        )}
                      {reviewers.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Deadline (UTC, optional)
                    <input
                      type="datetime-local"
                      value={dueAt}
                      disabled={!assigneeId}
                      onChange={(event) => setDueAt(event.target.value)}
                    />
                  </label>
                  <label>
                    Assignment note
                    <input
                      value={assignmentReason}
                      onChange={(event) => setAssignmentReason(event.target.value)}
                      maxLength={4000}
                      required
                    />
                  </label>
                  <button className="vg-button" disabled={!assignmentReason.trim()}>
                    {pending ? "Saving…" : "Save assignment"}
                  </button>
                </fieldset>
              </form>
            )}
            <h3>Discussion & decision history</h3>
            {!view.events.length && (
              <p className="vg-muted">
                No review yet. Add a comment or assign this check to start.
              </p>
            )}
            <ol className="vg-review-events">
              {view.events.map((event) => (
                <li key={event.id} id={`review-event-${event.id}`}>
                  <div>
                    <strong>{event.actor.name}</strong> · {actionLabel(event.action)} ·{" "}
                    <time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time>
                  </div>
                  {event.replyTo && (
                    <a href={`#review-event-${event.replyTo}`}>In reply to an earlier entry</a>
                  )}
                  {event.action === "assign" && (
                    <p>
                      {event.assignee ? `Assigned to ${event.assignee.name}` : "Assignment cleared"}
                      {event.dueAt ? ` · Due ${new Date(event.dueAt).toLocaleString()}` : ""}
                    </p>
                  )}
                  <p className="vg-review-reason">{event.reason}</p>
                  {view.canReview && (
                    <button
                      type="button"
                      className="vg-button"
                      disabled={pending}
                      onClick={() => setReplyTo(event.id)}
                    >
                      Reply
                    </button>
                  )}
                </li>
              ))}
            </ol>
            {view.canReview ? (
              <form onSubmit={comment} className="vg-review-compose">
                <fieldset disabled={pending}>
                  <legend>
                    {replyTo ? "Reply to selected entry" : "Add a comment or decision"}
                  </legend>
                  {replyTo && (
                    <button type="button" className="vg-button" onClick={() => setReplyTo("")}>
                      Cancel reply
                    </button>
                  )}
                  <label>
                    Comment / decision reason
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      required
                      maxLength={4000}
                      rows={3}
                    />
                  </label>
                  <div className="vg-review-toolbar">
                    <button className="vg-button" disabled={!reason.trim()}>
                      Post comment
                    </button>
                    {!replyTo && (
                      <>
                        <button
                          type="button"
                          className="vg-button vg-button-primary"
                          disabled={!reason.trim() || !view.visualReviewAvailable}
                          onClick={() => void save({ action: "approve_visual_change", reason })}
                        >
                          Approve visual change
                        </button>
                        <button
                          type="button"
                          className="vg-button vg-button-danger"
                          disabled={!reason.trim() || !view.visualReviewAvailable}
                          onClick={() => void save({ action: "reject_visual_change", reason })}
                        >
                          Request changes
                        </button>
                        {view.decision && view.decision.action !== "withdraw_decision" && (
                          <button
                            type="button"
                            className="vg-button"
                            disabled={!reason.trim()}
                            onClick={() => void save({ action: "withdraw_decision", reason })}
                          >
                            Withdraw decision
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {!view.visualReviewAvailable && (
                    <p>
                      Visual decisions need a successfully compared reference and candidate. You can
                      still discuss and assign this check.
                    </p>
                  )}
                </fieldset>
              </form>
            ) : (
              <p className="vg-muted">
                Viewer access: you can read reviews. Ask a project maintainer for Reviewer access to
                participate.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function ReviewInbox({ projects, search }: { projects: Project[]; search: string }) {
  const session = useSession();
  const params = new URLSearchParams(search);
  const [project, setProject] = useState(params.get("project") ?? projects[0]?.id ?? "");
  const [owner, setOwner] = useState("mine");
  const [status, setStatus] = useState("open");
  const [overdue, setOverdue] = useState(false);
  const [after, setAfter] = useState("");
  const [previous, setPrevious] = useState<string[]>([]);
  const [page, setPage] = useState<ReviewInboxPage>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    document.title = "Review inbox · VisualGuard";
  }, []);
  useEffect(() => {
    const selected = projects.find(
      (item) => item.id === project || item.publicId === project || item.aliases?.includes(project),
    );
    if (selected && selected.id !== project) {
      setProject(selected.id);
      setAfter("");
      setPrevious([]);
    } else if (!project && projects.length) setProject(projects[0]!.id);
  }, [project, projects]);
  useEffect(() => {
    if (!project) return;
    const abort = new AbortController();
    setPage(undefined);
    setError("");
    api
      .reviewInbox(
        new URLSearchParams({
          project,
          owner,
          status,
          overdue: String(overdue),
          ...(after ? { after } : {}),
        }).toString(),
        abort.signal,
      )
      .then((value) => {
        if (!abort.signal.aborted) setPage(value);
      })
      .catch((problem: unknown) => {
        if (!abort.signal.aborted) setError(problemText(problem));
      });
    return () => abort.abort();
  }, [project, owner, status, overdue, after, revision]);
  const reset = () => {
    setAfter("");
    setPrevious([]);
  };
  return (
    <main className="vg-content">
      <div className="vg-page-heading">
        <div>
          <p className="vg-eyebrow">REVIEW TOGETHER</p>
          <h1>Review inbox</h1>
          <p className="vg-muted">
            Assigned checks, discussion, and visual decisions for your projects.
          </p>
        </div>
      </div>
      <section className="vg-panel">
        <div className="vg-review-body">
          <div className="vg-review-toolbar">
            <label>
              Project
              <select
                value={project}
                onChange={(event) => {
                  setProject(event.target.value);
                  reset();
                }}
              >
                {!projects.length && <option value="">No projects</option>}
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Assignment
              <select
                value={owner}
                onChange={(event) => {
                  setOwner(event.target.value);
                  reset();
                }}
              >
                <option value="mine">Assigned to me ({session.user?.name})</option>
                <option value="unassigned">Unassigned</option>
                <option value="all">Everyone</option>
              </select>
            </label>
            <label>
              Decision
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  reset();
                }}
              >
                <option value="open">Needs attention</option>
                <option value="pending">Awaiting a decision</option>
                <option value="rejected">Changes requested</option>
                <option value="approved">Visual change approved</option>
                <option value="all">All decisions</option>
              </select>
            </label>
            <label className="vg-review-checkbox">
              <input
                type="checkbox"
                checked={overdue}
                onChange={(event) => {
                  setOverdue(event.target.checked);
                  reset();
                }}
              />
              Overdue only
            </label>
            <button className="vg-button" onClick={() => setRevision((value) => value + 1)}>
              Refresh
            </button>
          </div>
          <p className="vg-muted">
            Checks enter this inbox when someone comments, assigns, or records a decision. Open a
            run from history to start reviewing new evidence.
          </p>
          {error && (
            <p className="vg-form-error" role="alert">
              {error}
            </p>
          )}
          {!project ? (
            <p>Create or join a project to see its reviews.</p>
          ) : !page && !error ? (
            <p role="status">Loading reviews…</p>
          ) : null}
        </div>
        {page && (
          <>
            <div className="vg-table-scroll">
              <table className="vg-table">
                <thead>
                  <tr>
                    <th>Check / run</th>
                    <th>Visual review</th>
                    <th>Reviewer</th>
                    <th>Deadline</th>
                    <th>Revision</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((item) => (
                    <tr key={item.cursor}>
                      <td>
                        <a
                          className="vg-run-link"
                          href={`/runs/${item.runId}?review=${encodeURIComponent(item.jobId)}#reviews`}
                        >
                          {item.name} · {item.viewport}
                        </a>
                        <small className="vg-table-secondary">
                          {item.route} · Run #{item.runNumber}
                        </small>
                      </td>
                      <td>{statusLabel(item.status)}</td>
                      <td>
                        {item.assignee?.name ?? "Unassigned"}
                        {item.assignee && !item.assigneeAvailable && (
                          <small className="vg-table-secondary">Access removed</small>
                        )}
                      </td>
                      <td>
                        {item.dueAt ? (
                          <time dateTime={item.dueAt}>{new Date(item.dueAt).toLocaleString()}</time>
                        ) : (
                          "No deadline"
                        )}
                        {item.overdue && <strong className="vg-table-secondary">Overdue</strong>}
                      </td>
                      <td>
                        <code>{item.sourceRevision?.slice(0, 12) ?? "Not supplied"}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!page.items.length && (
              <div className="vg-empty">
                No matching reviews on this page.
                {page.nextCursor ? " Continue to the next page or change filters." : ""}
              </div>
            )}
            <div className="vg-pagination">
              <span>Browse review threads · current project</span>
              <div>
                <button
                  className="vg-button"
                  disabled={!previous.length}
                  onClick={() => {
                    setAfter(previous[previous.length - 1]!);
                    setPrevious((items) => items.slice(0, -1));
                  }}
                >
                  Previous
                </button>
                <button
                  className="vg-button"
                  disabled={!page.nextCursor}
                  onClick={() => {
                    setPrevious((items) => [...items, after]);
                    setAfter(page.nextCursor!);
                  }}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
