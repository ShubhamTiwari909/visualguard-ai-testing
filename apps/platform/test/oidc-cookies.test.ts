import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AuthService, MemoryStateStore } from "../server/auth.js";
import { sha256 } from "../server/artifacts.js";

const grant = vi.hoisted(() => vi.fn());
vi.mock("openid-client", () => ({
  discovery: async () => ({}),
  randomPKCECodeVerifier: () => "test-provider-verifier-kept-server-side",
  randomState: () => "test-provider-state-kept-server-side",
  calculatePKCECodeChallenge: async () => "test-pkce-challenge",
  buildAuthorizationUrl: (_config: unknown, params: Record<string, string>) => {
    const url = new URL("https://identity.example.test/authorize");
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url;
  },
  authorizationCodeGrant: grant,
}));

function response() {
  const headers = new Map<string, string>();
  const value = {
    setHeader(name: string, content: string) {
      headers.set(name, content);
    },
    writeHead(_status: number, values: Record<string, string>) {
      for (const [name, content] of Object.entries(values)) headers.set(name, content);
    },
    end() {},
  } as unknown as ServerResponse;
  return { value, headers };
}

describe("OIDC browser correlation cookies", () => {
  it("stores only an opaque derived handle in the browser and consumes its server state once", async () => {
    grant.mockReset();
    grant.mockResolvedValue({
      claims: () => ({ sub: "test-owner", email: "owner@example.test", email_verified: true }),
    });
    const state = new MemoryStateStore();
    const auth = new AuthService(state, {
      VISUALGUARD_PUBLIC_URL: "https://dashboard.example.test",
      VISUALGUARD_OIDC_ISSUER: "https://identity.example.test",
      VISUALGUARD_OIDC_CLIENT_ID: "test-client",
      VISUALGUARD_OIDC_CLIENT_SECRET: "test-client-credential",
      VISUALGUARD_ADMIN_EMAIL: "owner@example.test",
    });
    await auth.ready;
    const start = response();
    await auth.beginOidc(start.value);
    const cookie = start.headers.get("Set-Cookie")!;
    expect(cookie).toMatch(/^vg_oidc=[a-f0-9]{64};/);
    expect(cookie).toContain("HttpOnly; SameSite=Lax; Max-Age=600; Secure");
    const handle = cookie.split(";")[0]!.slice("vg_oidc=".length);
    const records = await state.list<{ state: string; nonce: string; verifier: string }>("oidc");
    expect(records).toHaveLength(1);
    expect(records[0]!.id).toBe(sha256(handle));
    expect(JSON.stringify(records)).not.toContain(handle);
    const target = new URL(start.headers.get("Location")!);
    expect(cookie).not.toContain(records[0]!.value.verifier);
    expect(cookie).not.toContain(target.searchParams.get("nonce")!);
    const callback = new URL("https://dashboard.example.test/api/auth/callback?code=test-code");
    callback.searchParams.set("state", target.searchParams.get("state")!);
    const request = { headers: { cookie: `vg_oidc=${handle}` } } as IncomingMessage;
    await auth.finishOidc(request, response().value, callback);
    expect(grant).toHaveBeenCalledWith(
      expect.anything(),
      callback,
      expect.objectContaining({
        pkceCodeVerifier: records[0]!.value.verifier,
        expectedNonce: records[0]!.value.nonce,
        expectedState: records[0]!.value.state,
        idTokenExpected: true,
      }),
    );
    expect(await state.list("oidc")).toEqual([]);
    await expect(auth.finishOidc(request, response().value, callback)).rejects.toMatchObject({
      status: 401,
    });
    expect(grant).toHaveBeenCalledTimes(1);
  });
});
