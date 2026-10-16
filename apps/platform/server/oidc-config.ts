export interface OidcSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  provider: "google" | "oidc";
}

/** Validate configuration without discovery or exposing credential values. */
export function oidcSettings(env: NodeJS.ProcessEnv): OidcSettings | undefined {
  const keys = ["VISUALGUARD_OIDC_ISSUER", "VISUALGUARD_OIDC_CLIENT_ID", "VISUALGUARD_OIDC_CLIENT_SECRET"] as const;
  if (!keys.some((key) => env[key]?.trim())) return undefined;
  const missing = keys.filter((key) => !env[key]?.trim());
  if (missing.length) throw new Error(`Company login requires ${missing.join(", ")}`);
  const issuer = env.VISUALGUARD_OIDC_ISSUER!;
  let url: URL;
  try { url = new URL(issuer); }
  catch { throw new Error("VISUALGUARD_OIDC_ISSUER must be a valid HTTPS URL"); }
  if (issuer !== issuer.trim() || url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("VISUALGUARD_OIDC_ISSUER must be an HTTPS URL without credentials, query, or fragment");
  return {
    // Keep the configured issuer unchanged: existing OIDC user IDs include it.
    issuer, clientId: env.VISUALGUARD_OIDC_CLIENT_ID!, clientSecret: env.VISUALGUARD_OIDC_CLIENT_SECRET!,
    provider: url.origin === "https://accounts.google.com" && url.pathname === "/" ? "google" : "oidc",
  };
}
