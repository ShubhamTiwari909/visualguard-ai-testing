import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sha256 } from "./artifacts.js";
import { AuthService, type Actor } from "./auth.js";
import { Identities, type ExternalIdentity } from "./identities.js";
import { Invitations, type JoinProof } from "./invitations.js";
import { PlatformError } from "./errors.js";

export interface OnboardingBinding { ticketId: string; ticketVersion: number; invitationId: string; invitationVersion: number }
interface Ticket { csrf: string; invitationId?: string; invitationVersion?: number; proof?: JoinProof }
const cookie = (request: IncomingMessage) => request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("vg_join="))?.slice(8);
export class Onboarding {
  constructor(private auth: AuthService, private invitations: Invitations) {}
  private async ticket(request: IncomingMessage) {
    const handle = cookie(request);
    const row = handle && handle.length < 200 ? await this.auth.state.get<Ticket>("onboarding", sha256(handle)) : undefined;
    if (!row) throw new PlatformError(401, "Invitation session expired; open your invitation link again");
    return row;
  }
  async browser(request: IncomingMessage, response: ServerResponse) {
    if (this.auth.mode !== "login") throw new PlatformError(400, "Invitations require hosted login");
    let row;
    try { row = await this.ticket(request); } catch { /* Establish a browser-bound pre-session form. */ }
    if (!row) {
      const handle = randomBytes(32).toString("base64url"), id = sha256(handle);
      const value: Ticket = { csrf: randomBytes(32).toString("base64url") };
      if (!await this.auth.state.create("onboarding", id, value, new Date(Date.now() + 600_000).toISOString()))
        throw new PlatformError(409, "Unable to start invitation session");
      response.setHeader("Set-Cookie", `vg_join=${handle}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${this.auth.publicUrl?.protocol === "https:" ? "; Secure" : ""}`);
      row = (await this.auth.state.get<Ticket>("onboarding", id))!;
    }
    const proof = row.value.proof;
    let invitation, notice;
    if (proof && row.value.invitationId) {
      try { invitation = await this.invitations.preview(row.value.invitationId, row.value.invitationVersion!, proof); }
      catch (error) {
        if (!(error instanceof PlatformError)) throw error;
        // Keep the form token available so a NEW fragment can replace a completed/stale ticket.
        notice = "This invitation is no longer available. Open a new invitation link from your administrator.";
      }
    }
    return { token: row.value.csrf, exchanged: Boolean(row.value.invitationId) && !notice, oidc: this.auth.oidcProvider,
      invitation, notice };
  }
  async action(request: IncomingMessage, actor?: Actor) {
    const row = await this.ticket(request);
    if (request.headers["x-visualguard-onboarding-token"] !== row.value.csrf) throw new PlatformError(403, "Missing or invalid invitation action token");
    if (actor?.credentialId) throw new PlatformError(403, "A browser account is required");
    if (actor) this.auth.csrf(request, actor);
    const address = request.socket.remoteAddress ?? "unknown";
    // No proxy header trust. The host must configure its own upstream perimeter if it multiplexes clients.
    await this.auth.throttle(sha256(`onboarding:${address}:${new URL(request.url!, "http://localhost").pathname}`));
    return row;
  }
  async exchange(request: IncomingMessage, token: string, actor?: Actor) {
    const row = await this.action(request, actor), invite = await this.invitations.exchange(token);
    row.value = { csrf: row.value.csrf, invitationId: invite.id, invitationVersion: invite.version };
    if (!await this.auth.state.replace("onboarding", row)) throw new PlatformError(409, "Invitation session changed; retry");
    return { ok: true };
  }
  async login(request: IncomingMessage, response: ServerResponse, actor?: Actor) {
    const row = await this.action(request, actor);
    if (!row.value.invitationId) throw new PlatformError(400, "Open an invitation link first");
    await this.invitations.checkAttempt(row.value.invitationId, row.value.invitationVersion!);
    row.value.proof = undefined;
    if (!await this.auth.state.replace("onboarding", row)) throw new PlatformError(409, "Invitation session changed; retry");
    return this.auth.beginInvitationOidc(response, { ticketId: row.id, ticketVersion: row.version + 1,
      invitationId: row.value.invitationId, invitationVersion: row.value.invitationVersion! });
  }
  async complete(request: IncomingMessage, binding: OnboardingBinding, identity: ExternalIdentity, profile: { email: string; name: string }) {
    const row = await this.ticket(request);
    if (row.id !== binding.ticketId || row.version !== binding.ticketVersion || row.value.invitationId !== binding.invitationId || row.value.invitationVersion !== binding.invitationVersion)
      throw new PlatformError(401, "Invitation browser session changed; start again");
    const user = await new Identities(this.auth.state).known(identity), actor = await this.auth.actor(request);
    if (actor && (!user || actor.id !== user.id || actor.credentialId)) throw new PlatformError(409, "Sign out before joining with a different account");
    const proof: JoinProof = { ...profile, identity, provedAt: new Date().toISOString(),
      ...(user ? { userId: user.id, authVersion: user.authVersion } : {}), ...(actor ? { sessionId: actor.sessionId } : {}) };
    await this.invitations.preview(binding.invitationId, binding.invitationVersion, proof);
    row.value.proof = proof;
    if (!await this.auth.state.replace("onboarding", row)) throw new PlatformError(409, "Invitation session changed; start again");
  }
  async prove(request: IncomingMessage, actor: Actor, password?: string) {
    const row = await this.action(request, actor);
    if (!row.value.invitationId) throw new PlatformError(400, "Open an invitation link first");
    const proof = await this.auth.proveAccount(actor, password);
    await this.invitations.preview(row.value.invitationId, row.value.invitationVersion!, proof);
    row.value.proof = proof;
    if (!await this.auth.state.replace("onboarding", row)) throw new PlatformError(409, "Invitation session changed; retry");
    return { ok: true };
  }
  async accept(request: IncomingMessage, response: ServerResponse, actor?: Actor) {
    const row = await this.action(request, actor), proof = row.value.proof;
    if (!row.value.invitationId || !proof) throw new PlatformError(401, "Verify the invited account before accepting");
    if (proof.sessionId && (!actor || actor.sessionId !== proof.sessionId || actor.id !== proof.userId))
      throw new PlatformError(401, "Sign in again before accepting");
    if (actor && actor.id !== (proof.userId ?? (proof.identity ? (await new Identities(this.auth.state).known(proof.identity))?.id : undefined))) throw new PlatformError(403, "Account changed; verify again");
    const result = await this.invitations.accept(row.value.invitationId, row.value.invitationVersion!, proof);
    // Grant is durable before a normal session is issued. Retrying never repeats the grant.
    await this.auth.issueSession(result.user, response, proof.identity ? "oidc" : "password");
    return { projectId: result.projectId, alreadyAccepted: result.alreadyAccepted, alreadyAuthorized: result.alreadyAuthorized };
  }
}
