import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";

export interface SessionInfo { access: "local" | "login"; token?: string; user: { id: string; name: string; email: string; admin: boolean } | null; oidc: boolean }
const Context = createContext<SessionInfo | undefined>(undefined);
export const useSession = () => useContext(Context)!;

export async function mutation<T>(path: string, method: string, data?: unknown): Promise<T> {
  const session = await fetch("/api/session").then((response) => response.json()) as SessionInfo;
  const response = await fetch(path, { method, headers: { "Content-Type": "application/json", "x-visualguard-platform-token": session.token ?? "" }, body: data === undefined ? undefined : JSON.stringify(data) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Request failed");
  return value as T;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const load = () => fetch("/api/session").then(async (response) => { const value = await response.json(); if (!response.ok) throw new Error(value.error); setSession(value); }).catch((problem: Error) => setError(problem.message));
  useEffect(() => { const expired = () => { void load(); }; void load(); window.addEventListener("visualguard-auth-expired", expired); return () => window.removeEventListener("visualguard-auth-expired", expired); }, []);
  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setPending(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error); await load();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Sign-in failed"); }
    finally { setPending(false); }
  };
  if (session?.user) return <Context.Provider value={session}>{children}</Context.Provider>;
  return <main className="platform vg-login"><div className="vg-login-card">
    <div className="vg-brand"><span className="vg-logo">V</span>VisualGuard.</div>
    <h1>{session ? "Welcome to your workspace" : "Connecting to your workspace…"}</h1>
    <p className="vg-muted">Sign in to browse your team's visual test evidence.</p>
    {error && <p role="alert" className="vg-form-error">{error}</p>}
    {session && <form onSubmit={(event) => { void login(event); }}>
      <label>Email<input name="email" type="email" autoComplete="username" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" maxLength={256} required /></label>
      <button className="vg-button vg-button-primary" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>}
    {session?.oidc && <a className="vg-button" href="/api/auth/login">Continue with company login</a>}
    {!session && error && <button className="vg-button" onClick={() => { setError(""); void load(); }}>Retry connection</button>}
  </div></main>;
}

export function AccountMenu() {
  const session = useSession();
  if (session.access === "local") return <span className="vg-local-label">Local access</span>;
  return <div className="vg-account"><span>{session.user?.name}</span><button className="vg-button" onClick={() => { void mutation("/api/auth/logout", "POST").then(() => window.location.reload()); }}>Sign out</button></div>;
}
