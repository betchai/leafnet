// TOOLS (Phase 9.1): feedback review queue — expert verification of application
// feedback. Verified labels become CANDIDATE training data only.
import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../../auth/AuthContext";

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
const CLASSES = ["healthy", "leaf_rust", "leaf_spot", "leaf_blight", "not_mulberry"];

const STATUS_PILL: Record<string, string> = {
  SUBMITTED: "bg-slate-100 text-slate-600 ring-slate-200",
  UNDER_REVIEW: "bg-amber-100 text-amber-700 ring-amber-200",
  NEEDS_REVIEW: "bg-sky-100 text-sky-700 ring-sky-200",
  VERIFIED: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  REJECTED: "bg-rose-100 text-rose-700 ring-rose-200",
};

const VERDICT_PILL: Record<string, string> = {
  agree: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  disagree: "bg-rose-50 text-rose-700 ring-rose-200",
  unsure: "bg-amber-50 text-amber-700 ring-amber-200",
};

function resolveTarget(it: FeedbackItem, corrections: Record<string, string>): string | null {
  return (
    corrections[it.feedbackId] ||
    it.suggestedClass ||
    (it.verdict === "agree" ? it.prediction.predictedClass : null)
  );
}

export default function FeedbackReviewTool() {
  const { user } = useAuth();
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [notes, setNotes] = useState("");
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    const r = await apiFetch("/tools/feedback");
    const data = await r.json();
    setItems(data.items ?? []);
  }
  useEffect(() => { refresh().catch(() => {}); }, []);

  async function patch(id: string, action: string, verifiedClass?: string | null) {
    const body: Record<string, unknown> = {
      action,
      verifiedClass: verifiedClass ?? undefined,
      reason: notes || undefined,
    };
    const r = await apiFetch(`/tools/feedback/${id}/review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: r.ok, payload: await r.json() };
  }

  async function review(id: string, action: string, verifiedClass?: string | null) {
    setBusyId(id);
    setMsg(null);
    try {
      const first = await patch(id, action, verifiedClass);
      if (!first.ok) {
        setMsg({ ok: false, text: `Failed: ${first.payload.error}` });
        await refresh();
        return;
      }
      setMsg({ ok: true, text: `✓ ${action} → ${first.payload.reviewStatus}` });
    } finally {
      setBusyId(null);
      refresh();
    }
  }

  // One-click verify: chains start_review → verify so the expert never needs a
  // separate "start" step. The target class is the "Correct to…" pick if set,
  // otherwise the image's own suggested/verified class (agree → prediction).
  async function verify(id: string, target: string) {
    setBusyId(id);
    setMsg(null);
    try {
      const it = items.find((i) => i.feedbackId === id);
      if (it && ["SUBMITTED", "NEEDS_REVIEW", "UNDER_REVIEW"].includes(it.reviewStatus)) {
        await patch(id, "start_review").catch(() => ({}));
      }
      const r = await patch(id, "verify", target);
      if (!r.ok) {
        setMsg({ ok: false, text: `Verify failed: ${r.payload.error}` });
      } else {
        setMsg({ ok: true, text: `✓ Verified ${it?.prediction.filename} → ${r.payload.reviewStatus} (${target})` });
      }
    } finally {
      setBusyId(null);
      refresh();
    }
  }

  const actionable = (it: FeedbackItem) =>
    ["SUBMITTED", "NEEDS_REVIEW", "UNDER_REVIEW"].includes(it.reviewStatus);

  const visible = statusFilter ? items.filter((i) => i.reviewStatus === statusFilter) : items;
  const statusCount = (s: string) => items.filter((i) => i.reviewStatus === s).length;

  return (
    <div className="space-y-5">
      {/* Queue header */}
      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          {["", ...STATUSES].map((s) => (
            <button
              key={s || "all"}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-[12.5px] font-medium ring-1 transition ${
                statusFilter === s
                  ? "bg-slate-800 text-white ring-slate-800 shadow-sm"
                  : "bg-slate-50 text-slate-500 ring-slate-200 hover:bg-slate-100"
              }`}
            >
              {s === "" ? "All" : s}
              <span className={`ml-1.5 ${statusFilter === s ? "text-slate-300" : "text-slate-400"}`}>
                {s === "" ? items.length : statusCount(s)}
              </span>
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-xs text-slate-400">as {user?.name ?? "you"}</span>
            <input className="border border-slate-200 rounded-lg px-3 py-1.5 w-56 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-400"
              value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="review notes (optional)" />
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-3 bg-slate-50 rounded-lg p-2.5 ring-1 ring-slate-100">
          Verified feedback becomes <strong>candidate training data only</strong> — it enters a dataset
          version when you cut one explicitly. <strong>Verify</strong> always works in one click: it uses your
          “Correct to…" pick if set, else the image's suggested class (for agrees, the prediction).
          Original predictions are never altered.
        </p>
        {msg && (
          <p className={`text-sm rounded-lg p-2.5 mt-2 ring-1 ${msg.ok ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : "bg-rose-50 text-rose-700 ring-rose-100"}`}>
            {msg.text}
          </p>
        )}
      </div>

      {visible.length === 0 && (
        <div className="rounded-2xl bg-white border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">
          {statusFilter ? `No ${statusFilter} feedback in this queue.` : "No feedback in this queue."}
        </div>
      )}

      {visible.map((it) => {
        const target = resolveTarget(it, corrections);
        const isBusy = busyId === it.feedbackId;
        return (
          <article key={it.feedbackId}
            className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
            <div className="grid grid-cols-1 md:grid-cols-3">
              <div className="relative bg-slate-50 md:col-span-1">
                <img src={it.prediction.imageUrl} alt={it.prediction.filename}
                  className="w-full md:h-48 object-contain max-h-96" />
                <span className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ${STATUS_PILL[it.reviewStatus] ?? STATUS_PILL.SUBMITTED}`}>
                  {it.reviewStatus}
                </span>
              </div>

              <div className="p-4 md:col-span-2 space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                  <span className="font-mono text-xs text-slate-400 truncate max-w-[240px]">{it.prediction.filename}</span>
                  <span>Model <span className="font-semibold">{it.prediction.modelVersion ?? "—"}</span></span>
                  <span className="ml-auto text-xs text-slate-400">{it.feedbackId.slice(0, 8)}</span>
                </div>

                {/* Prediction block */}
                <div className="rounded-xl bg-slate-50 ring-1 ring-slate-100 p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Predicted</span>
                    <span className="px-2 py-0.5 rounded-md bg-white ring-1 ring-slate-200 font-semibold text-slate-700">
                      {it.prediction.predictedClass}
                    </span>
                    <span className="text-slate-500">{(100 * (it.prediction.confidence ?? 0)).toFixed(0)}% sure</span>
                    <span className="ml-auto text-[11px] text-slate-400">model confidence</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all"
                      style={{ width: `${(100 * (it.prediction.confidence ?? 0)).toFixed(0)}%` }} />
                  </div>
                  <details className="text-xs text-slate-400 mt-2">
                    <summary className="cursor-pointer hover:text-slate-600">probabilities</summary>
                    <pre className="whitespace-pre-wrap mt-1 text-slate-500">{JSON.stringify(it.prediction.probabilities)}</pre>
                  </details>
                </div>

                {/* Feedback line */}
                <div className="flex items-start gap-2 flex-wrap">
                  <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mt-0.5">User</span>
                  <span className={`px-2 py-0.5 rounded-md text-[12.5px] font-medium ring-1 ${VERDICT_PILL[it.verdict ?? "unsure"] ?? VERDICT_PILL.unsure}`}>
                    {it.verdict ?? "no verdict"}
                  </span>
                  {it.suggestedClass && (
                    <span className="text-sm text-slate-600">
                      suggests <span className="font-semibold text-slate-800">{it.suggestedClass}</span>
                    </span>
                  )}
                </div>
                {it.comment && (
                  <p className="text-slate-500 italic text-[13px] border-l-2 border-slate-200 pl-3">“{it.comment}”</p>
                )}

                {/* Actions */}
                {actionable(it) ? (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button onClick={() => verify(it.feedbackId, target!)}
                      disabled={!target || isBusy}
                      className={`px-3.5 py-1.5 rounded-lg text-[13px] font-semibold text-white shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed ${
                        isBusy ? "bg-slate-400" : "bg-emerald-600 hover:bg-emerald-700"}`}>
                      {isBusy ? "Working…" : `✓ Verify${target ? ` (${target})` : ""}`}
                    </button>
                    <select
                      aria-label={`Corrected class for ${it.feedbackId}`}
                      value={corrections[it.feedbackId] ?? ""}
                      onChange={(e) => setCorrections({ ...corrections, [it.feedbackId]: e.target.value })}
                      className="border border-slate-200 rounded-lg text-[12.5px] px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40">
                      <option value="">Correct to… (optional)</option>
                      {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button onClick={() => review(it.feedbackId, "mark_uncertain")}
                      disabled={isBusy}
                      className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-40">
                      Uncertain
                    </button>
                    <button onClick={() => review(it.feedbackId, "reject")}
                      disabled={isBusy}
                      className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium border border-rose-300 text-rose-600 hover:bg-rose-50 disabled:opacity-40">
                      Reject
                    </button>
                    {!target && (
                      <span className="text-[11px] text-slate-400">pick a class to enable Verify</span>
                    )}
                  </div>
                ) : (
                  <div className={`rounded-xl p-3 text-sm ring-1 ${it.reviewStatus === "VERIFIED"
                      ? "bg-emerald-50 ring-emerald-100 text-emerald-800"
                      : it.reviewStatus === "REJECTED"
                        ? "bg-rose-50 ring-rose-100 text-rose-700"
                        : "bg-slate-50 ring-slate-100 text-slate-600"}`}>
                    {it.reviewStatus === "VERIFIED" && <>✓ Verified as <strong>{it.verifiedClass ?? it.suggestedClass}</strong> — candidate training data</>}
                    {it.reviewStatus === "REJECTED" && <>Rejected — excluded from candidates</>}
                    {it.reviewStatus === "UNDER_REVIEW" && <>In review…</>}
                    {it.reviewer && <span className="text-xs text-slate-400 ml-2">by {it.reviewer}</span>}
                  </div>
                )}

                {(it.reviewer || it.reviewNotes) && actionable(it) && (
                  <p className="text-[11px] text-slate-400">reviewed by {it.reviewer}: {it.reviewNotes}</p>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}