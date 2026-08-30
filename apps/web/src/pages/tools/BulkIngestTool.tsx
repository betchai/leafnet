// TOOLS
import { useRef, useState } from "react";

const CLASS_OPTIONS = ["", "healthy", "leaf_rust", "leaf_spot", "leaf_blight"] as const;

interface Result {
  ingested: number;
  duplicatesFlagged: number;
  labeled: number;
  failed: number;
  failures?: { filename: string; error: string }[];
}

/** Bulk ingestion — upload many images at once with shared collection metadata,
 *  optionally assigning a preliminary label to all of them (audited per image). */
export default function BulkIngestTool() {
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [source, setSource] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [farmId, setFarmId] = useState("");
  const [license, setLicense] = useState("own_photo");
  const [assignLabel, setAssignLabel] = useState("");
  const [annotator, setAnnotator] = useState("");
  const [isDevFixture, setIsDevFixture] = useState(false);

  async function ingest() {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("images", f));
      const meta: Record<string, string> = {
        source,
        sourceType: source ? "field_photo" : "",
        collectionSessionId: sessionId,
        farmId,
        license,
        isDevFixture: String(isDevFixture),
      };
      if (assignLabel) {
        meta.assignLabel = assignLabel;
        meta.annotator = annotator;
      }
      Object.entries(meta).forEach(([k, v]) => v && fd.append(k, v));

      const res = await fetch("/api/tools/bulk-ingest", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult(data);
      setFiles(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <section className="rounded-lg bg-white border border-gray-200 p-5 space-y-4">
        <h2 className="font-semibold">1. Select images</h2>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png" multiple
          onChange={(e) => setFiles(e.target.files)} />
        {files && <p className="text-xs text-gray-500">{files.length} files selected</p>}
      </section>

      <section className="rounded-lg bg-white border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold">2. Shared metadata</h2>
        <p className="text-xs text-gray-400">
          Applied to every image in this batch. Use one batch per collection session.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <input className="border rounded px-2 py-1" placeholder="Source (e.g. farm_field_A)"
            value={source} onChange={(e) => setSource(e.target.value)} />
          <input className="border rounded px-2 py-1" placeholder="Collection session ID"
            value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
          <input className="border rounded px-2 py-1" placeholder="Farm/site ID (optional)"
            value={farmId} onChange={(e) => setFarmId(e.target.value)} />
          <input className="border rounded px-2 py-1" placeholder="License"
            value={license} onChange={(e) => setLicense(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={isDevFixture} onChange={(e) => setIsDevFixture(e.target.checked)} />
          Mark as development fixture (excluded from research counts)
        </label>
      </section>

      <section className="rounded-lg bg-white border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold">3. Preliminary label (optional)</h2>
        <p className="text-xs text-gray-400">
          If set, every ingested image gets this as a PRELIMINARY label under your name —
          still requiring expert review before becoming ground truth.
          Leave empty to label individually later.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <select className="border rounded px-2 py-1" value={assignLabel}
            onChange={(e) => setAssignLabel(e.target.value)}>
            {CLASS_OPTIONS.map((c) => (
              <option key={c || "none"} value={c}>
                {c ? `Assign: ${c}` : "No bulk label"}
              </option>
            ))}
          </select>
          <input className="border rounded px-2 py-1" placeholder="Annotator name"
            value={annotator} onChange={(e) => setAnnotator(e.target.value)}
            disabled={!assignLabel} />
        </div>
      </section>

      <button onClick={ingest} disabled={!files?.length || busy}
        className="px-5 py-2 rounded-md bg-slate-700 text-white font-medium disabled:opacity-40">
        {busy ? `Ingesting ${files?.length} images…` : `Ingest ${files?.length ?? 0} images`}
      </button>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</p>
      )}

      {result && (
        <section className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm space-y-1">
          <p>✅ Ingested: <strong>{result.ingested}</strong></p>
          <p>Labeled ({assignLabel}): <strong>{result.labeled}</strong></p>
          <p>⚠️ Duplicates flagged for review: <strong>{result.duplicatesFlagged}</strong></p>
          <p>❌ Failed: <strong>{result.failed}</strong></p>
          {result.failures?.map((f, i) => (
            <p key={i} className="text-xs text-red-600 truncate">{f.filename}: {f.error}</p>
          ))}
          <p className="text-xs text-gray-500 pt-1">
            Next: review duplicates in Expert Review, then expert-confirm labels.
          </p>
        </section>
      )}
    </div>
  );
}
