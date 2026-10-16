import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../client/auth";
import { Profile } from "../client/profile";

const session: SessionInfo = {
  access: "login",
  token: "private-session-action-token",
  user: {
    id: "user-admin",
    name: "Demo Administrator",
    email: "admin@example.test",
    admin: true,
  },
  oidc: true,
  oidcProvider: "google",
};
const render = (value: SessionInfo) =>
  renderToStaticMarkup(createElement(Profile, { session: value }));

describe("personal dashboard profile", () => {
  it("shows the current administrator's account without exposing the action token", () => {
    const html = render(session);
    expect(html).toContain('id="profile"');
    expect(html).toContain('aria-labelledby="profile-title"');
    expect(html).toContain("Your profile");
    expect(html).toContain("Demo Administrator");
    expect(html).toContain("admin@example.test");
    expect(html).toContain("Workspace administrator");
    expect(html).not.toContain(session.token);
    expect(html).not.toContain(session.user!.id);
  });

  it("shows a member's own email and role without requiring directory access", () => {
    const html = render({
      ...session,
      user: { id: "user-member", name: "Demo Member", email: "member@example.test", admin: false },
    });
    expect(html).toContain("Demo Member");
    expect(html).toContain("member@example.test");
    expect(html).toContain("Workspace member");
    expect(html).not.toContain("Workspace administrator");
    expect(html).not.toContain("admin@example.test");
  });

  it("explains local access without presenting it as an email account", () => {
    const html = render({
      access: "local",
      oidc: false,
      user: { id: "local-owner", name: "Local workspace", email: "", admin: true },
    });
    expect(html).toContain("Local workspace");
    expect(html).toContain("Local owner");
    expect(html).toContain("Not used for local access");
    expect(html).toContain("No email account is required.");
    expect(html).not.toContain("Workspace administrator");
  });

  it("handles missing profile fields without inventing an account email", () => {
    const html = render({ ...session, user: { ...session.user!, name: "", email: "" } });
    expect(html.match(/Not set/g)).toHaveLength(2);
    expect(html).not.toContain("admin@example.test");
  });

  it("renders account text safely", () => {
    const html = render({
      ...session,
      user: { ...session.user!, name: '<img src=x onerror="alert(1)">' },
    });
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });

  it("does not show a profile before sign-in", () => {
    expect(render({ ...session, user: null })).toBe("");
  });
});
