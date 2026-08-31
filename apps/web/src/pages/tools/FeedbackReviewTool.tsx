// TOOLS (Phase 9.1): feedback review queue — expert verification of application
// feedback. Verified labels become CANDIDATE training data only.
import { useEffect, useState } from "react";

interface FeedbackItem {
  feedbackId: string;
  verdict: string | null;
  suggestedClass: string | null;
  comment: string | null;
  reviewStatus: string;
  reviewer: string | null;
  reviewNotes: string | null;
  verifiedClass: string | null;
  prediction: {
    id: string; predictedClass: string; confidence: number;
    probabilities: Record<string, number>; imageId: string;
    filename: string; imageUrl: string; modelVersion: string | null;
  };
}

const STATUSES = ["SUBMITTED", "UNDER_REVIEW", "VERIFIED", "REJECTED", "NEEDS_REVIEW"];
const CLASSES = ["healthy", "leaf_rust", "leaf_spot", "leaf_blight"];

export default function FeedbackReviewTool() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [notes, setNotes] = useState("");
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    const qs = statusFilter ? `?status=${statusFilter}` : "";
    const r = await fetch(`/api/tools/feedback${qs}`).then((r) => r.json());
    setItems(r.items ?? []);
  }
  useEffect(() => { refresh().catch(() => {}); }, [statusFilter]);

  async function review(id: string, action: string) {
    if (!reviewer) return setMsg("Enter the expert reviewer name first.");
    const item = items.find((i) => i.feedbackId === id);
    const verifiedClass =
      action === "verify"
        ? corrections[id] || item?.suggestedClass || (item?.verdict === "agree" ? item?.prediction.predictedClass : null)
        : corrections[id];
    const body: Record<string, unknown> = {
      actor: reviewer, actorRole: "expert", action,
      verifiedClass: verifiedClass ?? undefined, reason: notes || undefined,
    };
    const r = await fetch(`/api/tools/feedback/${id}/review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    setMsg(r.ok ? `✅ ${action} → ${d.reviewStatus}` : `Failed: ${d.error}`);
    refresh();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <select className="border rounded px-2 py-1.5 text-sm" value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by review status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-xs text-gray-400">{items.length} item(s)</span>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <label>Reviewer:</label>
          <input className="border rounded px-2 py-1 w-40" value={reviewer}
            onChange={(e) => setReviewer(e.target.value)} placeholder="expert name" />
        </div>
      </div>

      <p className="text-xs text-slate-500 bg-slate-50 rounded p-2">
        Verified labels become <strong>candidate training data</strong> only — they enter
        a dataset version solely when you cut one explicitly. Original predictions are never altered.
      </p>

      {msg && <p className="text-sm text-slate-700 bg-slate-100 rounded p-2">{msg}</p>}
      {items.length === 0 && <p className="text-sm text-gray-500">No feedback in this queue.</p>}

      {items.map((it) => (
        <article key={it.feedbackId} className="rounded-lg bg-white border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-3">
            <img src={it.prediction.imageUrl} alt={it.prediction.filename}
              className="w-full md:h-44 object-contain bg-gray-50 md:col-span-1" />
            <div className="p-4 md:col-span-2 space-y-2 text-sm">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span>Prediction: <strong>{it.prediction.predictedClass}</strong></span>
                <span>Confidence: {(100 * (it.prediction.confidence ?? 0)).toFixed(1)}%</span>
                <span>Model: {it.prediction.modelVersion ?? "—"}</span>
                <span className={`px-1.5 rounded ${it.reviewStatus === "VERIFIED" ? "bg-green-100 text-green-700" : it.reviewStatus === "REJECTED" ? "bg-red-100 text-red-600" : "bg-gray-100"}`}>
                  {it.reviewStatus}
                </span>
              </div>
              <p>User says: <strong>{it.verdict}</strong>
                {it.suggestedClass && <> · suggests <strong>{it.suggestedClass}</strong></>}</p>
              {it.comment && <p className="text-gray-500 italic">“{it.comment}”</p>}
              <details className="text-xs text-gray-500">
                <summary className="cursor-pointer">probabilities</summary>
                <pre className="whitespace-pre-wrap">{JSON.stringify(it.prediction.probabilities)}</pre>
              </details>

              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {["SUBMITTED", "NEEDS_REVIEW", "UNDER_REVIEW"].includes(it.reviewStatus) && (
                  <>
                    {["SUBMITTED", "NEEDS_REVIEW"].includes(it.reviewStatus) && (
                      <button onClick={() => review(it.feedbackId, "start_review")}
                        className="px-2 py-1 rounded text-xs border hover:bg-gray-50">Start review</button>
                    )}
                    {["NEEDS_REVIEW", "UNDER_REVIEW"].includes(it.reviewStatus) && (
                      <>
                        <button onClick={() => review(it.feedbackId, "verify")}
                          className="px-2 py-1 rounded text-xs bg-green-600 text-white"
                          disabled={!it.suggestedClass && it.verdict !== "agree"}>
                          ✓ Verify{suggestedLabel(it)}
                        </button>
                        <select className="border rounded text-xs px-1 py-0.5"
                          aria-label={`Corrected class for ${it.feedbackId}`}
                          value={corrections[it.feedbackId] ?? ""}
                          onChange={(e) => setCorrections({ ...corrections, [it.feedbackId]: e.target.value })}>
                          <option value="">Correct to…</option>
                          {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <button disabled={!corrections[it.feedbackId]}
                          onClick={() => review(it.feedbackId, "verify_corrected", )}
                          className="px-2 py-1 rounded text-xs border border-amber-400 text-amber-700 disabled:opacity-40">
                          Verify corrected
                        </button>
                      </>
                    )}
                    <button onClick={() => review(it.feedbackId, "mark_uncertain")}
                      className="px-2 py-1 rounded text-xs border border-gray-300">Uncertain</button>
                    <button onClick={() => review(it.feedbackId, "reject")}
                      className="px-2 py-1 rounded text-xs border border-red-300 text-red-600">Reject</button>
                  </>
                )}
              </div>
              {(it.reviewer || it.reviewNotes) && (
                <p className="text-[11px] text-gray-400">
                  reviewed by {it.reviewer}: {it.reviewNotes}
                </p>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function suggestedLabel(it: FeedbackItem) {
  const c = it.suggestedClass ?? it.verifiedClass ?? (it.verdict === "agree" ? it.prediction.predictedClass : null);
  return c ? ` (${c})` : "";
}
