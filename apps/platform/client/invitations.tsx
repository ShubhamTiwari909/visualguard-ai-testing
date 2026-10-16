import { useEffect, useState, type FormEvent } from "react";
import { mutation, type SessionInfo } from "./auth";
import type { Project } from "../shared/contracts";

type Invitation = { id: string; version: number; email: string; projectId: string; projectName?: string; inviterName?: string; role: string; expiresAt: string; status: string };
async function read<T>(path: string): Promise<T> {
  const response = await fetch(path); const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed"); return data;
}
export function InvitationSettings({ projects }: { projects: Project[] }) {
  const [rows, setRows] = useState<Invitation[]>([]), [after, setAfter] = useState<string>(), [available, setAvailable] = useState(false);
  const [link, setLink] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const load = async (cursor?: string) => {
    const value = await read<{ invitations: Invitation[]; after?: string; available: boolean }>(`/api/invitations${cursor ? `?after=${cursor}` : ""}`);
    setRows((prior) => cursor ? [...prior, ...value.invitations] : value.invitations); setAfter(value.after); setAvailable(value.available);
  };
  useEffect(() => { void load().catch((problem: Error) => setError(problem.message)); }, []);
  const run = async (work: () => Promise<{ link?: string }>) => {
    setBusy(true); setError(""); setLink("");
    try { const value = await work(); setLink(value.link ?? ""); await load(); }
    catch (problem) { setError(problem instanceof Error ? problem.message : "Unable to update invitation"); }
    finally { setBusy(false); }
  };
  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void run(() => mutation("/api/invitations", "POST", { email: form.get("email"), projectId: form.get("project"), role: form.get("role"), hours: Number(form.get("hours")) }));
  };
  return <section className="vg-panel vg-settings-section">
    <h2>Invitations</h2><p>Invite one person to one project. Copy the link and share it privately; no email is sent.</p>
    {error && <p role="alert" className="vg-form-error">{error}</p>}
    {!available && <p>Invitations require SQLite, PostgreSQL, or a MongoDB replica set.</p>}
    {link && <div role="status" className="vg-warning"><p>Copy this link now. It is shown once.</p><textarea aria-label="Invitation link" readOnly value={link} onFocus={(event) => event.target.select()} /><button className="vg-button" onClick={() => { void navigator.clipboard.writeText(link).catch(() => setError("Select and copy the link above.")); }}>Copy link</button></div>}
    <form className="vg-settings-form" onSubmit={create}>
      <label>Email<input name="email" type="email" maxLength={254} required /></label>
      <label>Project<select name="project" required>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label>Project role<select name="role" defaultValue="reviewer"><option value="viewer">Viewer</option><option value="reviewer">Reviewer</option><option value="maintainer">Maintainer</option></select></label>
      <label>Expires in hours<input name="hours" type="number" min={1} max={168} defaultValue={72} required /></label>
      <button className="vg-button vg-button-primary" disabled={busy || !available || !projects.length}>Create invitation</button>
    </form>
    <div className="vg-table-scroll"><table className="vg-table"><thead><tr><th>Email</th><th>Project / role</th><th>Status / expiry</th><th>Actions</th></tr></thead><tbody>
      {!rows.length && <tr><td colSpan={4}>No invitations yet.</td></tr>}
      {rows.map((row) => <tr key={row.id}><td>{row.email}</td><td>{projects.find((project) => project.id === row.projectId)?.name ?? row.projectId} / {row.role}</td><td>{row.status}<br />{new Date(row.expiresAt).toLocaleString()}</td><td>
        {(row.status === "pending" || row.status === "expired") && <>
          <button className="vg-button" disabled={busy} onClick={() => { void run(() => mutation(`/api/invitations/${row.id}/cancel`, "POST", { expectedVersion: row.version })); }}>Cancel</button>
          <button className="vg-button" disabled={busy || !available} onClick={() => { void run(() => mutation(`/api/invitations/${row.id}/replace`, "POST", { expectedVersion: row.version, role: row.role, hours: 72 })); }}>Replace link</button>
        </>}
      </td></tr>)}
    </tbody></table></div>
    {after && <button className="vg-button" disabled={busy} onClick={() => { void load(after).catch((problem: Error) => setError(problem.message)); }}>Load more invitations</button>}
  </section>;
}

