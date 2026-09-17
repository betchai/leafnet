// TOOLS (Phase 9.1): monitoring dashboard — model behavior signals with honest
// "baseline being established" states.
import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

interface Summary {
  total_predictions: number;
  baseline_note: string;
  overall: {
    avg_confidence: number | null;
    low_confidence_pct: number | null;
    feedback_pct: number | null;
    disagreement_pct: number | null;
    verified_accuracy: number | null;
    verified_accuracy_note: string;
  };
  by_model: Record<string, any>;
  real_world_confusion_pairs_verified: Record<string, number>;
  review_backlog: number;
}

export default function MonitoringTool() {
  const [s, setS] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/tools/monitoring/summary").then((r) => r.json()).then(setS).catch((e) => setErr(String(e)));
  }, []);

  if (err) return <p className="text-sm text-red-700">{err}</p>;
  if (!s) return <p className="text-gray-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-slate-100 border border-slate-200 p-3 text-xs text-slate-600">
        {s.baseline_note} Verified accuracy is computed only over expert-verified cases —
        never from raw user feedback.
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card label="Predictions" value={String(s.total_predictions)} />
        <Card label="Avg confidence" value={s.overall.avg_confidence != null ? String(s.overall.avg_confidence) : "—"} />
        <Card label="Low-confidence %" value={fmtPct(s.overall.low_confidence_pct)} />
        <Card label="Feedback rate" value={fmtPct(s.overall.feedback_pct)} />
        <Card label="Review backlog" value={String(s.review_backlog)} />
      </div>

      <section className="rounded-lg bg-white border p-4">
        <h3 className="font-semibold text-sm mb-2">Verified outcomes</h3>
        {s.overall.verified_accuracy != null ? (
          <p className="text-sm">
            Verified accuracy: <strong>{s.overall.verified_accuracy}%</strong> over{" "}
            expert-verified cases only. Disagreement rate: {fmtPct(s.overall.disagreement_pct)}
          </p>
        ) : (
          <p className="text-sm text-gray-500">{s.overall.verified_accuracy_note}</p>
        )}
      </section>

      <section className="rounded-lg bg-white border p-4 space-y-3">
        <h3 className="font-semibold text-sm">By model version</h3>
        {Object.keys(s.by_model).length === 0 ? (
          <p className="text-sm text-gray-500">No predictions recorded yet.</p>
        ) : (
          Object.entries(s.by_model).map(([v, g]: [string, any]) => (
            <details key={v}>
              <summary className="cursor-pointer text-sm font-medium">
                {v} · {g.predictions} predictions · lifecycle: {g.lifecycle ?? "—"}
              </summary>
              <ul className="ml-5 mt-1 text-xs text-gray-600 space-y-0.5">
                <li>avg confidence: {g.avg_confidence ?? "—"}</li>
                <li>low-confidence rate: {g.low_confidence_rate ?? "—"}%</li>
                <li>feedback: {g.feedback_count} · disagreements: {g.disagreements} · verified corrections: {g.verified_corrections}</li>
                <li>class distribution: {JSON.stringify(g.class_distribution)}</li>
              </ul>
            </details>
          ))
        )}
      </section>

      <section className="rounded-lg bg-white border p-4">
        <h3 className="font-semibold text-sm mb-2">Real-world confusion pairs (verified only)</h3>
        {Object.keys(s.real_world_confusion_pairs_verified).length === 0 ? (
          <p className="text-sm text-gray-500">No verified corrections yet.</p>
        ) : (
          <ul className="text-sm list-disc ml-5">
            {Object.entries(s.real_world_confusion_pairs_verified).map(([k, n]) => (
              <li key={k}>{k} — {n}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function fmtPct(v: number | null) { return v != null ? `${v}%` : "—"; }
function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white border p-3">
      <p className="text-xs text-gray-500 truncate">{label}</p>
      <p className="font-bold text-xl">{value}</p>
    </div>
  );
}
