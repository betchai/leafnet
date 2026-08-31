import { useEffect, useState } from "react";
import EmptyState from "../components/EmptyState";
import { api } from "../lib/api";

interface ModelRow {
  id: string;
  version: string;
  architecture?: string | null;
  trainingDate?: string | null;
  accuracy?: number | null;
  f1Score?: number | null;
  notes?: string | null;
  isActive: boolean;
  lifecycleStatus: string;
}

interface BalanceSummary {
  totalApproved: number;
  dominantClass: string | null;
  dominantShare: number;
  severity: "unknown" | "ok" | "attention" | "critical";
  message: string;
}

interface PerClassRow {
  precision: number;
  recall: number;
  f1: number;
}

interface PerformanceDetail {
  model_version: string;
  dataset_version: string;
  test_size: number;
  accuracy: number;
  macro: { precision: number; recall: number; f1: number };
  per_class: Record<string, PerClassRow>;
  best_class_by_f1: string;
  weakest_class_by_f1: string;
  statistical_warning?: string | null;
  findings: string[];
}

interface ConfusionDetail {
  most_frequent_confusion: { actual: string; predicted: string; count: number } | null;
  total_misclassified: number;
  note: string;
}

interface ConfErrDetail {
  total_predictions: number;
  total_errors: number;
  high_confidence_errors: unknown[];
  low_confidence_predictions: number;
  finding: string;
}

interface Improvement {
  opportunity: string;
  evidence: string;
}

interface ModelDetail {
  model: {
    id: string;
    version: string;
    lifecycleStatus: string;
    isActive: boolean;
    architecture?: string | null;
    datasetVersion: string | null;
    trainedAt?: string | null;
    notes?: string | null;
  };
  detail: {
    performance: PerformanceDetail;
    confusion: ConfusionDetail;
    confidence_errors: ConfErrDetail;
    improvements: Improvement[];
  } | null;
  dataset: { splits: Record<string, Record<string, number>>; total_images: number } | null;
  missing?: string | null;
}

const SEVERITY_STYLE: Record<BalanceSummary["severity"], string> = {
  unknown: "bg-slate-100 text-slate-600",
  ok: "bg-green-100 text-green-700",
  attention: "bg-amber-100 text-amber-800",
  critical: "bg-red-100 text-red-700",
};

const LIFECYCLE_NEXT: Record<string, string> = {
  experimental: "evaluated",
  evaluated: "candidate",
  candidate: "approved",
  approved: "active",
};

/** Models page — registry of trained candidates with an in-wall governance
 *  facility: promote candidates through the lifecycle and (once approved) set
 *  one active. Activation is an expert-explicit, audited action that also
 *  switches the ML service. Clicking a row shows how the performance was
 *  computed and on what test data. */
