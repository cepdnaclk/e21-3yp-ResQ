import { useEffect, useState, type FormEvent } from "react";
import type { AuthUser, CreateUserRequest, UserRole } from "@resq/shared";
import { USER_ROLES } from "@resq/shared";
import { useAuth } from "../auth/AuthContext";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";

function getRoleIcon(role: UserRole): string {
  switch (role) {
    case "ADMIN":
      return "👤";
    case "INSTRUCTOR":
      return "📋";
    case "TRAINEE":
      return "🎓";
    default:
      return "👤";
  }
}

function getRoleColor(role: UserRole): { bg: string; text: string; accent: string } {
  switch (role) {
    case "ADMIN":
      return { bg: "#eff6ff", text: "#0c4a6e", accent: "#3b82f6" };
    case "INSTRUCTOR":
      return { bg: "#f0fdf4", text: "#166534", accent: "#22c55e" };
    case "TRAINEE":
      return { bg: "#fffbeb", text: "#92400e", accent: "#f59e0b" };
    default:
      return { bg: "#f1f5f9", text: "#334155", accent: "#64748b" };
  }
}

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

  const enabledCount = users.filter((u) => !u.disabledAt).length;
  const disabledCount = users.filter((u) => u.disabledAt).length;

  return (
    <div style={{ fontFamily: "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif", background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)", minHeight: "100vh", padding: "40px 24px" }}>
      {/* Header Section */}
      <div
        style={{
          marginBottom: "32px",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          borderRadius: "16px",
          padding: "32px",
          color: "#ffffff",
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.1)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "20px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: "0 0 12px 0", fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.02em" }}>User Management</h1>
            <p style={{ margin: 0, color: "#cbd5e1", fontSize: "1rem" }}>Create and manage user accounts for your team</p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            style={{
              padding: "12px 20px",
              borderRadius: "10px",
              border: "none",
              background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
              color: "#ffffff",
              fontWeight: 600,
              fontSize: "0.95rem",
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(59, 130, 246, 0.3)",
              transition: "all 0.3s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 8px 20px rgba(59, 130, 246, 0.4)";
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 12px rgba(59, 130, 246, 0.3)";
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
            }}
          >
            ✨ Add New User
          </button>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "16px", marginTop: "24px" }}>
          <div style={{ background: "rgba(255, 255, 255, 0.1)", borderRadius: "10px", padding: "12px", backdropFilter: "blur(10px)" }}>
            <p style={{ margin: "0 0 4px 0", fontSize: "0.85rem", color: "#cbd5e1" }}>Total Users</p>
            <p style={{ margin: 0, fontSize: "1.75rem", fontWeight: 700, color: "#ffffff" }}>{users.length}</p>
          </div>
          <div style={{ background: "rgba(34, 197, 94, 0.15)", borderRadius: "10px", padding: "12px", backdropFilter: "blur(10px)", borderLeft: "3px solid #22c55e" }}>
            <p style={{ margin: "0 0 4px 0", fontSize: "0.85rem", color: "#86efac" }}>Active</p>
            <p style={{ margin: 0, fontSize: "1.75rem", fontWeight: 700, color: "#22c55e" }}>{enabledCount}</p>
          </div>
          <div style={{ background: "rgba(239, 68, 68, 0.15)", borderRadius: "10px", padding: "12px", backdropFilter: "blur(10px)", borderLeft: "3px solid #ef4444" }}>
            <p style={{ margin: "0 0 4px 0", fontSize: "0.85rem", color: "#fca5a5" }}>Disabled</p>
            <p style={{ margin: 0, fontSize: "1.75rem", fontWeight: 700, color: "#ef4444" }}>{disabledCount}</p>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div
          style={{
            padding: "16px",
            borderRadius: "12px",
            background: "#fee2e2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            fontSize: "0.95rem",
            marginBottom: "24px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <span style={{ fontSize: "1.2rem" }}>⚠️</span>
          <div>{error}</div>
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div
          style={{
            padding: "60px 24px",
            textAlign: "center",
            background: "#ffffff",
            borderRadius: "16px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
          }}
        >
          <div style={{ fontSize: "2rem", marginBottom: "12px" }}>⏳</div>
          <p style={{ color: "#64748b", fontSize: "1rem", margin: 0 }}>Loading users...</p>
        </div>
      ) : (
        <>
          {/* Users Grid */}
          <div>
            {users.length === 0 ? (
              <div
                style={{
                  padding: "60px 24px",
                  textAlign: "center",
                  background: "#ffffff",
                  borderRadius: "16px",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
                }}
              >
                <div style={{ fontSize: "3rem", marginBottom: "16px" }}>👥</div>
                <p style={{ color: "#64748b", fontSize: "1.1rem", margin: "0 0 8px 0", fontWeight: 500 }}>No users yet</p>
                <p style={{ color: "#94a3b8", fontSize: "0.95rem", margin: 0 }}>Click "Add New User" to get started</p>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "20px" }}>
                {users.map((user) => {
                  const colors = getRoleColor(user.role);
                  const isCurrentUser = currentUser?.id === user.id;
                  const isDisabled = user.disabledAt !== undefined && user.disabledAt !== null;
                  const isAdmin = user.role === "ADMIN";

                  return (
                    <div
                      key={user.id}
                      style={{
                        background: "#ffffff",
                        borderRadius: "14px",
                        padding: "20px",
                        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08), 0 8px 16px rgba(0, 0, 0, 0.04)",
                        transition: "all 0.3s ease",
                        border: "1px solid #e2e8f0",
                        opacity: isDisabled ? 0.7 : 1,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.12), 0 12px 24px rgba(0, 0, 0, 0.08)";
                        (e.currentTarget as HTMLDivElement).style.transform = "translateY(-4px)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 3px rgba(0, 0, 0, 0.08), 0 8px 16px rgba(0, 0, 0, 0.04)";
                        (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
                      }}
                    >
                      {/* Header with Avatar and Status */}
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "16px" }}>
                        <div
                          style={{
                            width: "48px",
                            height: "48px",
                            borderRadius: "10px",
                            background: colors.bg,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "1.5rem",
                            border: `2px solid ${colors.accent}`,
                            flexShrink: 0,
                          }}
                        >
                          {getRoleIcon(user.role)}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "#0f172a" }}>{user.displayName}</h3>
                            {isCurrentUser && (
                              <span
                                style={{
                                  padding: "2px 8px",
                                  background: "#dbeafe",
                                  color: "#0c4a6e",
                                  borderRadius: "4px",
                                  fontSize: "0.7rem",
                                  fontWeight: 600,
                                }}
                              >
                                YOU
                              </span>
                            )}
                          </div>
                          <p style={{ margin: 0, fontSize: "0.85rem", color: "#64748b", fontFamily: "monospace" }}>{user.username}</p>
                        </div>
                        {isDisabled && (
                          <div
                            style={{
                              padding: "4px 8px",
                              background: "#fee2e2",
                              color: "#991b1b",
                              borderRadius: "6px",
                              fontSize: "0.75rem",
                              fontWeight: 600,
                            }}
                          >
                            Disabled
                          </div>
                        )}
                      </div>

                      {/* Role Badge */}
                      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                        <div
                          style={{
                            padding: "8px 12px",
                            background: colors.bg,
                            color: colors.text,
                            borderRadius: "8px",
                            fontSize: "0.85rem",
                            fontWeight: 600,
                            display: "inline-block",
                            border: `1px solid ${colors.accent}`,
                          }}
                        >
                          {user.role}
                        </div>
                      </div>

                      {/* Action Button */}
                      {!isCurrentUser && !isAdmin && (
                        <button
                          type="button"
                          onClick={() => (isDisabled ? handleEnableUser(user.id) : handleDisableUser(user.id))}
                          style={{
                            width: "100%",
                            padding: "10px 14px",
                            borderRadius: "8px",
                            border: "none",
                            background: isDisabled
                              ? "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)"
                              : "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
                            color: "#ffffff",
                            fontWeight: 600,
                            fontSize: "0.9rem",
                            cursor: "pointer",
                            transition: "all 0.3s ease",
                            boxShadow: isDisabled ? "0 4px 12px rgba(34, 197, 94, 0.2)" : "0 4px 12px rgba(239, 68, 68, 0.2)",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.02)";
                            (e.currentTarget as HTMLButtonElement).style.boxShadow = isDisabled
                              ? "0 8px 20px rgba(34, 197, 94, 0.3)"
                              : "0 8px 20px rgba(239, 68, 68, 0.3)";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
                            (e.currentTarget as HTMLButtonElement).style.boxShadow = isDisabled
                              ? "0 4px 12px rgba(34, 197, 94, 0.2)"
                              : "0 4px 12px rgba(239, 68, 68, 0.2)";
                          }}
                        >
                          {isDisabled ? "✅ Enable User" : "🔒 Disable User"}
                        </button>
                      )}
                      {(isCurrentUser || isAdmin) && (
                        <div style={{ padding: "10px", background: "#f1f5f9", borderRadius: "8px", textAlign: "center", fontSize: "0.85rem", color: "#64748b" }}>
                          {isCurrentUser ? "Current user" : "Admin account"}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Create User Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>✨ Create New User</DialogTitle>
            <DialogDescription>Add a new user account to your system</DialogDescription>
          </DialogHeader>

          <form
            onSubmit={handleCreateUser}
            style={{
              display: "grid",
              gap: "16px",
            }}
          >
            <label style={{ display: "grid", gap: "8px" }}>
              <span style={{ fontSize: "0.95rem", fontWeight: 600, color: "#0f172a" }}>👤 Username</span>
              <input
                type="text"
                value={formUsername}
                onChange={(e) => setFormUsername(e.target.value)}
                placeholder="john_doe"
                required
                style={{
                  padding: "12px 14px",
                  borderRadius: "10px",
                  border: "1px solid #e2e8f0",
                  fontFamily: "inherit",
                  fontSize: "0.95rem",
                  transition: "all 0.2s ease",
                }}
                onFocus={(e) => {
                  (e.currentTarget as HTMLInputElement).style.borderColor = "#3b82f6";
                  (e.currentTarget as HTMLInputElement).style.boxShadow = "0 0 0 3px rgba(59, 130, 246, 0.1)";
                }}
                onBlur={(e) => {
                  (e.currentTarget as HTMLInputElement).style.borderColor = "#e2e8f0";
                  (e.currentTarget as HTMLInputElement).style.boxShadow = "none";
                }}
              />
            </label>

            <label style={{ display: "grid", gap: "8px" }}>
              <span style={{ fontSize: "0.95rem", fontWeight: 600, color: "#0f172a" }}>📝 Display Name</span>
              <input
                type="text"
                value={formDisplayName}
                onChange={(e) => setFormDisplayName(e.target.value)}
                placeholder="John Doe"
                required
                style={{
                  padding: "12px 14px",
                  borderRadius: "10px",
                  border: "1px solid #e2e8f0",
                  fontFamily: "inherit",
                  fontSize: "0.95rem",
                  transition: "all 0.2s ease",
                }}
                onFocus={(e) => {
                  (e.currentTarget as HTMLInputElement).style.borderColor = "#3b82f6";
                  (e.currentTarget as HTMLInputElement).style.boxShadow = "0 0 0 3px rgba(59, 130, 246, 0.1)";
                }}
                onBlur={(e) => {
                  (e.currentTarget as HTMLInputElement).style.borderColor = "#e2e8f0";
                  (e.currentTarget as HTMLInputElement).style.boxShadow = "none";
                }}
              />
            </label>

            <label style={{ display: "grid", gap: "8px" }}>
              <span style={{ fontSize: "0.95rem", fontWeight: 600, color: "#0f172a" }}>🎓 Role</span>
              <select
                value={formRole}
                onChange={(e) => setFormRole(e.target.value as UserRole)}
                style={{
                  padding: "12px 14px",
                  borderRadius: "10px",
                  border: "1px solid #e2e8f0",
                  fontFamily: "inherit",
                  fontSize: "0.95rem",
                  transition: "all 0.2s ease",
                }}
                onFocus={(e) => {
                  (e.currentTarget as HTMLSelectElement).style.borderColor = "#3b82f6";
                  (e.currentTarget as HTMLSelectElement).style.boxShadow = "0 0 0 3px rgba(59, 130, 246, 0.1)";
                }}
                onBlur={(e) => {
                  (e.currentTarget as HTMLSelectElement).style.borderColor = "#e2e8f0";
                  (e.currentTarget as HTMLSelectElement).style.boxShadow = "none";
                }}
              >
                <option value="INSTRUCTOR">📋 Instructor</option>
                <option value="TRAINEE">🎓 Trainee</option>
              </select>
            </label>

            <label style={{ display: "grid", gap: "8px" }}>
              <span style={{ fontSize: "0.95rem", fontWeight: 600, color: "#0f172a" }}>🔐 Password</span>
              <input
                type="password"
                value={formPassword}
                onChange={(e) => setFormPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={8}
                style={{
                  padding: "12px 14px",
                  borderRadius: "10px",
                  border: "1px solid #e2e8f0",
                  fontFamily: "inherit",
                  fontSize: "0.95rem",
                  transition: "all 0.2s ease",
                }}
                onFocus={(e) => {
                  (e.currentTarget as HTMLInputElement).style.borderColor = "#3b82f6";
                  (e.currentTarget as HTMLInputElement).style.boxShadow = "0 0 0 3px rgba(59, 130, 246, 0.1)";
                }}
                onBlur={(e) => {
                  (e.currentTarget as HTMLInputElement).style.borderColor = "#e2e8f0";
                  (e.currentTarget as HTMLInputElement).style.boxShadow = "none";
                }}
              />
              <span style={{ fontSize: "0.8rem", color: "#64748b" }}>Minimum 8 characters</span>
            </label>

            {formError && (
              <div
                style={{
                  padding: "12px",
                  borderRadius: "10px",
                  background: "#fee2e2",
                  border: "1px solid #fecaca",
                  color: "#991b1b",
                  fontSize: "0.9rem",
                  display: "flex",
                  gap: "8px",
                  alignItems: "flex-start",
                }}
              >
                <span>⚠️</span>
                <div>{formError}</div>
              </div>
            )}

            <DialogFooter>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setFormUsername("");
                  setFormDisplayName("");
                  setFormPassword("");
                  setFormRole("INSTRUCTOR");
                  setFormError(null);
                }}
                style={{
                  padding: "12px 20px",
                  borderRadius: "10px",
                  border: "1px solid #e2e8f0",
                  background: "#f8fafc",
                  color: "#0f172a",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "#f1f5f9";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "#cbd5e1";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "#f8fafc";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "#e2e8f0";
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={formBusy}
                style={{
                  padding: "12px 20px",
                  borderRadius: "10px",
                  border: "none",
                  background: formBusy ? "#cbd5e1" : "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                  color: "#ffffff",
                  fontWeight: 600,
                  cursor: formBusy ? "not-allowed" : "pointer",
                  transition: "all 0.2s ease",
                  boxShadow: formBusy ? "none" : "0 4px 12px rgba(59, 130, 246, 0.3)",
                }}
                onMouseEnter={(e) => {
                  if (!formBusy) {
                    (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 8px 20px rgba(59, 130, 246, 0.4)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!formBusy) {
                    (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 12px rgba(59, 130, 246, 0.3)";
                  }
                }}
              >
                {formBusy ? "⏳ Creating..." : "✨ Create User"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
