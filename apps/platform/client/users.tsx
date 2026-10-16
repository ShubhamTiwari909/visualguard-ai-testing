import { useEffect, useState, type FormEvent } from "react";
import { mutation, useSession } from "./auth";
import type { Project } from "../shared/contracts";

type Account = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  disabled: boolean;
  version: number;
  methods: string[];
};
type Detail = {
  user: Account;
  memberships: { userId: string; projectId: string; role: string }[];
  after?: string;
  administrationAvailable: boolean;
};
type Directory = { users: Account[]; after?: string; administrationAvailable: boolean };
type Proof = { requiresPassword: boolean; reauthenticationRequired: boolean };
type Action = "disable" | "restore" | "promote" | "demote" | "revoke" | "password";
const methodLabels: Record<string, string> = {
  password: "Password",
  google: "Google",
  oidc: "Company login",
  "legacy-oidc": "Company login (legacy)",
};
const methods = (values: string[]) =>
  values.map((value) => methodLabels[value] ?? value).join(", ") || "No linked sign-in method";
async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Unable to load accounts");
  return value;
}
const consequences: Record<Action, string> = {
  disable:
    "This person will lose access across all projects. All browser sessions and owned upload credentials will be revoked. Memberships and review history remain stored; decisions become pending while the author is unavailable.",
  restore:
    "This person can sign in again with existing login methods. Stored project memberships return, and historical review decisions may become effective again. Previously revoked sessions and upload credentials stay revoked.",
  promote:
    "Workspace administrators can access every project and manage all workspace users. This revokes the person's existing sessions and upload credentials; they must sign in again.",
  demote:
    "This person loses workspace-wide administration and keeps only explicitly assigned project access. Their sessions and upload credentials will be revoked. You cannot demote yourself or remove the last active administrator.",
  revoke:
    "All browser sessions and owned upload credentials will stop working across all projects. The account and memberships stay enabled; the person can sign in again and create new permitted credentials.",
  password:
    "Replace this password account's password and revoke its browser sessions and owned upload credentials. Share the new password privately; it will never be emailed or listed here.",
};
const labels: Record<Action, string> = {
  disable: "Disable account",
  restore: "Restore account",
  promote: "Promote to administrator",
  demote: "Demote to member",
  revoke: "Revoke sessions & upload credentials",
  password: "Reset password",
};