export default function Models() {
  const [items, setItems] = useState<ModelRow[] | null>(null);
  const [note, setNote] = useState<string | undefined>();
  const [balance, setBalance] = useState<BalanceSummary | null>(null);

  const [actor, setActor] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] = useState<ModelDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);

  const refresh = async () => {
    setItems(null);
    const r = await api.models();
    setItems(r.items as ModelRow[]);
    setNote(r.note);
  };

  useEffect(() => {
    refresh().catch(() => setItems([]));
    fetch("/api/datasets/status")
      .then((r) => r.json())
      .then((d) => setBalance(d.balanceSummary ?? null))
      .catch(() => setBalance(null));
  }, []);

  const showBanner = balance && balance.totalApproved > 0 && balance.severity !== "ok";
  const metricsUnreliable = !!showBanner;

  async function promote(id: string, to: string) {
    if (!actor) return setMsg("Enter the acting researcher/expert name first.");
    setBusy(true);
    try {
      const r = await fetch(`/api/tools/models/${id}/lifecycle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, actor, reason: reason || undefined }),
      });
      const d = await r.json();
      setMsg(r.ok ? `✅ ${d.version} promoted → ${to}` : `Failed: ${d.error}`);
      setReason("");
      await refresh();
      if (selected?.model.id === id) setSelected(null);
    } finally {
      setBusy(false);
    }
  }

  async function activate(id: string) {
    if (!actor) return setMsg("Enter the acting researcher/expert name first.");
    setBusy(true);
    try {
      const r = await fetch(`/api/models/${id}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor, reason: reason || undefined }),
      });
      const d = await r.json();
      setMsg(
        r.ok
          ? `✅ Activated ${d.model_version} — ML now serves it${d.pilot ? " (PILOT model!)" : ""}.`
          : `Failed: ${d.error}`
      );
      setReason("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(id: string) {
    setSelected(null);
    setDetailLoading(true);
    try {
      const r = await fetch(`/api/models/${id}/detail`);
      const d: ModelDetail = await r.json();
      if (!r.ok) setMsg(`Detail failed: ${(d as unknown as { error?: string }).error ?? r.status}`);
      else setSelected(d);
    } catch {
      setMsg("Could not load model detail.");
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="space-y-4">
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
        Click a row to inspect <strong>how the performance was computed and on what test data</strong>.
        Promotion (<em>experimental → evaluated → candidate → approved</em>) and
        activation are explicit, audited expert actions performed here.
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="text-xs text-gray-500">Acting as (expert/researcher):</label>
        <input className="border rounded px-2 py-1 w-44" value={actor}
          onChange={(e) => setActor(e.target.value)} placeholder="expert name" />
        <label className="text-xs text-gray-500">Reason (optional):</label>
        <input className="border rounded px-2 py-1 w-64" value={reason}
          onChange={(e) => setReason(e.target.value)} placeholder="why this change" />
      </div>

      {msg && <p className="text-sm text-slate-700 bg-slate-100 rounded p-2">{msg}</p>}

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
                <th className="p-3">Trained</th>
                <th className="p-3">Test acc</th>
                <th className="p-3">Macro F1</th>
                <th className="p-3">Lifecycle</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => {
                const next = m.lifecycleStatus === "approved" ? null : LIFECYCLE_NEXT[m.lifecycleStatus];
                const deactivated = m.lifecycleStatus === "active" && !m.isActive;
                const chipLabel = m.isActive ? "Active" : deactivated ? "deactivated" : m.lifecycleStatus;
                return (
                  <tr key={m.version}
                    className="border-b last:border-0 border-gray-100 hover:bg-slate-50 cursor-pointer"
                    onClick={() => openDetail(m.id)}>
                    <td className="p-3 font-mono">
                      {m.version}
                      {m.isActive && (
                        <span className="ml-2 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs">Active</span>
                      )}
                      {/PILOT|pipeline/i.test(m.notes ?? "") && (
                        <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px]">pilot</span>
                      )}
                    </td>
                    <td className="p-3 text-xs">
                      {m.trainingDate ? new Date(m.trainingDate).toLocaleDateString() : "—"}
                    </td>
                    <td className={`p-3 ${metricsUnreliable ? "text-slate-400" : ""}`}>
                      {m.accuracy != null ? m.accuracy : "—"}
                      {metricsUnreliable && <span className="ml-1 text-xs text-amber-600" aria-label="unreliable due to imbalance">⚠</span>}
                    </td>
                    <td className={`p-3 ${metricsUnreliable ? "text-slate-400" : ""}`}>
                      {m.f1Score != null ? m.f1Score : "—"}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${m.isActive ? "bg-green-100 text-green-700" : deactivated ? "bg-gray-200 text-gray-500" : m.lifecycleStatus === "approved" ? "bg-emerald-50 text-emerald-700" : m.lifecycleStatus === "candidate" ? "bg-sky-100 text-sky-700" : m.lifecycleStatus === "retired" ? "bg-gray-200 text-gray-500" : "bg-slate-100 text-slate-500"}`}>
                        {chipLabel}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {m.lifecycleStatus === "approved" && !m.isActive && (
                          <button disabled={busy || !actor}
                            onClick={() => activate(m.id)}
                            className="px-2 py-1 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-40"
                            title="Set as the served model (deactivates others)">
                            Set active
                          </button>
                        )}
                        {m.isActive && (
                          <span className="text-xs text-green-700 font-medium self-center">serving</span>
                        )}
                        {next && !m.isActive && (
                          <button disabled={busy || !actor}
                            onClick={() => promote(m.id, next)}
                            className="px-2 py-1 rounded text-xs border border-slate-300 hover:bg-slate-50 disabled:opacity-40"
                            title={`Advance lifecycle to ${next} (audited)`}>
                            → {next}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detailLoading && <p className="text-sm text-gray-500">Loading performance record…</p>}

      {selected && (
        <DetailModal
          detail={selected}
          onClose={() => setSelected(null)}
          metricsUnreliable={metricsUnreliable}
        />
      )}
    </div>
  );
}

function DetailModal({ detail, onClose, metricsUnreliable }: {
  detail: ModelDetail;
  onClose: () => void;
  metricsUnreliable: boolean;
}) {
  const { model, detail: d, dataset, missing } = detail;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={`Model performance record for ${model.version}`}>
      <div className="bg-white rounded-xl max-w-3xl w-full shadow-xl my-8">
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="font-bold font-mono text-lg">{model.version}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {model.lifecycleStatus} · trained on dataset {model.datasetVersion ?? "—"}
              {model.architecture ? ` · ${model.architecture}` : ""}
              {/PILOT|pipeline/i.test(model.notes ?? "") && (
                <span className="ml-2 px-1.5 py-0.5 rounded bg-red-100 text-red-700">pilot-scale: results not research findings</span>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 px-2" aria-label="Close">✕</button>
        </div>

        {missing ? (
          <p className="p-5 text-sm text-gray-500">{missing}</p>
        ) : !d ? null : (
          <div className="p-5 space-y-5 text-sm">
            <PerformanceSummary p={d.performance} dataset={dataset} metricsUnreliable={metricsUnreliable} />
            {d.performance.statistical_warning && (
              <p className="text-xs rounded bg-amber-50 border border-amber-200 p-2 text-amber-800">{d.performance.statistical_warning}</p>
            )}
            <PerClassTable pc={d.performance.per_class} />
            <ConfusionBlock c={d.confusion} />
            <ConfidenceBlock ce={d.confidence_errors} />
            <ImprovementsBlock imps={d.improvements} />
            <p className="text-xs text-gray-400">All values computed from Phase-6 evaluation artifacts recorded by the pipeline runner.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function PerformanceSummary({ p, dataset, metricsUnreliable }: {
  p: PerformanceDetail;
  dataset: ModelDetail["dataset"];
  metricsUnreliable: boolean;
}) {
  const testSplit = dataset?.splits?.test;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Test accuracy" value={String(p.accuracy)} warn={metricsUnreliable} />
        <Stat label="Macro F1" value={String(p.macro.f1)} warn={metricsUnreliable} />
        <Stat label="Test set size" value={String(p.test_size)} />
        <Stat label="Best / weakest class by F1" value={`${p.best_class_by_f1} / ${p.weakest_class_by_f1}`} />
      </div>
      <div className="rounded bg-slate-50 border border-slate-200 p-3 space-y-1">
        <p className="text-xs uppercase tracking-wide text-gray-400">How it was computed</p>
        {p.findings.map((f, i) => (
          <p key={i} className="text-sm text-slate-700">{f}</p>
        ))}
        {testSplit && (
          <p className="text-sm text-slate-600">
            Test set composition:{" "}
            {Object.entries(testSplit)
              .map(([k, n]) => `${k} ${n}`)
              .join(" · ")}
          </p>
        )}
        {p.statistical_warning && <p className="text-xs text-amber-700">{p.statistical_warning}</p>}
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`font-semibold mt-0.5 ${warn ? "text-slate-400" : ""}`}>{value}</p>
    </div>
  );
}

function PerClassTable({ pc }: { pc: Record<string, PerClassRow> }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Per-class performance (test)</p>
      <table className="w-full text-xs border border-gray-200">
        <thead className="bg-slate-50 text-gray-500">
          <tr className="text-left">
            <th className="p-2">Class</th>
            <th className="p-2">Precision</th>
            <th className="p-2">Recall</th>
            <th className="p-2">F1</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(pc).map(([k, v]) => (
            <tr key={k} className="border-t border-gray-100">
              <td className="p-2">{k}</td>
              <td className="p-2">{v.precision.toFixed(3)}</td>
              <td className="p-2">{v.recall.toFixed(3)}</td>
              <td className="p-2">{v.f1.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfusionBlock({ c }: { c: ConfusionDetail }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-1">
      <p className="text-xs uppercase tracking-wide text-gray-400">Confusion</p>
      <p className="text-sm">Total misclassified on test: {c.total_misclassified}</p>
      {c.most_frequent_confusion ? (
        <p className="text-sm">
          Most frequent: <strong>{c.most_frequent_confusion.actual} → {c.most_frequent_confusion.predicted}</strong> ({c.most_frequent_confusion.count} cases)
        </p>
      ) : (
        <p className="text-sm text-gray-500">No cross-class confusions recorded.</p>
      )}
      <p className="text-xs text-gray-400">{c.note}</p>
    </div>
  );
}

function ConfidenceBlock({ ce }: { ce: ConfErrDetail }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-1">
      <p className="text-xs uppercase tracking-wide text-gray-400">Confidence & errors</p>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>test predictions: {ce.total_predictions}</span>
        <span>errors: {ce.total_errors}</span>
        <span>high-confidence errors: {ce.high_confidence_errors.length}</span>
        <span>low-confidence (&lt; 0.5): {ce.low_confidence_predictions}</span>
      </div>
      <p className="text-sm text-gray-600">{ce.finding}</p>
    </div>
  );
}

function ImprovementsBlock({ imps }: { imps: Improvement[] }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-1">
      <p className="text-xs uppercase tracking-wide text-gray-400">Improvement opportunities</p>
      {imps.length === 0 ? (
        <p className="text-sm text-gray-500">None flagged.</p>
      ) : (
        <ul className="list-disc pl-5 space-y-1 text-sm">
          {imps.map((o, i) => (
            <li key={i}><strong>{o.opportunity}</strong> <span className="text-gray-500">({o.evidence})</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}