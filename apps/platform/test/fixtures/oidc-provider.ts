import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const clientId = "google-test-client";
const clientSecret = "google-test-client-secret";

interface SimulatedOidcProvider {
  issuer: string;
  clientId: string;
  clientSecret: string;
  claims: Record<string, unknown>;
  badSignature: boolean;
  failDiscovery: boolean;
  discoveryRequests: number;
  tokenRequests: number;
  jwksRequests: number;
  authorize(target: URL): string;
  fetch: typeof fetch;
}

/** Fake network endpoints; the real openid-client still validates the OIDC flow and JWT. */
export function oidcProvider(issuer = "https://accounts.google.com") {
  const actualFetch = globalThis.fetch;
  const codes = new Map<string, { nonce: string; challenge: string }>();
  const provider: SimulatedOidcProvider = {
    issuer, clientId, clientSecret,
    claims: {} as Record<string, unknown>,
    badSignature: false,
    failDiscovery: false,
    discoveryRequests: 0,
    tokenRequests: 0,
    jwksRequests: 0,
    authorize(target: URL) {
      const code = randomUUID();
      codes.set(code, { nonce: target.searchParams.get("nonce")!, challenge: target.searchParams.get("code_challenge")! });
      return code;
    },
    fetch: (async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (["127.0.0.1", "localhost"].includes(url.hostname)) return actualFetch(input, init);
      if (url.origin !== new URL(issuer).origin) throw new Error("Unexpected external OIDC request in test");
      if (url.pathname.includes(".well-known")) {
        provider.discoveryRequests++;
        if (provider.failDiscovery) return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
        return Response.json({
          issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`, response_types_supported: ["code"],
          subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["client_secret_post"],
        });
      }
      if (url.pathname === "/jwks") {
        provider.jwksRequests++;
        return Response.json({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "oidc-test-key", alg: "RS256", use: "sig" }] });
      }
      if (url.pathname === "/token") {
        provider.tokenRequests++;
        const body = new URLSearchParams(String(init?.body));
        const entry = codes.get(body.get("code") ?? "");
        codes.delete(body.get("code") ?? "");
        const challenge = createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url");
        if (!entry || entry.challenge !== challenge || body.get("client_id") !== clientId || body.get("client_secret") !== clientSecret)
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        const now = Math.floor(Date.now() / 1000);
        const claims = { iss: issuer, aud: clientId, sub: "google-member", iat: now, exp: now + 300,
          nonce: entry.nonce, email: "member@example.test", email_verified: true, name: "Google member", ...provider.claims };
        const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "oidc-test-key" })).toString("base64url");
        const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
        const data = `${header}.${payload}`;
        const signature = provider.badSignature ? Buffer.alloc(256).toString("base64url") : sign("RSA-SHA256", Buffer.from(data), keys.privateKey).toString("base64url");
        return Response.json({ access_token: "test-only-access-token", token_type: "Bearer", expires_in: 300,
          id_token: `${data}.${signature}` });
      }
      throw new Error("Unexpected OIDC endpoint in test");
    }) satisfies typeof fetch,
  };
  return provider;
}
