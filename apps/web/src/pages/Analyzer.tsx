import { useEffect, useRef, useState } from "react";
import { api, apiFetch, ClassConfig, ExplanationCriterion, PredictionHistoryRow } from "../lib/api";

const MAX_SIZE_MB = 20;
const ACCEPTED = ["image/jpeg", "image/png"];

/**
 * Leaf Analyzer — the primary user journey (Phase 8):
 * Upload → Preview → Analyze → Processing → Prediction → Result → Feedback.
 *
 * Architecture: React → Node API → Python ML service → MobileNetV2.
 * The frontend never sees internal ML-service details; errors arrive as
 * application-safe messages from the Node API.
 */

interface PredictResult {
  predictionId: string;
  predictedClass: string;
  confidence: number;
  probabilities: Record<string, number>;
  reviewRecommended: boolean;
  modelVersion: string | null;
  disclaimer: string;
}

interface Explanation {
  predictedClass: string;
  secondClass: string | null;
  saliencyBase64: string;
  criteria: ExplanationCriterion[];
}

function CriterionRow({ criterion, top, second }: { criterion: ExplanationCriterion; top: string; second: string | null }) {
  const isTop = criterion.supports === "top";
  const isSecond = criterion.supports === "second";
  const inconclusive = criterion.supports === "inconclusive";

  const badge = inconclusive
    ? { text: "Inconclusive", cls: "bg-gray-100 text-gray-500 border-gray-300" }
    : isTop
      ? { text: `→ ${top}`, cls: "bg-emerald-50 text-emerald-700 border-emerald-300" }
      : { text: `→ ${second ?? "other candidate"}`, cls: "bg-sky-50 text-sky-700 border-sky-300" };

  const width = isTop ? 100 : isSecond ? 100 : 0;

  return (
    <li className="border border-gray-200 rounded-md p-2 bg-white">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-gray-800">{criterion.label}</p>
          <p className="text-[11px] text-gray-500">
            {criterion.value} {criterion.unit}
          </p>
        </div>
        <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded border ${badge.cls}`}>
          {badge.text}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 rounded bg-gray-100 overflow-hidden">
        <div
          className={isTop ? "h-full bg-emerald-500" : isSecond ? "h-full bg-sky-500" : "h-0"}
          style={{ width: `${inconclusive ? 0 : width}%` }}
        />
      </div>
      <p className="mt-1 text-[10px] text-gray-400 leading-snug">{criterion.description}</p>
    </li>
  );
}

export default function Analyzer() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PredictResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [classes, setClasses] = useState<ClassConfig | null>(null);
  const [history, setHistory] = useState<PredictionHistoryRow[]>([]);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [servedRejection, setServedRejection] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.classes().then(setClasses).catch(() => {});
    apiFetch("/predictions/served")
      .then((r) => r.json())
      .then((d) => setServedRejection(Boolean(d.rejectionEnabled)))
      .catch(() => setServedRejection(null));
    refreshHistory();
  }, []);

  async function refreshHistory() {
    try {
      const r = await api.predictionHistory(10);
      setHistory(r.items);
    } catch {/* history is optional */}
  }

  function acceptFile(f: File | null) {
    setError(null);
    setResult(null);
    setFeedbackMsg(null);
    setExplanation(null);
    setExplainError(null);
    if (!f) return setFile(null);
    if (!ACCEPTED.includes(f.type)) {
      setFileError("Unsupported file type. Please use a JPEG or PNG image.");
      return setFile(null);
    }
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setFileError(`Image exceeds the ${MAX_SIZE_MB} MB limit.`);
      return setFile(null);
    }
    setFileError(null);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    acceptFile(e.dataTransfer.files?.[0] ?? null);
  }

  function removeImage() {
    setFile(null);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
    setExplanation(null);
    setExplainError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function analyze() {
    if (!file) return;
    setBusy(true);
    setResult(null);
    setError(null);
    setFeedbackMsg(null);
    setExplanation(null);
    setExplainError(null);
    // Upload + predict in one user action; Node orchestrates both calls.
    const r = await api.uploadAndPredict(file, { source: "leaf_analyzer" });
    if (r.ok) {
      setResult(r);
      refreshHistory();
    } else {
      setError(r.error);
    }
    setBusy(false);
  }

  async function loadExplanation() {
    if (!result?.predictionId || explaining) return;
    setExplaining(true);
    setExplainError(null);
    const r = await api.explainPrediction(result.predictionId);
    if (r.ok) {
      setExplanation(r);
    } else {
      setExplainError(r.error);
    }
    setExplaining(false);
  }

  async function sendFeedback(verdict: "agree" | "disagree" | "unsure", correctedClass?: string) {
    if (!result?.predictionId) return;
    const r = await api.sendFeedback(result.predictionId, {
      verdict, correctedClass, comment: comment || undefined,
    });
    setFeedbackMsg(
      r.ok
        ? "✅ Thank you — your feedback has been recorded for expert review."
        : "Sorry, feedback could not be saved."
    );
  }

  const labelOf = (k?: string) =>
    classes?.classes.find((c) => c.key === k)?.display_name ??
    classes?.classes.find((c) => c.key === k)?.label ?? k ?? "—";

  const ranked = result
    ? Object.entries(result.probabilities).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="max-w-2xl mx-auto space-y-6" aria-live="polite">
      {/* Scope disclaimer — always visible (visual classification ≠ diagnosis) */}
      <section className="rounded-lg bg-sky-50 border border-sky-200 p-4 text-sm text-sky-900">
        This tool provides a <strong>visual classification</strong> of the submitted
        leaf image. It is <strong>not</strong> a laboratory diagnosis or definitive
        determination of the biological cause of a leaf condition.
        {result?.modelVersion && (
          <span className="block mt-1 text-xs text-sky-700">
            Model version: {result.modelVersion}
          </span>
        )}
      </section>

      {/* Rejection-class capability notice */}
      {servedRejection === false && (
        <section className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
          <strong>Rejection class not active yet.</strong> The deployed model only
          predicts the four mulberry conditions, so a leaf that is not mulberry
          will still be classified into one of them. This activates once a 5-class
          model is trained, approved and promoted in Model settings.
        </section>
      )}

      {/* Step 1: upload */}
      <section className="rounded-lg bg-white border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold">1. Upload a mulberry leaf photo</h2>
        <p className="text-xs text-gray-500">
          JPEG or PNG · up to {MAX_SIZE_MB} MB · for best results use a clear,
          well-lit photo where the leaf and its symptoms are fully visible
          (avoid severe blur, shadows and obstruction).
        </p>

        {!previewUrl ? (
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload leaf image"
            onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
              dragOver ? "border-leaf-500 bg-leaf-50" : "border-gray-300 hover:border-leaf-400"
            }`}
          >
            <p className="text-gray-600">Drag &amp; drop an image here,</p>
            <p className="text-sm text-gray-400">or click to browse files</p>
          </div>
        ) : (
          <div className="space-y-3">
            <img src={previewUrl} alt="Selected mulberry leaf"
              className="w-full max-h-72 object-contain rounded-md border border-gray-200 bg-gray-50" />
            <div className="flex gap-2">
              <button onClick={() => inputRef.current?.click()}
                className="px-3 py-1.5 rounded text-sm border border-gray-300 hover:bg-gray-50">
                Replace image
              </button>
              <button onClick={removeImage}
                className="px-3 py-1.5 rounded text-sm border border-red-300 text-red-600 hover:bg-red-50">
                Remove
              </button>
            </div>
          </div>
        )}
        <input ref={inputRef} type="file" accept={ACCEPTED.join(",")} className="hidden"
          onChange={(e) => acceptFile(e.target.files?.[0] ?? null)} />
        {fileError && (
          <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
            {fileError}
          </p>
        )}
      </section>

      {/* Step 2: analyze */}
      <button onClick={analyze} disabled={!file || busy}
        aria-busy={busy}
        className="w-full sm:w-auto px-8 py-3 rounded-lg bg-leaf-600 text-white font-semibold text-lg disabled:opacity-40 disabled:cursor-not-allowed focus:ring-2 focus:ring-leaf-500 focus:ring-offset-2">
        {busy ? "Analyzing your leaf image…" : "🔍 Analyze Leaf"}
      </button>
      {busy && (
        <p className="text-sm text-gray-500 flex items-center gap-2">
          <span className="inline-block w-4 h-4 border-2 border-leaf-500 border-t-transparent rounded-full animate-spin"
            aria-hidden="true" />
          Running visual classification…
        </p>
      )}

      {/* Step 3: result */}
      {result && (
        <section className="rounded-lg bg-white border-2 border-leaf-500 p-6 space-y-4 shadow-sm" aria-live="polite">
          <h2 className="text-sm uppercase tracking-wide text-gray-400">Prediction</h2>
          <p data-testid="predicted-class" className="text-3xl font-bold text-leaf-700">
            {labelOf(result.predictedClass)}
          </p>

          <div>
            <p className="text-sm text-gray-500">
              Model confidence: <strong>{(result.confidence * 100).toFixed(1)}%</strong>{" "}
              <span className="text-xs">of predictions for this class probability</span>
            </p>
            <div className="mt-1 h-3 bg-gray-100 rounded-full overflow-hidden max-w-sm">
              <div className="h-full bg-leaf-500 transition-all"
                style={{ width: `${result.confidence * 100}%` }} />
            </div>
          </div>

          {result.reviewRecommended && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">
              ⚠️ The model is not highly confident in this classification.
              Consider reviewing the image or consulting an appropriate expert.
            </p>
          )}

          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-2">All possibilities considered</h3>
            <ul className="space-y-1.5">
              {ranked.map(([key, prob]) => (
                <li key={key} className="flex items-center gap-2 text-sm">
                  <span className={`w-36 truncate ${key === result.predictedClass ? "font-semibold" : ""}`}>
                    {labelOf(key)}
                  </span>
                  <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full ${key === result.predictedClass ? "bg-leaf-500" : "bg-gray-300"}`}
                      style={{ width: `${prob * 100}%` }} />
                  </div>
                  <span className="w-14 text-right text-gray-500">{(prob * 100).toFixed(1)}%</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Why did it say that? — visual explanation */}
          <div className="pt-3 border-t border-gray-100">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Why did the model say this?</h3>
            {!explanation ? (
              <>
                <button onClick={loadExplanation} disabled={explaining}
                  className="px-3 py-1.5 rounded text-sm border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                  {explaining ? "Analyzing pixel influence…" : "Show visual explanation"}
                </button>
                {explainError && (
                  <p role="alert" className="mt-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
                    {explainError}
                  </p>
                )}
              </>
            ) : (
              <div className="space-y-2">
                <img
                  src={`data:image/png;base64,${explanation.saliencyBase64}`}
                  alt={`Heatmap showing which pixels influenced the ${labelOf(explanation.predictedClass)} prediction`}
                  className="w-full rounded-md border border-gray-200 bg-gray-50"
                />
                <p className="text-[11px] text-gray-400">
                  Heatmaps highlight the pixels that most strongly pushed the{" "}
                  <strong>{labelOf(explanation.predictedClass)}</strong> score
                  {explanation.secondClass
                    ? <> versus the runner-up, <strong>{labelOf(explanation.secondClass)}</strong></>
                    : null}
                  . They measure influence, not a diagnosis or a precise region of symptoms.
                </p>
                {explanation.criteria.length > 0 && (
                  <div className="pt-1">
                    <p className="text-[11px] font-medium text-gray-500 mb-1.5">
                      Image-evidence criteria — which class each visible signal supports
                    </p>
                    <ul className="space-y-1.5">
                      {explanation.criteria.map((cr) => (
                        <CriterionRow key={cr.key} criterion={cr} top={explanation.predictedClass} second={explanation.secondClass} />
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Step 4: feedback */}
          <div className="pt-3 border-t border-gray-100">
            {feedbackMsg ? (
              <p role="status" className="text-sm text-green-700">{feedbackMsg}</p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium">Do you agree with this classification?</p>
                <div className="flex flex-wrap gap-2 items-center">
                  <button onClick={() => sendFeedback("agree")}
                    className="px-3 py-1.5 rounded text-sm bg-green-600 text-white hover:bg-green-700 focus:ring-2 focus:ring-green-400">
                    Yes
                  </button>
                  <button onClick={() => sendFeedback("disagree")}
                    className="px-3 py-1.5 rounded text-sm border border-red-300 text-red-600 hover:bg-red-50">
                    No
                  </button>
                  <button onClick={() => sendFeedback("unsure")}
                    className="px-3 py-1.5 rounded text-sm border border-gray-300 hover:bg-gray-50">
                    Unsure
                  </button>
                  <input type="text" placeholder="Optional comment…" value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    className="border rounded px-2 py-1 text-sm flex-1 min-w-40" />
                </div>
                <p className="text-[11px] text-gray-400">
                  Feedback is stored for expert review — it does not automatically change any dataset labels.
                </p>
              </div>
            )}
          </div>

          <p className="text-xs text-gray-400">{result.disclaimer}</p>
        </section>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
          {error}
        </p>
      )}

      {/* History */}
      <section className="rounded-lg bg-white border border-gray-200 p-5">
        <h2 className="font-semibold mb-3">Recent analyses</h2>
        {history.length === 0 ? (
          <p className="text-sm text-gray-500">
            No predictions yet. Upload a mulberry leaf to begin.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {history.map((h) => (
              <li key={h.predictionId} className="py-2 flex items-center justify-between gap-3">
                <span className="truncate flex-1 text-gray-600">{h.filename}</span>
                <span className="font-medium">{labelOf(h.predictedClass)}</span>
                <span className="text-gray-400 w-16 text-right">
                  {h.confidence != null ? `${(h.confidence * 100).toFixed(0)}%` : "—"}
                </span>
                <span className="text-gray-400 text-xs w-20 text-right">
                  {new Date(h.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
