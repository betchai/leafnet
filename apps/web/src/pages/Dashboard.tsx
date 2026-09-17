import { useEffect, useState } from "react";
import EmptyState from "../components/EmptyState";
import { api, apiFetch, ClassConfig, PredictionHistoryRow } from "../lib/api";

interface Status {
  research: Record<string, number>;
  devFixtures: number;
  perClass: Record<string, Record<string, number>>;
  activeModel: { version: string; architecture: string } | null;
  feedbackCount: number;
  openDuplicateFlags: number;
  note: string | null;
}

/** Functional application dashboard — live data only, honest empty states. */
export default function Dashboard() {
  const [classes, setClasses] = useState<ClassConfig | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [recent, setRecent] = useState<PredictionHistoryRow[]>([]);

  useEffect(() => {
    api.classes().then(setClasses).catch(() => {});
    apiFetch("/datasets/status").then((r) => r.json()).then(setStatus).catch(() => {});
    api.predictionHistory(5).then((r) => setRecent(r.items)).catch(() => {});
  }, []);

  const labelOf = (k?: string) =>
    classes?.classes.find((c) => c.key === k)?.label ?? k ?? "—";

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold mb-3">System status</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Approved images"
            value={status ? String(status.research.approved) : "…"}
            sub={status ? `of ${status.research.totalAcquired} acquired · target 2,000` : ""}
          />
          <StatCard
            label="Active model"
            value={status?.activeModel?.version ?? "None"}
            sub={status?.activeModel ? status.activeModel.architecture : "no model promoted yet"}
          />
          <StatCard
            label="Feedback recorded"
            value={status ? String(status.feedbackCount) : "…"}
            sub="awaiting Phase 9.1 review workflow"
          />
          <StatCard
            label="Open duplicate flags"
            value={status ? String(status.openDuplicateFlags) : "…"}
            sub="need human resolution"
          />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Leaf health classes</h2>
        {classes ? (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {classes.classes.map((c) => (
              <li key={c.key} className="rounded-lg bg-white border border-gray-200 p-4">
                <p className="font-medium">{c.label}</p>
                <p className="text-sm text-gray-500 line-clamp-2">{c.description}</p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Class configuration unavailable" message="Expected ml/src/config/classes.json." />
        )}
      </section>

      <section className="rounded-lg bg-white border border-gray-200 p-5">
        <h2 className="font-semibold mb-3">Recent predictions</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-500">
            No predictions yet. Upload a mulberry leaf in the Leaf Analyzer to begin.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {recent.map((p) => (
              <li key={p.predictionId} className="py-2 flex items-center justify-between gap-3">
                <span className="truncate flex-1 text-gray-600">{p.filename}</span>
                <span className="font-medium">{labelOf(p.predictedClass)}</span>
                <span className="text-gray-400 w-14 text-right">
                  {p.confidence != null ? `${(p.confidence * 100).toFixed(0)}%` : "—"}
                </span>
                <span className="text-gray-400 text-xs hidden sm:block">
                  {new Date(p.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {status?.note && <p className="text-xs text-gray-400">{status.note}</p>}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg bg-white border border-gray-200 p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold mt-1 truncate" title={value}>{value}</p>
      <p className="text-xs text-gray-400 mt-1">{sub}</p>
    </div>
  );
}
