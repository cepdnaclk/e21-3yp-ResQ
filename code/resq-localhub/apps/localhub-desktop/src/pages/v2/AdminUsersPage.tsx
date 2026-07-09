import { useEffect, useState } from "react";
import { fetchUsers, createUser, disableUser, enableUser } from "../../api/authApi";
import type { AuthUser, UserRole } from "../../types/auth";
import Card, { CardHeader } from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import PageHeader from "../../components/ui/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";
import { useAuth } from "../../auth/AuthContext";

export function AdminUsersPage() {
  const { currentUser } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("TRAINEE");
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  async function loadUsers() {
    try {
      const data = await fetchUsers();
      setUsers(data);
    } catch (err) {
      setError("Failed to retrieve user accounts directory.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !displayName.trim() || !password) return;

    setFormLoading(true);
    setFormError(null);

    try {
      await createUser({
        username: username.trim(),
        displayName: displayName.trim(),
        password,
        role,
      });
      setUsername("");
      setDisplayName("");
      setPassword("");
      setRole("TRAINEE");
      setShowAddForm(false);
      await loadUsers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create user account.");
    } finally {
      setFormLoading(false);
    }
  }

  async function handleToggleStatus(user: AuthUser) {
    if (!user.id) {
      setError("User ID unavailable");
      return;
    }
    if (currentUser && currentUser.id === user.id) {
      setError("You cannot disable your own active admin account.");
      return;
    }
    setError(null);
    try {
      if (!user.disabledAt) {
        await disableUser(user.id);
      } else {
        await enableUser(user.id);
      }
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user status.");
    }
  }

  if (loading) {
    return <LoadingState message="Loading user accounts directory..." />;
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto select-none">
      <PageHeader
        title="User Accounts Directory"
        subtitle="Manage login accounts for instructors, clinical coordinators, and trainees."
        actions={
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              setShowAddForm(!showAddForm);
              setFormError(null);
            }}
          >
            {showAddForm ? "Close Form" : "Add Account"}
          </Button>
        }
      />

      {error && (
        <Card className="border-rose-100 bg-rose-50/50 text-rose-800 p-4 animate-fadeIn">
          <p className="text-xs font-semibold">{error}</p>
        </Card>
      )}

      {/* Add User Form Modal/Dropdown */}
      {showAddForm && (
        <Card className="max-w-xl mx-auto shadow-lg animate-fadeIn border border-slate-100 p-6">
          <CardHeader title="Create User Account" />
          <form onSubmit={handleCreateUser} className="space-y-4 mt-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Username</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 hover:bg-slate-50 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  placeholder="e.g. jsmith"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Display Name</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 hover:bg-slate-50 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  placeholder="e.g. Dr. Alex Mercer"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 hover:bg-slate-50 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  placeholder="••••••••"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="block w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50/50 hover:bg-slate-50 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                >
                  <option value="TRAINEE">Trainee</option>
                  <option value="INSTRUCTOR">Instructor</option>
                  <option value="ADMIN">Administrator</option>
                </select>
              </div>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-100 text-xs font-semibold text-rose-700 leading-normal">
                {formError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 mt-2">
              <Button type="button" variant="secondary" onClick={() => setShowAddForm(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={formLoading}>
                Add Account
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Users table */}
      <div className="bg-white border border-slate-100 rounded-2xl shadow-[0_4px_16px_rgba(0,0,0,0.01)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-xs">
            <thead className="bg-slate-50/70">
              <tr>
                <th scope="col" className="px-6 py-4.5 text-left font-bold text-slate-400 uppercase tracking-widest">
                  Username
                </th>
                <th scope="col" className="px-6 py-4.5 text-left font-bold text-slate-400 uppercase tracking-widest">
                  Display Name
                </th>
                <th scope="col" className="px-6 py-4.5 text-left font-bold text-slate-400 uppercase tracking-widest">
                  System Role
                </th>
                <th scope="col" className="px-6 py-4.5 text-left font-bold text-slate-400 uppercase tracking-widest">
                  Account Status
                </th>
                <th scope="col" className="relative px-6 py-4.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-slate-600 font-medium">
              {users.map((u) => (
                <tr key={u.username} className="hover:bg-slate-50/40 transition-colors duration-200">
                  <td className="px-6 py-4 whitespace-nowrap font-bold text-slate-800 font-mono">
                    {u.username}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-slate-700">
                    {u.displayName}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <StatusBadge
                      tone={u.role === "ADMIN" ? "danger" : u.role === "INSTRUCTOR" ? "info" : "muted"}
                      label={u.role}
                      dot={false}
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <StatusBadge
                      tone={!u.disabledAt ? "success" : "muted"}
                      label={!u.disabledAt ? "Active" : "Disabled"}
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right font-medium">
                    <Button
                      type="button"
                      variant={!u.disabledAt ? "danger" : "success"}
                      size="sm"
                      disabled={!u.id || !!(currentUser && currentUser.id === u.id)}
                      onClick={() => handleToggleStatus(u)}
                    >
                      {!u.id ? "User ID unavailable" : (!u.disabledAt ? "Disable" : "Enable")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default AdminUsersPage;
