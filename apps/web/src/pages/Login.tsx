import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const DEMO_ACCOUNTS = [
  { label: "Farmer", email: "farmer.demo@mulberry.local", password: "FarmerDemo2026!", role: "FARMER", hint: "Analyzer only" },
  { label: "Researcher", email: "researcher.demo@mulberry.local", password: "ResearcherDemo2026!", role: "RESEARCHER", hint: "Acquire, label, bulk ingest" },
  { label: "Expert", email: "expert.demo@mulberry.local", password: "ExpertDemo2026!", role: "EXPERT", hint: "Full access" },
] as const;

const ROLE_HOME: Record<string, string> = {
  FARMER: "/analyzer",
  RESEARCHER: "/dashboard",
  EXPERT: "/dashboard",
};

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await login(email, password);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "Login failed.");
      return;
    }
    const home = ROLE_HOME[r.user?.role ?? "FARMER"] ?? "/analyzer";
    navigate(from && from !== "/login" ? from : home, { replace: true });
  }

  // Quick demo login without the navigate-target complexity above.
  async function demoLogin(demo: (typeof DEMO_ACCOUNTS)[number]) {
    setBusy(true);
    setError(null);
    const r = await login(demo.email, demo.password);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "Demo login failed.");
      return;
    }
    navigate(ROLE_HOME[demo.role] ?? "/analyzer", { replace: true });
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <Link to="/" className="text-3xl font-bold text-leaf-700">🍃 Leafnet</Link>
          <p className="mt-1 text-sm text-gray-500">Sign in to continue</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl bg-white border border-gray-200 shadow-sm p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-leaf-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-leaf-500 focus:outline-none"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy}
            className="w-full py-2.5 rounded-lg bg-leaf-600 text-white font-semibold disabled:opacity-40">
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <p className="text-xs text-gray-400 text-center">
            Accounts are created by administrators — no public registration.
          </p>
        </form>

        <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
          <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">Demo accounts</p>
          <div className="space-y-2">
            {DEMO_ACCOUNTS.map((d) => (
              <button key={d.email} onClick={() => demoLogin(d)} disabled={busy}
                className="w-full flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-leaf-50 disabled:opacity-50 text-left">
                <span className="font-medium text-gray-800">{d.label}</span>
                <span className="text-xs text-gray-400">{d.hint}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-gray-400">
            One-click demo sign-in. Real accounts are managed by an Expert under <em>Users</em>.
          </p>
        </div>
      </div>
    </div>
  );
}