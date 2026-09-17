import { useEffect, useState } from "react";
import EmptyState from "../components/EmptyState";
import { apiFetch } from "../lib/api";

/**
 * INSIGHTS (Phase 9) — research insights dashboard.
 * Sections: Dataset · Model Performance · Per-Class · Confusion · Confidence ·
 * Errors · Application Data · Improvement Opportunities.
 * Every value is computed from recorded artifacts; honest empty states when
 * data is missing. Research vs Application data are labeled and never mixed.
 */

interface Insights {
  dataset_version: string;
  dataset: {
    total_images: number;
    per_class: Record<string, number>;
    pct_per_class?: Record<string, number>;
    splits: Record<string, Record<string, number>>;
    largest_class?: string | null;
    smallest_class?: string | null;
    imbalance_ratio?: number | null;
    observations: string[];
  };
  research: { models: Record<string, any> };
  models?: Record<string, any>;
  application: {
    total_predictions: number;
    note: string | null;
    predictions_per_class: Record<string, number>;
    low_confidence_rate: number | null;
    feedback_rate: number | null;
    disagreement_rate: number | null;
  };
  generated_note: string;
}

export default function Insights() {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelKey, setModelKey] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/insights")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        // Node proxy nests candidates under research.models
        const keys = Object.keys(d.research?.models ?? d.models ?? {});
        if (keys.length) setModelKey(keys[0]);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  if (error)
    return (
      <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
        {error} — start the ML service: <code>cd ml && .venv/bin/python -m uvicorn src.api.main:app --port 8000</code>
      </p>
    );
  if (!data) return <p className="text-gray-500">Loading insights…</p>;

  const models = data.research?.models ?? data.models ?? {};
  const modelKeys = Object.keys(models);
  const model = (modelKey && models[modelKey]) || (modelKeys[0] ? models[modelKeys[0]] : null);

  return (
    <div className="space-y-8">
      <header className="rounded-lg bg-slate-800 text-white p-5">
        <h1 className="text-lg font-bold">Research Insights</h1>
        <p className="text-xs text-slate-300 mt-1">
          Dataset version {data.dataset_version} · generated from recorded
          evaluation artifacts. Findings use cautious research language:
          observed facts ≠ proven causes.
        </p>
      </header>

      {/* Dataset overview */}
      <Section title="Dataset Overview">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <MiniStat label="Total images" value={String(data.dataset.total_images)} />
          <MiniStat label="Target per class" value="500" />
          <MiniStat label="Split target" value="80/10/10" />
          <MiniStat label="Imbalance ratio" value={data.dataset.imbalance_ratio != null ? `${data.dataset.imbalance_ratio}:1` : "—"} />
        </div>
        <BarList
          title="Class distribution (approved images)"
          items={Object.entries(data.dataset.per_class).map(([k, v]) => ({ key: k, value: v }))}
          max={Math.max(1, ...Object.values(data.dataset.per_class))}
        />
        <Observations items={data.dataset.observations} />
      </Section>

      {/* Model performance */}
      <Section title="Model Performance">
        {modelKeys.length === 0 ? (
          <EmptyState title="No evaluated models" message="Run the Pipeline Runner to produce candidates with evaluation artifacts." />
        ) : (
          <>
            <select aria-label="Select model version"
              className="mb-4 border rounded px-2 py-1.5 text-sm"
              value={modelKey ?? ""} onChange={(e) => setModelKey(e.target.value)}>
              {modelKeys.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            {model && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <MiniStat label="Test accuracy" value={String(model.performance.accuracy)} />
                  <MiniStat label="Macro F1" value={String(model.performance.macro.f1)} />
                  <MiniStat label="Test set size" value={String(model.performance.test_size)} />
                  <MiniStat label="Best class (F1)" value={model.performance.best_class_by_f1} />
                </div>
                {model.performance.statistical_warning && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                    ⚠️ {model.performance.statistical_warning}
                  </p>
                )}
                <PerClassTable perClass={model.performance.per_class} />
                <Findings items={model.performance.findings} />

                {/* Confusion */}
                <h3 className="font-semibold pt-2">Confusion analysis</h3>
                <ConfusionTable cm={model.confusion.matrix_raw} />
                {model.confusion.most_frequent_confusion ? (
                  <p className="text-sm text-gray-600">
                    Most frequent confusion:{" "}
                    <strong>{model.confusion.most_frequent_confusion.actual} → {model.confusion.most_frequent_confusion.predicted}</strong>{" "}
                    ({model.confusion.most_frequent_confusion.count} occurrence(s)). Directional — A→B ≠ B→A.
                  </p>
                ) : (
                  <p className="text-sm text-gray-500">No misclassifications recorded in this evaluation.</p>
                )}

                {/* Confidence & errors */}
                <h3 className="font-semibold pt-2">Confidence & errors</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <MiniStat label="Total predictions" value={String(model.confidence_errors.total_predictions)} />
                  <MiniStat label="Errors" value={String(model.confidence_errors.total_errors)} />
                  <MiniStat label="High-conf errors" value={String(model.confidence_errors.high_confidence_errors.length)} />
                  <MiniStat label="Low-confidence preds" value={String(model.confidence_errors.low_confidence_predictions)} />
                </div>
                <Findings items={[model.confidence_errors.finding, model.confidence_errors.calibration_note]} />

                {/* Improvements */}
                <h3 className="font-semibold pt-2">Improvement opportunities</h3>
                {model.improvements.length === 0 ? (
                  <p className="text-sm text-gray-500">No evidence-based opportunities identified.</p>
                ) : (
                  <ul className="list-disc ml-5 text-sm space-y-1">
                    {model.improvements.map((o: any, i: number) => (
                      <li key={i}>
                        {o.opportunity} <span className="text-xs text-gray-400">— evidence: {o.evidence}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </Section>

      {/* Application insights — separate source, clearly labeled */}
      <Section title="Application Data (separate from research metrics)">
        {data.application.total_predictions === 0 ? (
          <p className="text-sm text-gray-500">
            No application prediction data is currently available.
          </p>
        ) : (
          <div className="space-y-2 text-sm">
            <p>Total analyzed: {data.application.total_predictions}</p>
            <BarList
              title="Prediction distribution"
              items={Object.entries(data.application.predictions_per_class).map(([k, v]) => ({ key: k, value: v }))}
              max={Math.max(1, ...Object.values(data.application.predictions_per_class))}
            />
            <ul className="list-disc ml-5">
              <li>Low-confidence rate: {data.application.low_confidence_rate ?? "—"}%</li>
              <li>Feedback rate: {data.application.feedback_rate ?? "—"}%</li>
              <li>Disagreement rate: {data.application.disagreement_rate ?? "—"}%</li>
            </ul>
          </div>
        )}
      </Section>

      <p className="text-xs text-gray-400">{data.generated_note}</p>
    </div>
  );
}

/* ---------- presentational helpers ---------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-white border border-gray-200 p-5 space-y-3">
      <h2 className="text-lg font-semibold border-b pb-2 border-gray-100">{title}</h2>
      {children}
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-gray-200 p-3">
      <p className="text-xs text-gray-500 truncate">{label}</p>
      <p className="font-semibold mt-0.5 truncate">{value}</p>
    </div>
  );
}

function BarList({ title, items, max }: { title: string; items: { key: string; value: number }[]; max: number }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-gray-500">{title}</p>
      {items.map((it) => (
        <div key={it.key} className="flex items-center gap-2 text-sm">
          <span className="w-32 truncate">{it.key}</span>
          <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-leaf-500" style={{ width: `${(it.value / max) * 100}%` }} />
          </div>
          <span className="w-10 text-right text-gray-500">{it.value}</span>
        </div>
      ))}
    </div>
  );
}

function PerClassTable({ perClass }: { perClass: Record<string, any> }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-gray-500 border-b">
        <tr><th className="py-1.5 pr-3">Class</th><th className="pr-3">Support</th><th className="pr-3">Precision</th><th className="pr-3">Recall</th><th>F1</th></tr>
      </thead>
      <tbody>
        {Object.entries(perClass).map(([cls, m]: [string, any]) => (
          <tr key={cls} className="border-b last:border-0 border-gray-100">
            <td className="py-1.5 pr-3">{cls}</td>
            <td className="pr-3">{m.support}</td>
            <td className="pr-3">{m.precision}</td>
            <td className="pr-3">{m.recall}</td>
            <td>{m.f1}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConfusionTable({ cm }: { cm: any }) {
  const rowKeys = Object.keys(cm.rows_actual) as string[];
  const cols: string[] = cm.columns_predicted ?? (rowKeys.length ? Object.keys(cm.rows_actual[rowKeys[0]]) : []);
  // rows_actual is keyed by actual class with array values aligned to class order
  const keys: string[] = cm.columns_predicted ?? cols;
  return (
    <table className="text-sm w-full max-w-md">
      <thead>
        <tr>
          <th className="text-left text-gray-400 text-xs pr-2">Actual \ Predicted</th>
          {keys.map((k) => <th key={k} className="px-2 text-xs text-gray-500">{k}</th>)}
        </tr>
      </thead>
      <tbody>
        {rowKeys.map((actual) => (
          <tr key={actual}>
            <td className="text-xs text-gray-500 pr-2 py-1">{actual}</td>
            {(cm.rows_actual[actual] ?? []).map((n: number, i: number) => (
              <td key={i} className={`text-center px-2 ${i === keys.indexOf(actual) && n > 0 ? "bg-green-50 font-semibold" : n > 0 ? "bg-red-50" : "text-gray-300"}`}>
                {n}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Findings({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1 text-sm text-gray-700">
      {items.filter(Boolean).map((f, i) => (
        <li key={i}>• {f}</li>
      ))}
    </ul>
  );
}

function Observations({ items }: { items: string[] }) {
  if (!items?.length) return null;
  return (
    <ul className="space-y-1 text-sm text-gray-700">
      {items.map((o, i) => <li key={i}>• {o}</li>)}
    </ul>
  );
}
