import { useEffect, useState, type FormEvent } from "react";
import type { AuthUser, CreateUserRequest, UserRole } from "@resq/shared";
import { USER_ROLES } from "@resq/shared";
import { useAuth } from "../auth/AuthContext";

export default function AdminUsersPage() {
  const { currentUser, listUsers, createUser, disableUser, enableUser } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [formUsername, setFormUsername] = useState("");
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole] = useState<UserRole>("INSTRUCTOR");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    try {
      setLoading(true);
      setError(null);
      const userList = await listUsers();
      setUsers(userList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormBusy(true);
    setFormError(null);

    try {
      const request: CreateUserRequest = {
        username: formUsername,
        displayName: formDisplayName,
        password: formPassword,
        role: formRole,
      };
      await createUser(request);
      setFormUsername("");
      setFormDisplayName("");
      setFormPassword("");
      setFormRole("INSTRUCTOR");
      setShowForm(false);
      await loadUsers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setFormBusy(false);
    }
  }

  async function handleDisableUser(userId: string) {
    if (!confirm("Disable this user? They won't be able to sign in.")) {
      return;
    }

    try {
      await disableUser(userId);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable user");
    }
  }

  async function handleEnableUser(userId: string) {
    if (!confirm("Enable this user? They will be able to sign in again.")) {
      return;
    }

    try {
      await enableUser(userId);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable user");
    }
  }

  return (
    <div style={{ padding: "24px", fontFamily: "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <div style={{ marginBottom: "24px" }}>
        <h2 style={{ margin: "0 0 8px 0", fontSize: "1.5rem", fontWeight: 600 }}>User Management</h2>
        <p style={{ margin: 0, color: "#64748b", fontSize: "0.95rem" }}>
          Create and manage local user accounts for instructors and trainees.
        </p>
      </div>

      {error && (
        <div
          style={{
            padding: "12px",
            borderRadius: "10px",
            background: "#fee2e2",
            color: "#991b1b",
            fontSize: "0.9rem",
            marginBottom: "16px",
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: "24px", textAlign: "center", color: "#64748b" }}>Loading users...</div>
      ) : (
        <>
          <div style={{ marginBottom: "20px" }}>
            <button
              type="button"
              onClick={() => setShowForm(!showForm)}
              style={{
                padding: "10px 14px",
                borderRadius: "10px",
                border: "1px solid #0f172a",
                background: "#0f172a",
                color: "#ffffff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {showForm ? "Cancel" : "Create New User"}
            </button>
          </div>

          {showForm && (
            <form
              onSubmit={handleCreateUser}
              style={{
                marginBottom: "24px",
                padding: "16px",
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                background: "#f8fafc",
                display: "grid",
                gap: "12px",
              }}
            >
              <label style={{ display: "grid", gap: "6px" }}>
                <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "#0f172a" }}>Username</span>
                <input
                  type="text"
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value)}
                  placeholder="john_doe"
                  required
                  style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid #cbd5e1",
                    fontFamily: "inherit",
                    fontSize: "0.95rem",
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: "6px" }}>
                <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "#0f172a" }}>Display Name</span>
                <input
                  type="text"
                  value={formDisplayName}
                  onChange={(e) => setFormDisplayName(e.target.value)}
                  placeholder="John Doe"
                  required
                  style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid #cbd5e1",
                    fontFamily: "inherit",
                    fontSize: "0.95rem",
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: "6px" }}>
                <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "#0f172a" }}>Role</span>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value as UserRole)}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid #cbd5e1",
                    fontFamily: "inherit",
                    fontSize: "0.95rem",
                  }}
                >
                  <option value="INSTRUCTOR">Instructor</option>
                  <option value="TRAINEE">Trainee</option>
                </select>
              </label>

              <label style={{ display: "grid", gap: "6px" }}>
                <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "#0f172a" }}>Password</span>
                <input
                  type="password"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={8}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid #cbd5e1",
                    fontFamily: "inherit",
                    fontSize: "0.95rem",
                  }}
                />
                <span style={{ fontSize: "0.8rem", color: "#64748b" }}>Minimum 8 characters</span>
              </label>

              {formError && (
                <div style={{ padding: "10px", borderRadius: "8px", background: "#fee2e2", color: "#991b1b", fontSize: "0.9rem" }}>
                  {formError}
                </div>
              )}

              <button
                type="submit"
                disabled={formBusy}
                style={{
                  padding: "10px 14px",
                  borderRadius: "10px",
                  border: "1px solid #0f172a",
                  background: formBusy ? "#94a3b8" : "#0f172a",
                  color: "#ffffff",
                  fontWeight: 600,
                  cursor: formBusy ? "not-allowed" : "pointer",
                }}
              >
                {formBusy ? "Creating..." : "Create User"}
              </button>
            </form>
          )}

          <div>
            <h3 style={{ margin: "0 0 12px 0", fontSize: "1.1rem", fontWeight: 600 }}>Active Users</h3>
            {users.length === 0 ? (
              <p style={{ color: "#64748b", fontSize: "0.95rem" }}>No users found.</p>
            ) : (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.95rem",
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "2px solid #e2e8f0" }}>
                    <th style={{ padding: "12px", textAlign: "left", fontWeight: 600, color: "#0f172a" }}>Username</th>
                    <th style={{ padding: "12px", textAlign: "left", fontWeight: 600, color: "#0f172a" }}>Display Name</th>
                    <th style={{ padding: "12px", textAlign: "left", fontWeight: 600, color: "#0f172a" }}>Role</th>
                    <th style={{ padding: "12px", textAlign: "center", fontWeight: 600, color: "#0f172a" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <td style={{ padding: "12px", color: "#0f172a" }}>
                        <code
                          style={{
                            padding: "4px 8px",
                            borderRadius: "6px",
                            background: "#f1f5f9",
                            fontFamily: "monospace",
                            fontSize: "0.9rem",
                          }}
                        >
                          {user.username}
                        </code>
                      </td>
                      <td style={{ padding: "12px", color: "#0f172a" }}>{user.displayName}</td>
                      <td style={{ padding: "12px" }}>
                        <span
                          style={{
                            padding: "4px 10px",
                            borderRadius: "999px",
                            background: user.role === "ADMIN" ? "#dbeafe" : user.role === "INSTRUCTOR" ? "#dcfce7" : "#fef3c7",
                            color:
                              user.role === "ADMIN" ? "#0c4a6e" : user.role === "INSTRUCTOR" ? "#166534" : "#92400e",
                            fontSize: "0.8rem",
                            fontWeight: 600,
                          }}
                        >
                          {user.role}
                        </span>
                      </td>
                      <td style={{ padding: "12px", textAlign: "center" }}>
                        {currentUser?.id !== user.id && user.role !== "ADMIN" && (
                          user.disabledAt ? (
                            <button
                              type="button"
                              onClick={() => handleEnableUser(user.id)}
                              style={{
                                padding: "6px 10px",
                                borderRadius: "6px",
                                border: "1px solid #10b981",
                                background: "#dcfce7",
                                color: "#065f46",
                                fontWeight: 600,
                                fontSize: "0.85rem",
                                cursor: "pointer",
                              }}
                            >
                              Enable
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleDisableUser(user.id)}
                              style={{
                                padding: "6px 10px",
                                borderRadius: "6px",
                                border: "1px solid #fca5a5",
                                background: "#fee2e2",
                                color: "#991b1b",
                                fontWeight: 600,
                                fontSize: "0.85rem",
                                cursor: "pointer",
                              }}
                            >
                              Disable
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
