import { useEffect, useState, type FormEvent } from "react";
import { mutation } from "./auth";

interface AccountIdentities {
  googleLinked: boolean;
  googleConfigured: boolean;
  linkingAvailable: boolean;
  requiresPassword: boolean;
  reauthenticationRequired: boolean;
}

export function AccountIdentity() {
  const [account, setAccount] = useState<AccountIdentities>();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const result = new URLSearchParams(window.location.search).get("identity");
  const [error, setError] = useState(result === "error" ? "Google could not be linked. Sign in again and retry. A Google account already used by another workspace account cannot be merged here." : "");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/identities", { signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to load sign-in methods");
      if (!controller.signal.aborted) setAccount(data as AccountIdentities);
    }).catch((problem: Error) => { if (!controller.signal.aborted) setError(problem.message); });
    return () => controller.abort();
  }, []);
  const link = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError("");
    try {
      const value = await mutation<{ authorizationUrl: string }>("/api/auth/identities/google/link", "POST", {
        ...(account?.requiresPassword ? { currentPassword: password } : {}),
      });
      setPassword("");
      window.location.assign(value.authorizationUrl);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Unable to start Google linking");
      setPending(false);
    }
  };
  return <section className="vg-panel vg-settings-section">
    <h2>Your sign-in methods</h2>
    <p className="vg-muted">Link Google to your current account while keeping your project access and review history.</p>
    {error && <p role="alert" className="vg-form-error">{error}</p>}
    {result === "linked" && account?.googleLinked && <p role="status" className="vg-settings-note">Google linked. Your other sessions have been signed out.</p>}
    {!account ? (!error && <p role="status">Loading sign-in methods…</p>) : <>
      <p>{account.googleLinked ? "Google is linked to this account." : "Google is not linked to this account."}</p>
      {!account.googleConfigured && <p>Ask your workspace administrator to configure Google sign-in.</p>}
      {account.googleConfigured && !account.linkingAvailable && <p>Google linking is unavailable on this workspace. Ask your administrator to enable it. Your existing sign-in methods remain available.</p>}
      {account.googleConfigured && account.linkingAvailable && !account.googleLinked && (account.reauthenticationRequired
        ? <p>Sign out and sign in again before linking Google.</p>
        : <form className="vg-settings-form" onSubmit={(event) => { void link(event); }}>
          <p className="vg-muted">Your other sessions will be signed out after linking.</p>
          {account.requiresPassword && <label>Confirm your current password
            <input type="password" autoComplete="current-password" required maxLength={256} value={password}
              disabled={pending} onChange={(event) => setPassword(event.target.value)} />
          </label>}
          <button className="vg-button" disabled={pending}>{pending ? "Opening Google…" : "Link Google account"}</button>
        </form>)}
    </>}
  </section>;
}