export function UserAdministration({
  projects,
  onChanged,
}: {
  projects: Project[];
  onChanged: () => void;
}) {
  const session = useSession();
  const [directory, setDirectory] = useState<Directory>(),
    [filters, setFilters] = useState("");
  const [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<Detail>(),
    [proof, setProof] = useState<Proof>();
  const [action, setAction] = useState<Action>(),
    [password, setPassword] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    read<Directory>(`/api/users?${filters}`, controller.signal)
      .then(setDirectory)
      .catch((problem: Error) => {
        if (!controller.signal.aborted) setError(problem.message);
      });
    read<Proof>("/api/auth/identities", controller.signal)
      .then(setProof)
      .catch((problem: Error) => {
        if (!controller.signal.aborted) setError(problem.message);
      });
    return () => controller.abort();
  }, [filters, revision]);
  useEffect(() => {
    setDetail(undefined);
    setAction(undefined);
    setPassword("");
    setConfirmed(false);
    if (!selected) return;
    const controller = new AbortController();
    read<Detail>(`/api/users/${encodeURIComponent(selected)}`, controller.signal)
      .then(setDetail)
      .catch((problem: Error) => {
        if (!controller.signal.aborted) setError(problem.message);
      });
    return () => controller.abort();
  }, [selected, revision]);
  const refresh = () => {
    setRevision((value) => value + 1);
    onChanged();
  };
  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget),
      params = new URLSearchParams();
    for (const key of ["query", "role", "status"])
      if (form.get(key)) params.set(key, String(form.get(key)));
    setFilters(params.toString());
    setSelected("");
    setError("");
    setRevision((value) => value + 1);
  };
  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget,
      data = new FormData(form);
    setBusy(true);
    setError("");
    setNotice("");
    void mutation("/api/users", "POST", {
      name: data.get("name"),
      email: data.get("email"),
      password: data.get("password"),
      role: "member",
    })
      .then(() => {
        form.reset();
        setNotice(
          "Member account created. Share the initial password privately. Administrator access requires a separate promotion.",
        );
        refresh();
      })
      .catch((problem: Error) => setError(problem.message))
      .finally(() => setBusy(false));
  };
  const apply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!action || !detail || !confirmed || busy) return;
    const chosen = action,
      account = detail.user,
      form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const input = {
        expectedVersion: account.version,
        ...(proof?.requiresPassword ? { currentPassword: password } : {}),
      };
      if (chosen === "revoke")
        await mutation(
          `/api/users/${encodeURIComponent(account.id)}/revoke-sessions`,
          "POST",
          input,
        );
      else
        await mutation(`/api/users/${encodeURIComponent(account.id)}`, "PATCH", {
          ...input,
          ...(chosen === "disable" || chosen === "restore"
            ? { disabled: chosen === "disable" }
            : {}),
          ...(chosen === "promote" || chosen === "demote"
            ? { role: chosen === "promote" ? "admin" : "member" }
            : {}),
          ...(chosen === "password" ? { password: form.get("newPassword") } : {}),
        });
      if (account.id === session.user?.id) {
        window.location.assign("/");
        return;
      }
      setNotice(`${labels[chosen]} completed. Old sessions and upload credentials stay revoked.`);
      refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Unable to update account");
    } finally {
      setPassword("");
      setConfirmed(false);
      setBusy(false);
    }
  };
  const choose = (value: Action) => {
    setAction(value);
    setPassword("");
    setConfirmed(false);
    setError("");
  };
  return (
    <section className="vg-panel vg-settings-section">
      <h2>Workspace accounts</h2>
      <p className="vg-muted">
        Search members, inspect project access, and manage workspace roles. Administrators can
        access every project.
      </p>
      {error && (
        <p role="alert" className="vg-form-error">
          {error}{" "}
          <button className="vg-button" disabled={busy} onClick={refresh}>
            Refresh accounts
          </button>
        </p>
      )}
      {notice && (
        <p role="status" className="vg-settings-note">
          {notice}
        </p>
      )}
      {directory && !directory.administrationAvailable && (
        <p>
          Account changes require SQLite, PostgreSQL, or a MongoDB replica set. Existing sign-in and
          evidence workflows remain available.
        </p>
      )}
      <form className="vg-settings-form" onSubmit={search}>
        <label>
          Search accounts
          <input name="query" maxLength={120} placeholder="Name, email or account ID" />
        </label>
        <label>
          Workspace role filter
          <select name="role">
            <option value="">All roles</option>
            <option value="admin">Administrators</option>
            <option value="member">Members</option>
          </select>
        </label>
        <label>
          Account status filter
          <select name="status">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <button className="vg-button" disabled={busy}>
          Search
        </button>
      </form>
      <div className="vg-table-scroll">
        <table className="vg-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Sign-in methods</th>
              <th>Workspace role</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {directory?.users.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.name}</strong>
                  <small className="vg-table-secondary">{user.email}</small>
                </td>
                <td>{methods(user.methods)}</td>
                <td>{user.role}</td>
                <td>{user.disabled ? "Disabled" : "Active"}</td>
                <td>
                  <button
                    className="vg-button"
                    disabled={busy}
                    onClick={() => {
                      setSelected(user.id);
                      setRevision((value) => value + 1);
                    }}
                  >
                    Manage {user.name}
                  </button>
                </td>
              </tr>
            ))}
            {directory?.users.length === 0 && (
              <tr>
                <td colSpan={5}>No matching accounts on this page.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {directory?.after && (
        <button
          className="vg-button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            const params = new URLSearchParams(filters);
            params.set("after", directory.after!);
            void read<Directory>(`/api/users?${params}`)
              .then((next) => setDirectory({ ...next, users: [...directory.users, ...next.users] }))
              .catch((problem: Error) => setError(problem.message))
              .finally(() => setBusy(false));
          }}
        >
          Load more accounts
        </button>
      )}
      {detail && (
        <section aria-label="Account details" className="vg-settings-section vg-user-details">
          <h3>{detail.user.name}</h3>
          <p>
            {detail.user.email} · {detail.user.role} ·{" "}
            {detail.user.disabled ? "Disabled" : "Active"}
          </p>
          <p>Sign in with: {methods(detail.user.methods)}</p>
          <h4>Project memberships</h4>
          {detail.user.role === "admin" && (
            <p>
              Workspace administrator access applies to all projects, in addition to any memberships
              below.
            </p>
          )}
          {!detail.memberships.length && <p>No explicit project memberships.</p>}
          <ul>
            {detail.memberships.map((member) => (
              <li key={member.projectId}>
                {projects.find((project) => project.id === member.projectId)?.name ??
                  member.projectId}
                : {member.role}
              </li>
            ))}
          </ul>
          {detail.after && (
            <button
              className="vg-button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void read<Detail>(
                  `/api/users/${encodeURIComponent(selected)}?after=${encodeURIComponent(detail.after!)}`,
                )
                  .then((next) =>
                    setDetail({
                      ...next,
                      memberships: [...detail.memberships, ...next.memberships],
                    }),
                  )
                  .catch((problem: Error) => setError(problem.message))
                  .finally(() => setBusy(false));
              }}
            >
              Load more project memberships
            </button>
          )}
          <p>
            Removing project membership affects one project. Disabling an account affects the entire
            workspace. Stored review decisions may become effective again after access is restored.
          </p>
          <div className="vg-settings-form">
            {detail.user.id !== session.user?.id && (
              <>
                <button
                  className="vg-button"
                  disabled={busy || !detail.administrationAvailable}
                  onClick={() => choose(detail.user.disabled ? "restore" : "disable")}
                >
                  {detail.user.disabled ? "Restore account" : "Disable account"}
                </button>
                <button
                  className="vg-button"
                  disabled={busy || !detail.administrationAvailable}
                  onClick={() => choose(detail.user.role === "admin" ? "demote" : "promote")}
                >
                  {detail.user.role === "admin" ? "Demote to member" : "Promote to administrator"}
                </button>
              </>
            )}
            <button
              className="vg-button"
              disabled={busy || !detail.administrationAvailable}
              onClick={() => choose("revoke")}
            >
              Revoke sessions & upload credentials
            </button>
            {detail.user.methods.includes("password") && (
              <button
                className="vg-button"
                disabled={busy || !detail.administrationAvailable}
                onClick={() => choose("password")}
              >
                Reset password
              </button>
            )}
          </div>
          {action && (
            <form
              className="vg-user-confirmation"
              key={`${selected}:${action}`}
              onSubmit={(event) => {
                void apply(event);
              }}
            >
              <h4>{labels[action]}</h4>
              <p>{consequences[action]}</p>
              {proof?.reauthenticationRequired && (
                <p role="alert">Sign out and sign in again before continuing.</p>
              )}
              {proof?.requiresPassword && (
                <label className="vg-settings-project">
                  Your current administrator password
                  <input
                    type="password"
                    autoComplete="current-password"
                    maxLength={256}
                    required
                    value={password}
                    disabled={busy}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
              )}
              {action === "password" && (
                <label className="vg-settings-project">
                  New password for this account
                  <input
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={256}
                    required
                  />
                </label>
              )}
              <label className="vg-user-confirmation-check">
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />{" "}
                I understand these changes and want to continue.
              </label>
              <div className="vg-settings-form">
                <button
                  className="vg-button vg-button-primary"
                  disabled={busy || !proof || proof.reauthenticationRequired || !confirmed}
                >
                  {busy ? "Saving…" : `Confirm: ${labels[action]}`}
                </button>
                <button
                  type="button"
                  className="vg-button"
                  disabled={busy}
                  onClick={() => setAction(undefined)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>
      )}
      <details>
        <summary>Create a password member account</summary>
        <p>
          Use invitations for Google onboarding. Password accounts are created as members, with no
          project access until explicitly assigned.
        </p>
        <form className="vg-settings-form" onSubmit={create}>
          <label>
            Name
            <input name="name" required maxLength={120} />
          </label>
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required maxLength={254} />
          </label>
          <label>
            Initial password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={256}
              required
            />
          </label>
          <button className="vg-button" disabled={busy || !directory?.administrationAvailable}>
            Create member account
          </button>
        </form>
      </details>
    </section>
  );
}
