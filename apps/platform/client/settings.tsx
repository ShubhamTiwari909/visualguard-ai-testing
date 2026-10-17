import { useEffect, useState } from "react";
import { mutation, useSession } from "./auth";
import type { Project } from "../shared/contracts";
import { DeleteAction, deletionMessage } from "./delete-action";
import { ProjectNameEditor } from "./naming";
import { InvitationSettings } from "./invitations";
import { UserAdministration } from "./users";
import { AccountIdentity } from "./identities";
import { Profile } from "./profile";

type User = { id: string; name: string; email: string; role: string; disabled: boolean };
type Member = { userId: string; role: string };
type Token = { id: string; name: string; expiresAt: string };
async function get<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error);
  return value as T;
}

export function Settings({
  projects,
  onDeleted,
  onUpdated,
}: {
  projects: Project[];
  onDeleted: (message: string) => void;
  onUpdated: () => void;
}) {
  const session = useSession();
  useEffect(() => {
    document.title = "People & integrations · VisualGuard";
  }, []);
  const managed = projects.filter(
    (project) => session.user?.admin || project.role === "maintainer",
  );
  const [users, setUsers] = useState<User[]>([]),
    [members, setMembers] = useState<Member[]>([]),
    [tokens, setTokens] = useState<Token[]>([]);
  const [project, setProject] = useState(managed[0]?.id ?? ""),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [issued, setIssued] = useState(""),
    [revision, setRevision] = useState(0);
  const [accountSearch, setAccountSearch] = useState("");
  const [searchingAccounts, setSearchingAccounts] = useState(false);
  useEffect(() => {
    if (!managed.some((item) => item.id === project)) setProject(managed[0]?.id ?? "");
  }, [projects, project, session.user?.admin]);
  useEffect(() => {
    let active = true;
    if (project)
      void Promise.all([
        get<{ members: Member[] }>(`/api/projects/${project}/members`),
        get<{ tokens: Token[] }>(`/api/projects/${project}/tokens`),
      ])
        .then(([a, b]) => {
          if (active) {
            setMembers(a.members);
            setTokens(b.tokens);
          }
        })
        .catch((problem: Error) => {
          if (active) {
            setError(problem.message);
            setMembers([]);
            setTokens([]);
          }
        });
    return () => {
      active = false;
    };
  }, [project, revision, session.user?.admin]);
  useEffect(() => {
    let active = true;
    if (session.user?.admin) {
      setSearchingAccounts(true);
      void get<{ users: User[] }>(
        `/api/users?query=${encodeURIComponent(accountSearch)}&status=active`,
      )
        .then((value) => {
          if (active) setUsers(value.users);
        })
        .catch((problem: Error) => {
          if (active) setError(problem.message);
        })
        .finally(() => {
          if (active) setSearchingAccounts(false);
        });
    }
    return () => {
      active = false;
    };
  }, [accountSearch, revision, session.user?.admin]);
  const run = async (work: () => Promise<unknown>, note: string) => {
    setError("");
    setMessage("");
    try {
      await work();
      setMessage(note);
      setRevision((value) => value + 1);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Action failed");
    }
  };
  return (
    <main className="vg-content">
      <div className="vg-page-heading">
        <div>
          <p className="vg-eyebrow">WORKSPACE ACCESS</p>
          <h1>People & integrations</h1>
          <p className="vg-muted">Control project access and connect your test pipelines.</p>
        </div>
        {session.access === "login" && session.user?.admin && (
          <a className="vg-button" href="/operations">
            Audit & recovery
          </a>
        )}
      </div>
      {error && (
        <div role="alert" className="vg-error">
          {error}
        </div>
      )}
      {message && (
        <p role="status" className="vg-settings-note">
          {message}
        </p>
      )}
      <Profile session={session} />
      {session.access === "login" && <AccountIdentity />}
      {session.access === "login" && session.user?.admin && (
        <InvitationSettings projects={projects} />
      )}
      {session.access === "login" && (
        <section className="vg-panel vg-settings-section">
          <h2>Your password</h2>
          <p className="vg-muted">Company-login passwords are managed by your identity provider.</p>
          <form
            className="vg-settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget,
                data = new FormData(form);
              void run(async () => {
                await mutation("/api/auth/password", "POST", {
                  current: data.get("current"),
                  password: data.get("password"),
                });
                form.reset();
              }, "Password changed. Other sessions have been revoked.");
            }}
          >
            <label>
              Current password
              <input name="current" type="password" autoComplete="current-password" required />
            </label>
            <label>
              New password
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                required
              />
            </label>
            <button className="vg-button">Change password</button>
          </form>
        </section>
      )}
      {issued && (
        <div className="vg-warning">
          <strong>Copy your upload token now</strong>
          <p>It is shown once. Store it in your CI secret settings.</p>
          <textarea readOnly aria-label="New upload token" value={issued} />
          <div className="vg-form-actions">
            <button
              className="vg-button"
              onClick={() => {
                void navigator.clipboard.writeText(issued);
              }}
            >
              Copy token
            </button>
            <button className="vg-button" onClick={() => setIssued("")}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      {session.access === "login" && session.user?.admin && (
        <UserAdministration
          projects={projects}
          onChanged={() => setRevision((value) => value + 1)}
        />
      )}
      <section className="vg-panel vg-settings-section">
        <h2>Project access</h2>
        <label className="vg-settings-project">
          Project
          <select
            value={project}
            onChange={(event) => {
              setError("");
              setProject(event.target.value);
              setIssued("");
            }}
          >
            {!managed.length && <option value="">No projects to manage</option>}
            {managed.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {managed.find((item) => item.id === project) && (
          <ProjectNameEditor
            key={`${project}:${managed.find((item) => item.id === project)!.version ?? 0}`}
            project={managed.find((item) => item.id === project)!}
            onSaved={() => {
              setMessage("Project details saved. Old IDs still work.");
              onUpdated();
            }}
          />
        )}
        {project && (
          <>
            {session.user?.admin && (
              <label className="vg-settings-project">
                Find an account for project access
                <input
                  value={accountSearch}
                  maxLength={120}
                  placeholder="Search name or email"
                  onChange={(event) => setAccountSearch(event.target.value)}
                />
              </label>
            )}
            <form
              className="vg-settings-form"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void run(
                  () =>
                    mutation(`/api/projects/${project}/members`, "POST", {
                      userId: data.get("user"),
                      role: data.get("role"),
                    }),
                  "Project access updated.",
                );
              }}
            >
              <label>
                Account
                {users.length ? (
                  <select key={accountSearch} name="user">
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.email || user.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input name="user" placeholder="Account ID" required />
                )}
              </label>
              <label>
                Project role
                <select name="role">
                  <option value="viewer">Viewer</option>
                  <option value="reviewer">Reviewer</option>
                  <option value="maintainer">Maintainer</option>
                </select>
              </label>
              <button className="vg-button" disabled={searchingAccounts}>
                Grant access
              </button>
            </form>
            <div className="vg-table-scroll">
              <table className="vg-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Project role</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.userId}>
                      <td>
                        {users.find((user) => user.id === member.userId)?.email ?? member.userId}
                      </td>
                      <td>{member.role}</td>
                      <td>
                        <button
                          className="vg-button"
                          onClick={() => {
                            void run(
                              () =>
                                mutation(`/api/projects/${project}/members`, "POST", {
                                  userId: member.userId,
                                  role: null,
                                }),
                              "Project access removed.",
                            );
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h2 className="vg-settings-subheading">Upload credentials</h2>
            <p className="vg-muted">
              Project-scoped credentials can publish evidence, but cannot browse projects or approve
              changes.
            </p>
            <form
              className="vg-settings-form"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void run(async () => {
                  const result = await mutation<{ token: string }>(
                    `/api/projects/${project}/tokens`,
                    "POST",
                    { name: data.get("name"), days: Number(data.get("days")) },
                  );
                  setIssued(result.token);
                }, "Upload credential created.");
              }}
            >
              <label>
                Name
                <input name="name" placeholder="GitHub Actions" required maxLength={120} />
              </label>
              <label>
                Expires in days
                <input name="days" type="number" min={1} max={90} defaultValue={30} required />
              </label>
              <button className="vg-button">Create upload token</button>
            </form>
            <div className="vg-table-scroll">
              <table className="vg-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Expires</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((token) => (
                    <tr key={token.id}>
                      <td>{token.name}</td>
                      <td>{new Date(token.expiresAt).toLocaleString()}</td>
                      <td>
                        <button
                          className="vg-button"
                          onClick={() => {
                            void run(
                              () =>
                                mutation(`/api/projects/${project}/tokens/${token.id}`, "DELETE"),
                              "Upload credential revoked.",
                            );
                          }}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      {managed.find((item) => item.id === project) && (
        <section className="vg-panel vg-settings-section vg-danger-zone">
          <h2>Delete project</h2>
          <p className="vg-muted">
            Permanently remove this project and its run history. Export a backup first if you need a
            local copy.
          </p>
          <DeleteAction
            key={project}
            kind="project"
            id={project}
            displayId={managed.find((item) => item.id === project)!.publicId ?? project}
            name={managed.find((item) => item.id === project)!.name}
            runCount={managed.find((item) => item.id === project)!.runCount}
            onDeleted={(result) => {
              setIssued("");
              onDeleted(deletionMessage("project", result));
            }}
          />
        </section>
      )}
    </main>
  );
}
