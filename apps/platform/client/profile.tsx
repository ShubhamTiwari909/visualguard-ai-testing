import type { SessionInfo } from "./auth";

export function Profile({ session }: { session: SessionInfo }) {
  if (!session.user) return null;
  const local = session.access === "local";
  return (
    <section
      id="profile"
      className="vg-panel vg-settings-section vg-profile"
      aria-labelledby="profile-title"
    >
      <h2 id="profile-title">Your profile</h2>
      <p className="vg-muted">
        {local
          ? "You are using local access. No email account is required."
          : "The account you are signed in to on this workspace."}
      </p>
      <dl className="vg-profile-details">
        <div>
          <dt>Name</dt>
          <dd>{session.user.name || "Not set"}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{local ? "Not used for local access" : session.user.email || "Not set"}</dd>
        </div>
        <div>
          <dt>Workspace role</dt>
          <dd>
            {local
              ? "Local owner"
              : session.user.admin
                ? "Workspace administrator"
                : "Workspace member"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
