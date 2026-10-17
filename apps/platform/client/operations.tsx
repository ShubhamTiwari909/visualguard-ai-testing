import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSession } from "./auth";
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
const recoveryCommands = [
  "pnpm platform:operations admins",
  "pnpm platform:operations preview --user ACCOUNT_ID",
].join("\n");
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

interface AuditSelection {
  filters: string;
  cursors: (string | undefined)[];
  index: number;
  focus?: boolean;
}

export function OperationsPage() {
  const session = useSession();
  useEffect(() => {
    document.title = "Audit & recovery · VisualGuard";
  }, []);
  if (session.access !== "login" || !session.user?.admin)
    return (
      <main className="vg-content">
        <div className="vg-page-heading">
          <div>
            <h1>Audit & recovery</h1>
            <p className="vg-muted">
              This page is available to signed-in workspace administrators.
            </p>
          </div>
        </div>
        <a className="vg-button" href="/settings">
          Back to People & integrations
        </a>
      </main>
    );
  return <WorkspaceOperations />;
}

function WorkspaceOperations() {
  const [status, setStatus] = useState<OperationsStatus>();
  const [statusError, setStatusError] = useState("");
  const [statusPending, setStatusPending] = useState(true);
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState<AuditSelection>({
    filters: "",
    cursors: [undefined],
    index: 0,
  });
  const [loaded, setLoaded] = useState<{ selection: AuditSelection; page: AuditPage }>();
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const auditHeading = useRef<HTMLHeadingElement>(null);
  const filterForm = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setStatusPending(true);
    setStatusError("");
    void get<OperationsStatus>("/api/operations", controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setStatus(value);
      })
      .catch((problem: Error) => {
        if (!controller.signal.aborted) setStatusError(problem.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setStatusPending(false);
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams(selection.filters);
    const cursor = selection.cursors[selection.index];
    if (cursor) query.set("after", cursor);
    setPending(true);
    setError("");
    void get<AuditPage>(`/api/audit?${query}`, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setLoaded({ selection, page });
        if (selection.focus) {
          auditHeading.current?.focus({ preventScroll: true });
          auditHeading.current?.scrollIntoView({ block: "start" });
        }
      })
      .catch((problem: Error) => {
        if (!controller.signal.aborted) setError(problem.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => controller.abort();
  }, [selection]);
  const firstPage = (filters: string, focus = false) => {
    setPending(true);
    setLoaded(undefined);
    setSelection({ filters, cursors: [undefined], index: 0, focus });
  };
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
    firstPage(query.toString(), true);
  };
  const move = (direction: -1 | 1) => {
    if (!loaded || pending) return;
    const current = loaded.selection;
    if (direction === -1 && current.index === 0) return;
    if (direction === 1 && !loaded.page.nextCursor) return;
    setPending(true);
    setSelection({
      ...current,
      cursors:
        direction === 1
          ? [...current.cursors.slice(0, current.index + 1), loaded.page.nextCursor]
          : current.cursors,
      index: current.index + direction,
      focus: true,
    });
  };
  return (
    <main className="vg-content vg-operations-page">
      <div className="vg-page-heading">
        <div>
          <p className="vg-eyebrow">WORKSPACE ADMINISTRATION</p>
          <h1>Audit & recovery</h1>
          <p className="vg-muted">Review workspace activity and keep administrator access ready.</p>
        </div>
        <button
          className="vg-button"
          disabled={pending || statusPending}
          onClick={() => {
            setRevision((value) => value + 1);
            firstPage(selection.filters);
          }}
        >
          Refresh operations
        </button>
      </div>
      <section className="vg-panel vg-settings-section" aria-labelledby="readiness-title">
        <h2 id="readiness-title">Sign-in readiness</h2>
        <p className="vg-muted">A snapshot of your accounts and recovery storage.</p>
        {statusPending && <p role="status">Checking readiness…</p>}
        {statusError && (
          <p role="alert" className="vg-form-error">
            {statusError}
          </p>
        )}
        {status && (
          <>
            <dl className="vg-profile-details vg-readiness-grid">
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
              <div className="vg-readiness-conflicts">
                <p>Search these shared emails in Workspace accounts to inspect ownership:</p>
                <ul>
                  {status.duplicateEmailGroups.map((group) => (
                    <li key={group.email}>
                      {group.email} · {group.accounts} accounts
                      {!status.inventoryComplete && " in the scanned inventory"}
                    </li>
                  ))}
                </ul>
                <a className="vg-button" href="/settings">
                  Open workspace accounts
                </a>
              </div>
            )}
          </>
        )}
      </section>
      <details className="vg-panel vg-settings-section vg-recovery-guide">
        <summary>Administrator recovery</summary>
        <p>
          Recovery is performed by an operator on the dashboard host. It restores an existing
          password administrator and revokes that account’s sessions and upload credentials.
        </p>
        <ol>
          <li>Stop dashboard writers and take a native database backup.</li>
          <li>
            List password administrators and preview the exact account with the host commands below.
          </li>
          <li>
            Follow the workspace recovery runbook with the preview version, backup confirmation and
            a private password file.
          </li>
          <li>
            Restart the dashboard, sign in with the replacement password and verify the recovery
            audit event.
          </li>
        </ol>
        <pre>
          <code>{recoveryCommands}</code>
        </pre>
        <p className="vg-muted">
          Recovery requires a POSIX operator host. Google-only accounts must recover access through
          their provider. Test Google sign-in and a native backup restore before rollout.
        </p>
      </details>
      <section className="vg-panel" aria-labelledby="audit-title" aria-busy={pending}>
        <div className="vg-panel-heading">
          <div>
            <h2 id="audit-title" ref={auditHeading} tabIndex={-1}>
              Audit history
            </h2>
            <p>Up to 50 events per page. Dates and times use UTC.</p>
          </div>
        </div>
        <div className="vg-audit-body">
          <form ref={filterForm} className="vg-settings-form vg-audit-filters" onSubmit={search}>
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
            <div className="vg-form-actions">
              <button className="vg-button vg-button-primary" disabled={pending}>
                Filter activity
              </button>
              <button
                type="button"
                className="vg-button"
                disabled={pending}
                onClick={() => {
                  filterForm.current?.reset();
                  firstPage("", true);
                }}
              >
                Clear filters
              </button>
            </div>
          </form>
          {error && (
            <div role="alert" className="vg-form-error">
              <p>
                {error}
                {loaded && " The previous page is still shown. Try again or choose another page."}
              </p>
              <button
                className="vg-button"
                disabled={pending}
                onClick={() => {
                  setPending(true);
                  setSelection({ ...selection });
                }}
              >
                Try again
              </button>
            </div>
          )}
          <p className="vg-audit-status vg-muted" role="status" aria-live="polite">
            {pending
              ? "Loading workspace activity…"
              : loaded
                ? `Page ${loaded.selection.index + 1} · ${loaded.page.events.length} events on this page`
                : "Activity could not be loaded."}
          </p>
          {!pending && loaded && !loaded.page.events.length && (
            <p className="vg-empty">
              {loaded.page.nextCursor
                ? "No matches in this part of the history. Choose Next page to keep searching."
                : "No activity in this page matches your filters."}
            </p>
          )}
          <ol className="vg-audit-events">
            {loaded?.page.events.map((event) => (
              <li key={event.id}>
                <div className="vg-audit-event-heading">
                  <strong>{actions[event.action] ?? event.action.replaceAll(/[.-]/g, " ")}</strong>
                  <time dateTime={event.at}>{new Date(event.at).toUTCString()}</time>
                </div>
                <p>
                  {event.actorName}
                  {event.actorEmail && ` · ${event.actorEmail}`}
                </p>
                {Object.keys(event.details).length > 0 && (
                  <details>
                    <summary>View event details</summary>
                    <dl className="vg-profile-details">
                      {Object.entries(event.details).map(([key, value]) => (
                        <div key={key}>
                          <dt>{labels[key] ?? key}</dt>
                          <dd>{detail(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
              </li>
            ))}
          </ol>
        </div>
        <nav className="vg-pagination" aria-label="Audit history pages">
          <span>Activity follows the 90-day retention policy.</span>
          <div>
            <button
              className="vg-button"
              disabled={pending || !loaded || loaded.selection.index === 0}
              onClick={() => move(-1)}
            >
              Previous page
            </button>
            <button
              className="vg-button"
              disabled={pending || !loaded?.page.nextCursor}
              onClick={() => move(1)}
            >
              Next page
            </button>
          </div>
        </nav>
      </section>
    </main>
  );
}
