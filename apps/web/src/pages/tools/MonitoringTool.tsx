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
  lab_vs_field: LabVsField[];
  real_world_confusion_pairs_verified: Record<string, number>;
  review_backlog: number;
}

interface LabVsField {
  version: string;
  is_active: boolean;
  lifecycle_status: string;
  dataset_version: string | null;
  lab: {
    accuracy: number | null;
    f1_score: number | null;
    acceptance_verdict: string | null;
  };
  field: {
    predictions: number;
    feedback_count: number;
    disagreements: number;
    verified_total: number;
    verified_accuracy: number | null;
    verified_wrong: number;
    average_confidence: number | null;
    low_confidence_rate: number | null;
  };
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

      <section className="rounded-lg bg-white border p-4">
        <h3 className="font-semibold text-sm mb-2">Model quality vs field performance</h3>
        <p className="text-xs text-gray-500 mb-3">
          Lab bars come from the held-out acceptance run (metrics.json). Field bars come from
          expert-verified feedback — the ratio of user-"agree" among cases an expert reviewed.
          Blank field bars mean no verified feedback yet for that version.
        </p>
        {(s.lab_vs_field ?? []).length === 0 ? (
          <p className="text-sm text-gray-500">No model versions exist yet.</p>
        ) : (
          <div className="space-y-4">
            {s.lab_vs_field.map((m) => {
              const lab = m.lab.accuracy != null ? m.lab.accuracy * 100 : null;
              return (
                <div key={m.version} className="border border-gray-100 rounded-lg p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold">{m.version}</span>
                    <VerdictBadge verdict={m.lab.acceptance_verdict} />
                    {m.is_active && (
                      <span className="px-1.5 py-0.5 rounded bg-leaf-100 text-leaf-800 text-[11px] font-medium">
                        ACTIVE
                      </span>
                    )}
                    <span className="text-[11px] text-gray-400">
                      {m.lifecycle_status} · dataset {m.dataset_version ?? "—"} · f1{" "}
                      {m.lab.f1_score != null ? (m.lab.f1_score * 100).toFixed(1) : "—"}%
                    </span>
                  </div>
                  <BarRow label="Lab (held-out)" pct={lab} note={lab != null ? `${lab.toFixed(1)}%` : "no run"} color="bg-slate-600" />
                  <BarRow
                    label="Field (verified feedback)"
                    pct={m.field.verified_accuracy}
                    note={
                      m.field.verified_total > 0
                        ? `${m.field.verified_accuracy}% · n=${m.field.verified_total} (${m.field.verified_wrong} wrong)`
                        : "no verified feedback yet"
                    }
                    color="bg-sky-600"
                  />
                  <p className="text-[11px] text-gray-400">
                    {m.field.predictions} predictions · {m.field.feedback_count} feedback ·{" "}
                    {m.field.disagreements} disagreements · avg conf{" "}
                    {m.field.average_confidence ?? "—"} · low-conf{" "}
                    {m.field.low_confidence_rate ?? "—"}%
                  </p>
                </div>
              );
            })}
          </div>
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
function BarRow({ label, pct, note, color }: { label: string; pct: number | null; note: string; color: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-44 shrink-0 text-gray-500">{label}</span>
      <div className="flex-1 h-3 rounded bg-gray-100 overflow-hidden">
        {pct != null && (
          <div className={`h-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
        )}
      </div>
      <span className="w-48 shrink-0 text-right text-gray-400">{note}</span>
    </div>
  );
}
function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return <span className="text-[11px] text-gray-400">no verdict</span>;
  const style =
    verdict === "PASS" ? "bg-green-100 text-green-800"
    : verdict === "FAIL" ? "bg-red-100 text-red-800"
    : "bg-amber-100 text-amber-800";
  return (
    <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-medium ${style}`}>{verdict}</span>
  );
}
