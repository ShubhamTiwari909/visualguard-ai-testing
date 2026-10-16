import { useEffect, useState, type FormEvent } from "react";
import type { AuditEvent, AuditPage, OperationsStatus } from "../shared/operations";

const actions: Record<string, string> = {
  "user.login": "Signed in",
  "user.created": "Account created",
  "user.updated": "Account updated",
  "user.recovered": "Administrator recovered",
  "user.sessions-revoked": "Sessions and upload credentials revoked",
  "password.changed": "Password changed",
  "membership.changed": "Project access changed",
  "project.created": "Project created",
  "project.renamed": "Project renamed",
  "project.deleted": "Project deleted",
  "run.renamed": "Run renamed",
  "run.deleted": "Run deleted",
  "upload-token.created": "Upload credential created",
  "upload-token.revoked": "Upload credential revoked",
  "identity.linked": "Sign-in method linked",
  "invitation.created": "Invitation created",
  "invitation.cancelled": "Invitation cancelled",
  "invitation.accepted": "Invitation accepted",
};
const labels: Record<string, string> = {
  userId: "Account",
  projectId: "Project",
  runId: "Run",
  invitationId: "Invitation",
  role: "Project role",
  provider: "Sign-in provider",
  before: "Before",
  after: "After",
  passwordReset: "Password reset",
  uploadCredentialsRevoked: "Upload credentials revoked",
  reason: "Reason",
  backupAcknowledged: "Backup confirmed",
  name: "Name",
  publicId: "Public project ID",
  created: "Created",
};
function detail(value: AuditEvent["details"][string]): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value !== "object") return String(value);
  return [
    value.role === "admin" ? "Administrator" : value.role === "member" ? "Member" : value.role,
    value.disabled === undefined ? undefined : value.disabled ? "Disabled" : "Active",
  ]
    .filter(Boolean)
    .join(" · ");
}
async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  const value = await response.json();
  if (response.status === 401) window.dispatchEvent(new Event("visualguard-auth-expired"));
  if (!response.ok) throw new Error(value.error ?? "Unable to load workspace operations");
  return value as T;
}

export function WorkspaceOperations() {
  const [status, setStatus] = useState<OperationsStatus>();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [filters, setFilters] = useState("");
  const [next, setNext] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setPending(true);
    setError("");
    setStatus(undefined);
    setEvents([]);
    setNext(undefined);
    void Promise.all([
      get<OperationsStatus>("/api/operations", controller.signal),
      get<AuditPage>(`/api/audit?${filters}`, controller.signal),
    ])
      .then(([readiness, page]) => {
        if (!controller.signal.aborted) {
          setStatus(readiness);
          setEvents(page.events);
          setNext(page.nextCursor);
        }
      })
      .catch((problem: Error) => {
        if (!controller.signal.aborted) setError(problem.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => controller.abort();
  }, [filters, revision]);
  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget),
      query = new URLSearchParams();
    for (const key of ["action", "person"]) {
      const value = String(data.get(key) ?? "").trim();
      if (value) query.set(key, value);
    }
    if (data.get("since")) query.set("since", `${data.get("since")}T00:00:00.000Z`);
    if (data.get("until")) query.set("until", `${data.get("until")}T23:59:59.999Z`);
    setFilters(query.toString());
    setRevision((value) => value + 1);
  };
  const more = async () => {
    if (!next || pending) return;
    setPending(true);
    setError("");
    try {
      const query = new URLSearchParams(filters);
      query.set("after", next);
      const page = await get<AuditPage>(`/api/audit?${query}`);
      setEvents((current) => [...current, ...page.events]);
      setNext(page.nextCursor);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Unable to load more activity");
    } finally {
      setPending(false);
    }
  };
  return (
    <section
      id="operations"
      className="vg-panel vg-settings-section"
      aria-labelledby="operations-title"
    >
      <h2 id="operations-title">Workspace operations</h2>
      <p className="vg-muted">
        Inspect sign-in readiness and review account activity. Dates below use UTC.
      </p>
      <button
        className="vg-button"
        disabled={pending}
        onClick={() => setRevision((value) => value + 1)}
      >
        Refresh operations
      </button>
      {error && (
        <p role="alert" className="vg-form-error">
          {error}
        </p>
      )}
      {pending && <p role="status">Loading workspace activity…</p>}
      {status && (
        <>
          <h3 className="vg-settings-subheading">Sign-in readiness</h3>
          <dl className="vg-profile-details">
            <div>
              <dt>Account recovery storage</dt>
              <dd>{status.transactions ? "Supported" : "Not supported"}</dd>
            </div>
            <div>
              <dt>New account admission</dt>
              <dd>
                {status.admission === "invite"
                  ? "Invitation required"
                  : status.admission === "legacy"
                    ? "Automatic provider account creation"
                    : "Not initialized"}
              </dd>
            </div>
            <div>
              <dt>Active administrators{!status.inventoryComplete && " (scanned accounts)"}</dt>
              <dd>{status.activeAdministrators}</dd>
            </div>
            <div>
              <dt>Password administrators{!status.inventoryComplete && " (scanned accounts)"}</dt>
              <dd>{status.activePasswordAdministrators}</dd>
            </div>
          </dl>
          {status.warnings.map((warning) => (
            <p className="vg-warning" key={warning}>
              {warning}
            </p>
          ))}
          {status.duplicateEmailGroups.length > 0 && (
            <div>
              <p>Search these shared emails in Workspace accounts to inspect ownership:</p>
              <ul>
                {status.duplicateEmailGroups.map((group) => (
                  <li key={group.email}>
                    {group.email} · {group.accounts} accounts
                    {!status.inventoryComplete && " in the scanned inventory"}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="vg-muted">
            Before rollout, test Google sign-in and restore a native backup. Follow your workspace
            operations runbook for administrator recovery on the dashboard host.
          </p>
        </>
      )}
      <h3 className="vg-settings-subheading">Audit history</h3>
      <form className="vg-settings-form" onSubmit={search}>
        <label>
          Person
          <input name="person" placeholder="Name or email" maxLength={120} />
        </label>
        <label>
          Action
          <select name="action">
            <option value="">All actions</option>
            {Object.entries(actions).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          From (UTC)
          <input name="since" type="date" />
        </label>
        <label>
          Through (UTC)
          <input name="until" type="date" />
        </label>
        <button className="vg-button" disabled={pending}>
          Filter activity
        </button>
      </form>
      {!pending && !error && !events.length && (
        <p className="vg-muted">No activity in this page matches your filters.</p>
      )}
      <ol className="vg-audit-events">
        {events.map((event) => (
          <li key={event.id}>
            <strong>{actions[event.action] ?? event.action.replaceAll(/[.-]/g, " ")}</strong>
            <p>
              {event.actorName}
              {event.actorEmail && ` · ${event.actorEmail}`} ·{" "}
              <time dateTime={event.at}>{new Date(event.at).toUTCString()}</time>
            </p>
            <dl className="vg-profile-details">
              {Object.entries(event.details).map(([key, value]) => (
                <div key={key}>
                  <dt>{labels[key] ?? key}</dt>
                  <dd>{detail(value)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>
      {next && (
        <button
          className="vg-button"
          disabled={pending}
          onClick={() => {
            void more();
          }}
        >
          Load more activity
        </button>
      )}
      <p className="vg-muted">
        Activity retention follows the existing 90-day audit policy. Use Load more even after an
        empty filtered page.
      </p>
    </section>
  );
}
