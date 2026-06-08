import type { CloudUser } from "../api/cloudApi";

export function ProfilePage({ user }: { user: CloudUser }) {
  return (
    <section className="page-section">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Account</p>
          <h2>{user.displayName}</h2>
          <p>{user.email || "No email recorded"}</p>
        </div>
        <span className="role-badge large-badge">{user.role}</span>
      </div>
      <div className="state-panel">
        <div>
          <p className="eyebrow">Phase 8</p>
          <h2>{user.role === "TRAINEE" ? "My History coming later" : "Cloud account active"}</h2>
          <p>
            {user.role === "TRAINEE"
              ? "Trainee-specific session history filtering is planned for a later phase."
              : "Use the navigation above to access the cloud review tools allowed for your role."}
          </p>
        </div>
      </div>
    </section>
  );
}
