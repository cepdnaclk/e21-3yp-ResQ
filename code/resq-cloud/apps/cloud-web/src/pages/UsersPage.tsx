import { useEffect, useState, type FormEvent } from "react";
import {
  createCloudUser,
  fetchCloudUsers,
  updateCloudUser,
  updateCloudUserPassword,
  type CloudUser,
  type CloudUserRole,
} from "../api/cloudApi";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncState";
import { formatDate } from "../lib/format";

const EMPTY_FORM = {
  displayName: "",
  email: "",
  role: "TRAINEE" as CloudUserRole,
  password: "",
};

export function UsersPage() {
  const [users, setUsers] = useState<CloudUser[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
                </div>
                <p>{user.email || "No email"} | Updated {formatDate(user.updatedAt)}</p>
              </div>
              <div className="row-actions">
                <button className="text-button" onClick={() => edit(user)}>Edit</button>
                <button className="text-button" onClick={() => void toggleActive(user)}>
                  {user.active ? "Deactivate" : "Activate"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The management request failed.";
}
