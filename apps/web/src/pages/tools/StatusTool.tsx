// TOOLS
import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

interface Composition {
  research: Record<string, number>;
  devFixtures: number;
  perClass: Record<string, Record<string, number>>;
  classImbalanceApproved: number;
  balanceWarning: string | null;
  openDuplicateFlags: number;
  note: string | null;
}

/** Dataset Status — live acquisition/verification progress vs the 500/class target. */
export default function StatusTool() {
  const [c, setC] = useState<Composition | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/datasets/status")
      .then((r) => r.json())
      .then(setC)
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <p className="text-sm text-red-600">API unreachable: {err}</p>;
  if (!c) return <p className="text-gray-500">Loading…</p>;

  const classes = ["healthy", "leaf_rust", "leaf_spot", "leaf_blight", "not_mulberry"];
  const stages = ["acquired", "annotated", "verified", "approved", "rejected", "uncertain"] as const;

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Research acquired" value={c.research.totalAcquired} sub="target 2500" />
        <Card label="Approved" value={c.research.approved} sub={`shortfall ${Math.max(0, 2500 - c.research.approved)}`} />
        <Card label="Dev fixtures (excluded)" value={c.devFixtures} sub="never counted as research" />
        <Card label="Open duplicate flags" value={c.openDuplicateFlags} sub="need human resolution" />
      </section>

      <section className="rounded-lg bg-white border border-gray-200 p-5 overflow-x-auto">
        <h2 className="font-semibold mb-3">Per-class lifecycle vs 500/class target</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500 border-b">
            <tr>
              <th className="py-2 pr-4">Class</th>
              {stages.map((s) => <th key={s} className="pr-4">{s}</th>)}
              <th>approved / 500</th>
            </tr>
          </thead>
          <tbody>
            {classes.map((cls) => {
              const row = c.perClass[cls] ?? {};
              const approved = row.approved ?? 0;
              return (
                <tr key={cls} className="border-b last:border-0 border-gray-100">
                  <td className="py-2 pr-4 font-medium">{cls}</td>
                  {stages.map((s) => <td key={s} className="pr-4">{row[s] ?? 0}</td>)}
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-leaf-500" style={{ width: `${(approved / 500) * 100}%` }} />
                      </div>
                      {approved}/500
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {c.balanceWarning && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">
          ⚠️ {c.balanceWarning}
        </p>
      )}
      {c.note && <p className="text-xs text-gray-400">{c.note}</p>}

      <CutVersion />
    </div>
  );
}

function CutVersion() {
  const [version, setVersion] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<{ version: string; totalImages: number | null; status: string }[]>([]);

  async function refresh() {
    const r = await apiFetch("/datasets").then((r) => r.json());
    setDatasets(r.items ?? []);
  }
  useEffect(() => {
    refresh();
  }, []);

  async function cut() {
    if (!version.trim()) return setMsg("Enter a version, e.g. v0.1");
    const r = await apiFetch("/datasets/cut", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: version.trim() }),
    });
    const d = await r.json();
    setMsg(
      r.ok
        ? `✅ Cut ${d.dataset.version}: ${d.members} approved research images (${JSON.stringify(d.perClass)})`
        : `Failed: ${d.error}`
    );
    if (r.ok) {
      setVersion("");
      refresh();
    }
  }

  return (
    <section className="rounded-lg bg-white border border-gray-200 p-5 space-y-3">
      <h2 className="font-semibold">Cut dataset version</h2>
      <p className="text-xs text-gray-500">
        Snapshots all APPROVED research images into a versioned dataset
        (manifest-exportable). Dev fixtures are excluded by definition.
      </p>
      <div className="flex flex-wrap gap-2 text-sm">
        <input className="border rounded px-2 py-1 w-32" placeholder="e.g. v0.1"
          value={version} onChange={(e) => setVersion(e.target.value)} />
        <button onClick={cut}
          className="px-4 py-1.5 rounded bg-slate-700 text-white font-medium">Cut version</button>
      </div>
      {msg && <p className="text-sm text-slate-600 bg-slate-50 rounded p-2">{msg}</p>}
      {datasets.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500 border-b">
            <tr><th className="py-1.5 pr-4">Version</th><th className="pr-4">Images</th><th>Status</th></tr>
          </thead>
          <tbody>
            {datasets.map((d) => (
              <tr key={d.version} className="border-b last:border-0 border-gray-100">
                <td className="py-1.5 pr-4 font-mono">{d.version}</td>
                <td className="pr-4">{d.totalImages ?? "—"}</td>
                <td>{d.status.toLowerCase()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Card({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="rounded-lg bg-white border border-gray-200 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      <p className="text-[11px] text-gray-400">{sub}</p>
    </div>
  );
}
