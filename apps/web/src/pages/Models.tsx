import { useEffect, useState } from "react";
import EmptyState from "../components/EmptyState";
import { api } from "../lib/api";

interface ModelRow {
  version: string;
  architecture?: string | null;
  datasetVersion?: string | null;
  trainingDate?: string | null;
  accuracy?: number | null;
  f1Score?: number | null;
  notes?: string | null;
  isActive: boolean;
}

interface BalanceSummary {
  totalApproved: number;
  dominantClass: string | null;
  dominantShare: number;
  severity: "unknown" | "ok" | "attention" | "critical";
  message: string;
}

const SEVERITY_STYLE: Record<BalanceSummary["severity"], string> = {
  unknown: "bg-slate-100 text-slate-600",
  ok: "bg-green-100 text-green-700",
  attention: "bg-amber-100 text-amber-800",
  critical: "bg-red-100 text-red-700",
};

/** Models page — registry of trained candidates. Promotion to active is a
 *  human research decision and is intentionally NOT exposed here.
 *
 *  Honesty overlay: when the research dataset is dominated by one class,
 *  overall accuracy can look high while the model has really only learned the
 *  majority class. A balance warning is shown so metrics are never read in
 *  isolation. */
export default function Models() {
  const [items, setItems] = useState<ModelRow[] | null>(null);
  const [note, setNote] = useState<string | undefined>();
  const [balance, setBalance] = useState<BalanceSummary | null>(null);

  useEffect(() => {
    api.models().then((r) => {
      setItems(r.items as ModelRow[]);
      setNote(r.note);
    }).catch(() => setItems([]));
    fetch("/api/datasets/status")
      .then((r) => r.json())
      .then((d) => setBalance(d.balanceSummary ?? null))
      .catch(() => setBalance(null));
  }, []);

  const showBanner = balance && balance.totalApproved > 0 && balance.severity !== "ok";
  const metricsUnreliable = !!showBanner;

  return (
    <div className="space-y-4">
      {/* Balance honesty overlay — shown when dataset is class-skewed */}
      {showBanner && (
        <div className={`rounded-lg border p-4 ${balance.severity === "critical" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
          <p className={`text-sm font-semibold ${balance.severity === "critical" ? "text-red-800" : "text-amber-800"}`}>
            ⚠️ Imbalanced dataset — interpret metrics with caution
          </p>
          <p className={`text-sm mt-1 ${balance.severity === "critical" ? "text-red-700" : "text-amber-700"}`}>
            {balance.message} Accuracy can appear high while the model mainly
            predicts this majority class. Check <strong>Macro F1</strong> and
            per-class recall before drawing any conclusion.
          </p>
          <p className="text-xs mt-2 text-gray-500">
            {balance.severity === "critical"
              ? "Many classes have very few approved images. Prioritize acquiring the underrepresented classes."
              : "One class dominates. Consider balancing acquisition for a defensible evaluation."}
          </p>
        </div>
      )}

      <div className="rounded-lg bg-sky-50 border border-sky-200 p-3 text-xs text-sky-900">
        Model versions registered from real training runs. Evaluation metrics come
        from Phase-6 test evaluation; pilot/pipeline-validation entries are labeled as such.
        When the dataset is class-imbalanced (above), accuracy alone is not a reliable
        measure — <strong>Macro F1</strong> and per-class performance matter more.
        Promoting a model to <em>active</em> is a research decision made outside this interface.
      </div>

      {items === null ? (
        <p className="text-gray-500">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState
          title="No models registered yet"
          message={
            note ??
            "Model versions appear here after the Pipeline Runner trains candidates on a dataset version."
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm bg-white rounded-lg border border-gray-200">
            <thead className="text-left border-b border-gray-200 text-gray-500">
              <tr>
                <th className="p-3">Version</th>
                <th className="p-3">Architecture</th>
                <th className="p-3">Dataset</th>
                <th className="p-3">Trained</th>
                <th className="p-3">Test acc</th>
                <th className="p-3">Macro F1</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.version} className="border-b last:border-0 border-gray-100">
                  <td className="p-3 font-mono">{m.version}</td>
                  <td className="p-3">{m.architecture ?? "—"}</td>
                  <td className="p-3 font-mono text-xs">{m.datasetVersion ?? "—"}</td>
                  <td className="p-3 text-xs">
                    {m.trainingDate ? new Date(m.trainingDate).toLocaleDateString() : "—"}
                  </td>
                  <td className={`p-3 ${metricsUnreliable ? "text-slate-400" : ""}`} title={metricsUnreliable ? "Skewed dataset — accuracy is unreliable" : ""}>
                    {m.accuracy != null ? m.accuracy : "—"}
                    {metricsUnreliable && <span className="ml-1 text-xs text-amber-600" aria-label="unreliable due to imbalance">⚠</span>}
                  </td>
                  <td className={`p-3 ${metricsUnreliable ? "text-slate-400" : ""}`} title={metricsUnreliable ? "Skewed dataset — macro F1 reflects imbalance" : ""}>
                    {m.f1Score != null ? m.f1Score : "—"}
                  </td>
                  <td className="p-3">
                    {m.isActive ? (
                      <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs">
                        Active
                      </span>
                    ) : /PILOT|pipeline/i.test(m.notes ?? "") ? (
                      <span className={`px-2 py-0.5 rounded-full text-xs ${metricsUnreliable ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"}`}>
                        Pilot{metricsUnreliable ? " — imbalanced" : ""}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">candidate</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
