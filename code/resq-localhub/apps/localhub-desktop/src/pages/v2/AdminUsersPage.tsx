import { useEffect, useState } from "react";
import { fetchUsers, createUser, disableUser, enableUser } from "../../api/authApi";
import type { AuthUser, UserRole } from "../../types/auth";
import Card, { CardHeader } from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import LoadingState from "../../components/ui/LoadingState";
import PageHeader from "../../components/ui/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";

export function AdminUsersPage() {
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
      setError("Failed to retrieve user accounts database.");
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
    setError(null);
    try {
      if (!user.disabledAt) {
        await disableUser(user.username);
      } else {
        await enableUser(user.username);
      }
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user status.");
    }
  }

  if (loading) {
    return <LoadingState message="Loading user accounts database..." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Accounts Management"
        subtitle="Create, configure, and suspend accounts for training instructors, admins, and trainees."
        actions={
          <Button
            type="button"
            onClick={() => {
              setShowAddForm(!showAddForm);
              setFormError(null);
            }}
          >
            {showAddForm ? "Hide Form" : "Create New User"}
          </Button>
        }
      />

      {error && (
        <Card className="border-red-200 bg-red-50 text-red-800 p-4">
          <p className="text-sm font-semibold">{error}</p>
        </Card>
      )}

      {/* Add User Form Modal/Dropdown */}
      {showAddForm && (
        <Card className="max-w-xl">
          <CardHeader title="Create New Account" />
          <form onSubmit={handleCreateUser} className="space-y-4 mt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700">Username</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                  placeholder="e.g. jsmith"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700">Display Name</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                  placeholder="e.g. Jane Smith"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                  placeholder="••••••••"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                >
                  <option value="TRAINEE">Trainee</option>
                  <option value="INSTRUCTOR">Instructor</option>
                  <option value="ADMIN">Administrator</option>
                </select>
              </div>
            </div>

            {formError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-semibold text-red-700">
                {formError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setShowAddForm(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={formLoading}>
                Register Account
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Users table */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                  Username
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                  Display Name
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                  System Role
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                  Account Status
                </th>
                <th scope="col" className="relative px-6 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200 text-gray-700">
              {users.map((u) => (
                <tr key={u.username} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap font-mono font-medium text-gray-900">
                    {u.username}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
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
                      onClick={() => handleToggleStatus(u)}
                    >
                      {!u.disabledAt ? "Disable" : "Enable"}
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
