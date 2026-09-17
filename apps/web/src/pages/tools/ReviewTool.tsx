// TOOLS
import { useEffect, useState } from "react";
import { toolsApi, ImageRow, apiFetch } from "../../lib/api";
import { useAuth } from "../../auth/AuthContext";

const CLASS_OPTIONS = ["healthy", "leaf_rust", "leaf_spot", "leaf_blight"] as const;
const LABELS: Record<string, string> = {
  healthy: "Healthy",
  leaf_rust: "Leaf Rust",
  leaf_spot: "Leaf Spot",
  leaf_blight: "Leaf Blight",
};

const QUEUES = [
  ["ANNOTATED", "Awaiting expert review"],
  ["EXPERT_REVIEWED", "Relabeled — needs final confirm"],
  ["SECOND_OPINION", "Second opinion requested"],
  ["UNCERTAIN", "Uncertain (may be relabeled)"],
] as const;

/** Expert Review queue — confirm / relabel / uncertain / reject / second opinion. */
export default function ReviewTool() {
  const { user } = useAuth();
  const [queueKey, setQueueKey] = useState<string>("ANNOTATED");
  const [queue, setQueue] = useState<ImageRow[]>([]);
  const [notes, setNotes] = useState("");
  const [relabel, setRelabel] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [preview, setPreview] = useState<{ total: number; byStatus: Record<string, number>; byLabel: Record<string, number> } | null>(null);
  const [targetLabel, setTargetLabel] = useState<string>("");

  async function refresh() {
    const r = await toolsApi.imagesByStatus(queueKey);
    setQueue(r.items.filter((i) => !i.isDevFixture));
  }

  useEffect(() => {
    refresh().catch(() => setQueue([]));
  }, [queueKey]);

  async function openConfirmDialog() {
    try {
      const res = await apiFetch("/review/batch-confirm-preview");
      setPreview(await res.json());
      setTargetLabel("");
      setShowDialog(true);
    } catch {
      setMsg("Could not load pending-review breakdown.");
    }
  }

  async function batchConfirm() {
    setBusy(true);
    try {
      const res = await apiFetch("/review/batch-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetLabel ? { label: targetLabel } : {}),
      });
      const d = await res.json();
      setMsg(
        res.ok
          ? `✅ Confirmed ${d.confirmed} image(s) in bulk${targetLabel ? ` to ${targetLabel}` : ""}.${d.failed?.length ? ` ⚠️ ${d.failed.length} skipped: ${d.failed.map((f: { error: string }) => f.error).join("; ")}` : ""}`
          : `Failed: ${d.error}`
      );
      setShowDialog(false);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, action: string, label?: string) {
    const r = await toolsApi.review(id, {
      action,
      ...(label ? { label } : {}),
      ...(notes ? { reason: notes } : {}),
    });
    setMsg(
      r.ok
        ? `✅ ${action}${label ? ` → ${label}` : ""} recorded (${r.data.status ?? ""})`
        : `Failed: ${r.data.error ?? JSON.stringify(r.data)}`
    );
    setNotes("");
    refresh();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <select className="border rounded px-2 py-1.5 text-sm" value={queueKey}
          onChange={(e) => setQueueKey(e.target.value)}>
          {QUEUES.map(([k, l]) => (
            <option key={k} value={k}>{l} ({k})</option>
          ))}
        </select>
        <span className="text-xs text-gray-400">{queue.length} in queue</span>
        <button onClick={openConfirmDialog} disabled={busy}
          className="ml-2 px-4 py-1.5 rounded text-sm font-semibold bg-slate-800 text-white disabled:opacity-40 disabled:cursor-not-allowed">
          ✓ Confirm all pending…
        </button>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-xs text-gray-400">as {user?.name ?? "you"} (expert)</span>
          <input className="border rounded px-2 py-1 w-52" placeholder="review notes (optional)"
            value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {msg && <p className="text-sm text-slate-600 bg-slate-50 rounded p-2">{msg}</p>}

      {queue.length === 0 ? (
        <p className="text-sm text-gray-500">Queue empty.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {queue.map((img) => {
            const prelim = img.annotations?.[0]?.preliminaryLabel ?? img.classifications?.[0]?.classKey;
            const annotator = img.annotations?.[0]?.annotator;
            const pred = img.predictions?.[0];
            return (
              <div key={img.id} className="rounded-lg bg-white border border-gray-200 overflow-hidden">
                <img src={toolsApi.imageUrl(img.id)} alt={img.filename} className="w-full max-h-56 object-contain bg-gray-50" />
                <div className="p-3 space-y-2">
                  <p className="text-xs text-gray-500">
                    Preliminary label:{" "}
                    <strong className="text-gray-700">{prelim ?? "none"}</strong> · {img.annotationStatus}
                    {annotator && <span className="text-gray-400"> · annotated by {annotator}</span>}
                  </p>
                  {pred && (
                    <p className="text-xs px-2 py-1 rounded bg-sky-50 border border-sky-100 text-sky-900">
                      AI (analyzer) classified:{" "}
                      <strong>{LABELS[pred.predictedClass] ?? pred.predictedClass}</strong>
                      {pred.confidence != null && <> at {(100 * pred.confidence).toFixed(0)}%</>}
                      {pred.modelVersion?.version && <> · model {pred.modelVersion.version}</>}
                      <span className="block text-[11px] text-sky-600 mt-0.5">
                        Suggestion only — judge the image independently, do not trust or copy it.
                      </span>
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => act(img.id, "confirm")}
                      className="px-2.5 py-1 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700">
                      ✓ Confirm{prelim ? ` (${prelim})` : ""}
                    </button>
                    {CLASS_OPTIONS.map((k) => (
                      <button key={k} onClick={() => act(img.id, "relabel", k)}
                        className={`px-2.5 py-1 rounded text-xs border ${
                          k === prelim
                            ? "border-gray-200 text-gray-300 cursor-default"
                            : "border-amber-400 text-amber-700 hover:bg-amber-50"
                        }`}
                        disabled={k === prelim}>
                        Relabel: {k.replace("leaf_", "").replace("_", " ")}
                      </button>
                    ))}
                    <button onClick={() => act(img.id, "mark_uncertain")}
                      className="px-2.5 py-1 rounded text-xs border border-gray-400 hover:bg-gray-100">
                      Uncertain
                    </button>
                    <button onClick={() => act(img.id, "second_opinion")}
                      className="px-2.5 py-1 rounded text-xs border border-sky-400 text-sky-700 hover:bg-sky-50">
                      2nd opinion
                    </button>
                    <button onClick={() => act(img.id, "reject")}
                      className="px-2.5 py-1 rounded text-xs border border-red-400 text-red-600 hover:bg-red-50">
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Batch-confirm confirmation dialog */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Confirm all pending">
          <div className="bg-white rounded-xl p-6 max-w-lg w-full shadow-xl space-y-4">
            <h3 className="font-bold text-lg">Confirm all pending images</h3>
            <p className="text-sm text-gray-600">
              This will approve <strong>{preview?.total ?? 0}</strong> image(s)
              awaiting expert review ({user?.name ?? "you"} as expert). Each gets its
              own audit record. Original predictions are never altered.
            </p>

            {/* Breakdown */}
            {preview && (
              <div className="space-y-2 text-sm">
                <div className="flex flex-wrap gap-3">
                  <span className="text-xs uppercase tracking-wide text-gray-400">By status</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(preview.byStatus).map(([s, n]) => (
                    <span key={s} className="px-2 py-0.5 rounded bg-slate-100 text-xs">
                      {s}: {n}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(preview.byLabel).map(([l, n]) => (
                    <span key={l} className={`px-2 py-0.5 rounded text-xs ${l === "(no label)" ? "bg-red-100 text-red-700" : "bg-leaf-50 text-leaf-700"}`}>
                      {l}: {n}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">
                Confirm to a specific class (optional)
              </label>
              <select className="w-full border rounded px-2 py-1.5 text-sm"
                value={targetLabel} onChange={(e) => setTargetLabel(e.target.value)}>
                <option value="">Use each image's own preliminary label</option>
                {CLASS_OPTIONS.map((c) => (
                  <option key={c} value={c}>Confirm all as: {c}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400">
                Leave empty to approve each image to the label it already has.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowDialog(false)}
                className="px-4 py-1.5 rounded border text-sm hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={batchConfirm} disabled={busy || !preview?.total}
                className="px-4 py-1.5 rounded text-sm font-semibold bg-slate-800 text-white disabled:opacity-40">
                {busy ? "Confirming…" : `Confirm ${preview?.total ?? 0} image(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
