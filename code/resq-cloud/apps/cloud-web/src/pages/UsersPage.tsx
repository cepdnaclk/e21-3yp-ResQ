import { useEffect, useState, type FormEvent } from "react";
import {
  createCloudUser,
  fetchCloudUsers,
  updateCloudUser,
  updateCloudUserPassword,
  setLocalHubPassword,
  type CloudUser,
  type CloudUserRole,
} from "../api/cloudApi";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncState";
import { formatDate } from "../lib/format";
import { loadAuthSession } from "../auth/authStorage";

const EMPTY_FORM = {
  displayName: "",
  email: "",
  role: "TRAINEE" as CloudUserRole,
  password: "",
};

export function UsersPage() {
  const currentUserRole = loadAuthSession()?.user.role;
  const [users, setUsers] = useState<CloudUser[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // States for LocalHub PIN/Password reset modal
  const [pinUser, setPinUser] = useState<CloudUser | null>(null);
  const [pinPassword, setPinPassword] = useState("");
  const [pinConfirmPassword, setPinConfirmPassword] = useState("");
  const [isSavingPin, setIsSavingPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      setUsers(await fetchCloudUsers());
    } catch (loadError) {
      setError(message(loadError));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      if (editingId) {
        await updateCloudUser(editingId, {
          displayName: form.displayName.trim(),
          email: form.email.trim() || null,
          role: form.role,
        });
        if (form.password) {
          await updateCloudUserPassword(editingId, form.password);
        }
      } else {
        await createCloudUser({
          displayName: form.displayName.trim(),
          email: form.email.trim() || undefined,
          role: form.role,
          password: form.password,
        });
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      await load();
    } catch (saveError) {
      setError(message(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  function edit(user: CloudUser) {
    setEditingId(user.userId);
    setForm({
      displayName: user.displayName,
      email: user.email || "",
      role: user.role,
      password: "",
    });
  }

  async function toggleActive(user: CloudUser) {
    setError(null);
    try {
      await updateCloudUser(user.userId, { active: !user.active });
      await load();
    } catch (updateError) {
      setError(message(updateError));
    }
  }

  function openPinModal(user: CloudUser) {
    setPinUser(user);
    setPinPassword("");
    setPinConfirmPassword("");
    setPinError(null);
    setNotification(null);
  }

  function closePinModal() {
    setPinUser(null);
    setPinPassword("");
    setPinConfirmPassword("");
    setPinError(null);
  }

  async function submitPin(event: FormEvent) {
    event.preventDefault();
    if (!pinUser) return;
    if (pinPassword.length < 4) {
      setPinError("Password/PIN must be at least 4 characters.");
      return;
    }
    if (pinPassword !== pinConfirmPassword) {
      setPinError("Passwords do not match.");
      return;
    }
    setIsSavingPin(true);
    setPinError(null);
    try {
      await setLocalHubPassword(pinUser.userId, pinPassword);
      setNotification({
        type: "success",
        message: "LocalHub password updated. Run roster sync on LocalHub to apply it.",
      });
      closePinModal();
      await load();
    } catch (saveError) {
      setPinError(message(saveError));
    } finally {
      setIsSavingPin(false);
    }
  }

  if (isLoading && users.length === 0) return <LoadingState message="Loading cloud users..." />;

  return (
    <section className="page-section">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Management</p>
          <h2>Users</h2>
          <p>Create and maintain local cloud administrators, instructors, and trainees.</p>
        </div>
      </div>

      {notification ? (
        <div className={`notification-banner notification-banner--${notification.type}`}>
          <span>{notification.message}</span>
          <button onClick={() => setNotification(null)}>&times;</button>
        </div>
      ) : null}

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <div className="management-layout">
        <form className="form-card" onSubmit={submit}>
          <div>
            <p className="eyebrow">{editingId ? "Edit user" : "New user"}</p>
            <h3>{editingId ? "Update cloud user" : "Create cloud user"}</h3>
          </div>
          <label>
            Display name
            <input
              required
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            />
          </label>
          <label>
            Email <span>Optional</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </label>
          <label>
            Role
            <select
              value={form.role}
              onChange={(event) => setForm({ ...form, role: event.target.value as CloudUserRole })}
            >
              <option value="TRAINEE">Trainee</option>
              <option value="INSTRUCTOR">Instructor</option>
              <option value="ADMIN">Admin</option>
            </select>
          </label>
          <label>
            Password <span>{editingId ? "Leave blank to keep the current password" : "Minimum 8 characters"}</span>
            <input
              type="password"
              minLength={8}
              required={!editingId}
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
            />
          </label>
          <div className="form-actions">
            <button className="button" disabled={isSaving}>
              {isSaving ? "Saving..." : editingId ? "Save changes" : "Create user"}
            </button>
            {editingId ? (
              <button
                type="button"
                className="button button--secondary"
                onClick={() => {
                  setEditingId(null);
                  setForm(EMPTY_FORM);
                }}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>

        <div className="management-list">
          {users.length === 0 ? (
            <EmptyState title="No cloud users" message="Create an administrator, instructor, or trainee to begin." />
          ) : users.map((user) => (
            <article className="management-row" key={user.userId}>
              <div>
                <div className="row-title">
                  <strong>{user.displayName}</strong>
                  <span className="role-badge">{user.role}</span>
                  <span className={user.active ? "active-badge" : "inactive-badge"}>
                    {user.active ? "Active" : "Inactive"}
                  </span>
                  {user.localLoginHash !== undefined && (
                    <span className={user.localLoginHash ? "active-badge" : "inactive-badge"} style={{ marginLeft: "8px" }}>
                      {user.localLoginHash ? "LocalHub login set" : "LocalHub login not set"}
                    </span>
                  )}
                </div>
                <p>{user.email || "No email"} | Updated {formatDate(user.updatedAt)}</p>
              </div>
              <div className="row-actions">
                <button className="text-button" onClick={() => edit(user)}>Edit</button>
                <button className="text-button" onClick={() => void toggleActive(user)}>
                  {user.active ? "Deactivate" : "Activate"}
                </button>
                {currentUserRole === "ADMIN" && (
                  <button className="text-button" onClick={() => openPinModal(user)}>Set LocalHub PIN</button>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>

      {pinUser ? (
        <div className="modal-overlay" onClick={closePinModal}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">LocalHub Security</p>
                <h3>Set LocalHub PIN</h3>
              </div>
              <button className="modal-close-button" onClick={closePinModal}>&times;</button>
            </div>
            <form onSubmit={submitPin} style={{ display: "grid", gap: "16px" }}>
              <div>
                <p style={{ margin: "0 0 6px", fontSize: "0.85rem", color: "var(--muted)" }}>
                  User: <strong>{pinUser.displayName}</strong> ({pinUser.email || "No email"})
                </p>
                <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
                  Role: <span className="role-badge" style={{ verticalAlign: "middle" }}>{pinUser.role}</span>
                </p>
              </div>
              <label className="form-card" style={{ padding: 0, border: 0, boxShadow: "none", gap: "6px" }}>
                New PIN / Password
                <input
                  type="password"
                  value={pinPassword}
                  onChange={(e) => setPinPassword(e.target.value)}
                  minLength={4}
                  maxLength={64}
                  required
                  placeholder="Min 4, max 64 characters"
                />
              </label>
              <label className="form-card" style={{ padding: 0, border: 0, boxShadow: "none", gap: "6px" }}>
                Confirm PIN / Password
                <input
                  type="password"
                  value={pinConfirmPassword}
                  onChange={(e) => setPinConfirmPassword(e.target.value)}
                  minLength={4}
                  maxLength={64}
                  required
                  placeholder="Confirm your entry"
                />
              </label>

              {pinError ? <div className="login-error" style={{ marginBottom: 0 }}>{pinError}</div> : null}

              <div className="modal-footer">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={closePinModal}
                  disabled={isSavingPin}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button"
                  disabled={
                    isSavingPin ||
                    !pinPassword ||
                    pinPassword.length < 4 ||
                    pinPassword.length > 64 ||
                    pinPassword !== pinConfirmPassword
                  }
                >
                  {isSavingPin ? "Saving..." : "Set PIN"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The management request failed.";
}
