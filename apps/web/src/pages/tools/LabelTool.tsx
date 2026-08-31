// TOOLS
import { useEffect, useState } from "react";
import { toolsApi, ImageRow, ClassConfig } from "../../lib/api";

const CLASS_OPTIONS = ["healthy", "leaf_rust", "leaf_spot", "leaf_blight"] as const;
const LABELS: Record<string, string> = {
  healthy: "Healthy",
  leaf_rust: "Leaf Rust",
  leaf_spot: "Leaf Spot",
  leaf_blight: "Leaf Blight",
};

/** Acquire & Label — ingest images then assign preliminary labels. */
export default function LabelTool() {
  const [queue, setQueue] = useState<ImageRow[]>([]);
  const [classes, setClasses] = useState<ClassConfig | null>(null);
  const [actor, setActor] = useState("");
  const [confidence, setConfidence] = useState(0.8);
  const [msg, setMsg] = useState<string | null>(null);

  // upload form state
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [plantId, setPlantId] = useState("");
  const [leafId, setLeafId] = useState("");

  async function refresh() {
    const unlabeled = await toolsApi.imagesByStatus("UNLABELED");
    const needsReview = await toolsApi.imagesByStatus("NEEDS_REVIEW");
    setQueue([...unlabeled.items.filter((i) => !i.isDevFixture), ...needsReview.items]);
  }

  useEffect(() => {
    refresh();
    toolsApi.classes().then(setClasses).catch(() => {});
  }, []);

  async function upload() {
    if (!file) return;
    const r = await toolsApi.upload(file, {
      source,
      sourceType: source ? "field_photo" : "",
      collectionSessionId: sessionId,
      plantId,
      leafId,
    });
    setMsg(
      r.ok
        ? `Ingested ${file.name}${r.data.isExactDuplicate ? " — ⚠️ exact duplicate flagged" : ""}`
        : `Upload failed: ${JSON.stringify(r.data)}`
    );
    setFile(null);
    refresh();
  }

  async function label(id: string, labelKey: string) {
    if (!actor) return setMsg("Enter an annotator name first.");
    const r = await toolsApi.annotate(id, { actor, label: labelKey, confidence });
    setMsg(r.ok ? `Labeled as ${LABELS[labelKey]}` : `Failed: ${r.data.error ?? ""}`);
    refresh();
  }

  return (
    <div className="space-y-8">
      {/* Acquire */}
      <section className="rounded-lg bg-white border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold">1. Ingest image</h2>
        <input type="file" accept="image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <input className="border rounded px-2 py-1" placeholder="Source (e.g. farm_field_A)" value={source} onChange={(e) => setSource(e.target.value)} />
          <input className="border rounded px-2 py-1" placeholder="Collection session ID (leakage grouping)" value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
          <input className="border rounded px-2 py-1" placeholder="Plant ID (optional)" value={plantId} onChange={(e) => setPlantId(e.target.value)} />
          <input className="border rounded px-2 py-1" placeholder="Leaf ID (optional)" value={leafId} onChange={(e) => setLeafId(e.target.value)} />
        </div>
        <button onClick={upload} disabled={!file}
          className="px-4 py-1.5 rounded bg-slate-700 text-white text-sm font-medium disabled:opacity-40">
          Ingest
        </button>
        <p className="text-xs text-gray-400">
          Grouping keys (session/plant/leaf) enable leakage-safe splitting later.
        </p>
      </section>

      {/* Label */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">2. Preliminary labeling</h2>
          <span className="text-xs text-gray-400">{queue.length} awaiting labels</span>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <label>Annotator:</label>
            <input className="border rounded px-2 py-1 w-36" placeholder="your name"
              value={actor} onChange={(e) => setActor(e.target.value)} />
            <label>Confidence:</label>
            <select className="border rounded px-2 py-1" value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}>
              {[0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        {msg && <p className="text-sm text-slate-600 bg-slate-50 rounded p-2">{msg}</p>}

        {queue.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing awaiting preliminary labels.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {queue.map((img) => {
              const pred = img.predictions?.[0];
              return (
                <div key={img.id} className="rounded-lg bg-white border border-gray-200 overflow-hidden">
                  <img src={toolsApi.imageUrl(img.id)} alt={img.filename} className="w-full max-h-56 object-contain bg-gray-50" />
                  <div className="p-3 space-y-2">
                    <p className="text-xs text-gray-500 truncate">
                      {img.filename} · {img.annotationStatus}
                      {img.source ? ` · ${img.source}` : ""}
                    </p>
                    {pred && (
                      <p className="text-xs px-2 py-1 rounded bg-sky-50 border border-sky-100 text-sky-900">
                        AI (analyzer) classified:{" "}
                        <strong>{LABELS[pred.predictedClass] ?? pred.predictedClass}</strong>
                        {pred.confidence != null && <> at {(100 * pred.confidence).toFixed(0)}%</>}
                        {pred.modelVersion?.version && <> · model {pred.modelVersion.version}</>}
                        <span className="block text-[11px] text-sky-600 mt-0.5">
                          Model suggestion only — decide on your own reading, do not copy it.
                        </span>
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {CLASS_OPTIONS.map((k) => (
                        <button key={k} onClick={() => label(img.id, k)}
                          className={`px-2.5 py-1 rounded text-xs font-medium border ${
                            classes?.classes.find((c) => c.key === k)
                              ? "border-leaf-500 text-leaf-700 hover:bg-leaf-50"
                              : "border-gray-300 hover:bg-gray-100"
                          }`}>
                          {LABELS[k]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
