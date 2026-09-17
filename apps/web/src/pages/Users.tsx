import { FormEvent, useCallback, useEffect, useState } from "react";
import { ManagedUser, userApi } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

const ROLES = ["FARMER", "RESEARCHER", "EXPERT"] as const;
const STATUSES = ["ACTIVE", "DISABLED"] as const;

const ROLE_LABEL: Record<string, string> = {
  FARMER: "Farmer",
  RESEARCHER: "Researcher",
  EXPERT: "Expert",
};

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  // reset-password form state per user
  const [pwForms, setPwForms] = useState<Record<string, string>>({});
  // create-user form state
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "RESEARCHER" as string });

  const refresh = useCallback(async () => {
    try {
      setUsers((await userApi.list()).items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    try {
      await userApi.create(form);
      setMsg(`✓ Created ${form.email}`);
      setForm({ name: "", email: "", password: "", role: "RESEARCHER" });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onChangeRole(id: string, role: string) {
    setMsg(null);
    setError(null);
    try {
      await userApi.update(id, { role });
      setMsg("✓ Role updated (audited).");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onToggleStatus(u: ManagedUser) {
    const next = u.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    setMsg(null);
    setError(null);
    try {
      await userApi.update(u.id, { status: next });
      setMsg(next === "ACTIVE" ? `✓ ${u.email} re-enabled.` : `✓ ${u.email} disabled (sessions revoked).`);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onResetPassword(id: string) {
    const pw = pwForms[id] ?? "";
    if (pw.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    setMsg(null);
    setError(null);
    try {
      await userApi.resetPassword(id, pw);
      setMsg("✓ Password reset (audited).");
      setPwForms((f) => ({ ...f, [id]: "" }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-sky-50 border border-sky-200 p-3 text-xs text-sky-900">
        <strong>User administration.</strong> Expert-only. There is no public self-registration —
        accounts are created here and demo accounts are seeded by the database seeder.
        All creation, role changes, status changes and password resets are recorded in the audit trail.
      </div>

      {msg && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-2">{msg}</p>}
      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</p>}

      {/* Create account */}
      <section className="rounded-lg bg-white border border-gray-200 p-5">
        <h2 className="font-semibold mb-3">Create account</h2>
        <form onSubmit={onCreate} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 text-sm">
          <input required placeholder="Full name" value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="border rounded px-2 py-1.5" />
          <input required type="email" placeholder="Email" value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="border rounded px-2 py-1.5" />
          <input required type="password" placeholder="Password (min 8)" value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className="border rounded px-2 py-1.5" />
          <select value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            className="border rounded px-2 py-1.5">
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
          <button type="submit" className="px-3 py-1.5 rounded bg-slate-800 text-white font-medium">
            Create
          </button>
        </form>
      </section>

      {/* List */}
      <section className="rounded-lg bg-white border border-gray-200 overflow-hidden">
        {users === null ? (
          <p className="p-4 text-sm text-gray-500">Loading…</p>
        ) : users.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">No accounts yet. Create one above.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-gray-500 border-b border-gray-200">
              <tr>
                <th className="p-3">Name</th>
                <th className="p-3">Email</th>
                <th className="p-3">Role</th>
                <th className="p-3">Status</th>
                <th className="p-3">Last login</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const open = openIds.has(u.id);
                const isMe = me?.id === u.id;
                return (
                  <tr key={u.id} className="border-b last:border-0 border-gray-100">
                    <td className="p-3 font-medium">{u.name}{isMe && <span className="ml-1 text-xs text-gray-400">(you)</span>}</td>
                    <td className="p-3 text-gray-600">{u.email}</td>
                    <td className="p-3">
                      <select value={u.role} disabled={isMe}
                        onChange={(e) => onChangeRole(u.id, e.target.value)}
                        className="border rounded px-2 py-1 text-xs disabled:opacity-50">
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${u.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"}`}>
                        {u.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-gray-500">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "never"}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1.5">
                        <button disabled={isMe} onClick={() => onToggleStatus(u)}
                          className={`px-2 py-1 rounded text-xs font-medium disabled:opacity-40 ${u.status === "ACTIVE" ? "border border-red-300 text-red-600 hover:bg-red-50" : "border border-green-300 text-green-700 hover:bg-green-50"}`}>
                          {u.status === "ACTIVE" ? "Disable" : "Enable"}
                        </button>
                        <button onClick={() => setOpenIds((s) => { const n = new Set(s); n.has(u.id) ? n.delete(u.id) : n.add(u.id); return n; })}
                          className="px-2 py-1 rounded text-xs border border-gray-300 hover:bg-gray-50">
                          {open ? "Hide reset" : "Reset pw"}
                        </button>
                      </div>
                      {open && (
                        <div className="mt-2 flex gap-2">
                          <input type="password" placeholder="New password (min 8)" value={pwForms[u.id] ?? ""}
                            onChange={(e) => setPwForms((f) => ({ ...f, [u.id]: e.target.value }))}
                            className="border rounded px-2 py-1 text-xs" />
                          <button onClick={() => onResetPassword(u.id)}
                            className="px-2 py-1 rounded text-xs font-medium bg-amber-500 text-white hover:bg-amber-600">
                            Save
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}