type JoinState = { notice?: string; token: string; exchanged: boolean; oidc: string | null; invitation?: Invitation };
// Clear initial and same-page fragments before starting any request.
function takeInviteToken() {
  if (window.location.pathname !== "/invite") return null;
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (window.location.hash) window.history.replaceState(null, "", "/invite");
  return token;
}
const inviteToken = takeInviteToken();
let initialJoin: Promise<{ join: JoinState; session: SessionInfo }> | undefined;
async function joinRequest<T>(path: string, data: unknown, join: JoinState, session: SessionInfo): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "x-visualguard-onboarding-token": join.token,
    "x-visualguard-platform-token": session.token ?? "" }, body: JSON.stringify(data) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "Invitation request failed"); return value;
}
export function InvitationPage() {
  const [join, setJoin] = useState<JoinState>(), [session, setSession] = useState<SessionInfo>(), [busy, setBusy] = useState(false);
  const [error, setError] = useState(new URLSearchParams(window.location.search).has("signin_error") ? "Unable to verify this account. Choose the invited account and try again. If you already have an account, sign in below and link Google in Settings." : "");
  const load = async () => { setSession(await read<SessionInfo>("/api/session")); setJoin(await read<JoinState>("/api/onboarding")); };
  useEffect(() => {
    document.title = "VisualGuard · Join your team";
    let active = true, generation = 0;
    const start = async (token: string | null) => {
      let value = await read<JoinState>("/api/onboarding");
      const current = await read<SessionInfo>("/api/session");
      if (token) {
        await joinRequest("/api/onboarding/exchange", { token }, value, current);
        value = await read<JoinState>("/api/onboarding");
      }
      return { join: value, session: current };
    };
    const display = (request: NonNullable<typeof initialJoin>) => {
      const revision = ++generation;
      void request.then((value) => {
        if (active && revision === generation) { setJoin(value.join); setSession(value.session); }
      }).catch((problem: Error) => { if (active && revision === generation) setError(problem.message); });
    };
    initialJoin ??= start(inviteToken);
    display(initialJoin);
    const fragmentChanged = () => {
      const token = takeInviteToken();
      if (!token) return;
      setError(""); setJoin(undefined);
      // Serialize exchanges if another invitation is opened before the first request settles.
      initialJoin = initialJoin!.catch(() => undefined).then(() => start(token));
      display(initialJoin);
    };
    window.addEventListener("hashchange", fragmentChanged);
    return () => { active = false; window.removeEventListener("hashchange", fragmentChanged); };
  }, []);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(""); try { await work(); } catch (problem) { setError(problem instanceof Error ? problem.message : "Invitation failed"); } finally { setBusy(false); }
  };
  const signIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void run(async () => {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error); await load();
    });
  };
  return <main className="platform vg-login"><div className="vg-login-card"><div className="vg-brand"><span className="vg-logo">V</span>VisualGuard.</div>
    <h1>Join your team</h1><p>Verify the invited account, then confirm your project access.</p>
    {error && <p role="alert" className="vg-form-error">{error}</p>}
    {join?.notice && <p role="status">{join.notice}</p>}
    {join && session && (join.invitation ? <>
      <p><strong>{join.invitation.projectName}</strong></p><p>{join.invitation.email} · {join.invitation.role}</p><p>Invited by {join.invitation.inviterName}</p><p>Expires {new Date(join.invitation.expiresAt).toLocaleString()}</p>
      <button className="vg-button vg-button-primary" disabled={busy} onClick={() => { void run(async () => {
        const current = await read<SessionInfo>("/api/session");
        const receipt = await joinRequest<{ projectId: string }>("/api/onboarding/accept", { confirmed: true }, join, current);
        window.location.assign(`/?project=${encodeURIComponent(receipt.projectId)}`);
      }); }}>Accept invitation</button>
    </> : join.exchanged ? <>
      {join.oidc && <button className="vg-button vg-button-primary" disabled={busy} onClick={() => { void run(async () => {
        const result = await joinRequest<{ authorizationUrl: string }>("/api/onboarding/login", {}, join, session); window.location.assign(result.authorizationUrl);
      }); }}>{join.oidc === "google" ? "Verify with Google" : "Verify with company login"}</button>}
      {session.user ? <form key="account-proof" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(async () => { await joinRequest("/api/onboarding/prove", { currentPassword: form.get("password") || undefined }, join, session); await load(); }); }}>
        <p>Accept as {session.user.email}. Password accounts must confirm their password; company-login accounts need a recent sign-in.</p>
        <label>Current password<input name="password" type="password" autoComplete="current-password" maxLength={256} /></label>
        <button className="vg-button" disabled={busy}>Verify existing account</button>
      </form> : <form key="password-login" onSubmit={signIn}><p>Already have a password account? Sign in here to keep your existing account.</p>
        <label>Email<input name="email" type="email" required autoComplete="username" /></label><label>Password<input name="password" type="password" maxLength={256} required autoComplete="current-password" /></label>
        <button className="vg-button" disabled={busy}>Sign in</button>
      </form>}
      {session.user && <button className="vg-button" disabled={busy} onClick={() => { void run(async () => { await mutation("/api/auth/logout", "POST"); await load(); }); }}>Sign out to use another account</button>}
    </> : <p>Open the invitation link shared by your administrator.</p>)}
    <a className="vg-button" href="/">Open dashboard</a>
  </div></main>;
}
