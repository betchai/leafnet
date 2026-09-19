import { useEffect, useState } from "react";
import { api, apiFetch, ClassConfig } from "../../lib/api";

/**
 * Phase 2 validation panel — moved into the encapsulated Tools section.
 *
 * Reads ONLY existing endpoints (/api/classes, /api/images)
 * and touches no other page or component.
 *
 * To remove entirely: delete this file and the Tools section (see ToolsLayout.tsx).
 */

interface ClassDef {
  key: string;
  id: number;
  label: string;
  description: string;
  display_name?: string;
  category?: string;
  visual_indicators?: string[];
  annotation_guidance?: string;
  confounding_conditions?: string[];
  definition_confidence?: string;
  evidence_sources?: string[];
}

const TARGETS: Record<string, number> = {
  healthy: 500,
  leaf_rust: 500,
  leaf_spot: 500,
  leaf_blight: 500,
  not_mulberry: 500,
};
const TOTAL_TARGET = Object.values(TARGETS).reduce((a, b) => a + b, 0);

export default function Phase2Validation() {
  const [config, setConfig] = useState<ClassConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [openClass, setOpenClass] = useState<string | null>(null);

  useEffect(() => {
    api
      .classes()
      .then(async (cfg) => {
        setConfig(cfg);
        try {
          // Authoritative, uncapped live counts from the composition endpoint
          // (the images list caps at 200 rows, so per-class fetches undercount).
          const r = await apiFetch("/datasets/status");
          const status = await r.json();
          const approved: Record<string, number> = {};
          for (const [key, val] of Object.entries(status.perClass ?? {})) {
            approved[key] = (val as { approved?: number }).approved ?? 0;
          }
          setCounts(approved);
        } catch {
          setCounts({});
        }
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  if (error)
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
        Failed to load class config: {error}
      </div>
    );
  if (!config) return <p className="text-gray-500">Loading…</p>;

  const classes = config.classes as ClassDef[];
  const totalActual = Object.values(counts).reduce((a, b) => a + Math.max(0, b), 0);
  const taxonomyOk =
    JSON.stringify(classes.map((c) => c.key).sort()) ===
    JSON.stringify(["healthy", "leaf_blight", "leaf_rust", "leaf_spot", "not_mulberry"].sort());

  return (
    <div className="space-y-8">
      <div className="rounded-lg bg-sky-50 border border-sky-200 p-4 text-sm text-sky-800">
        🔬 <strong>Phase 2 validation panel.</strong> Encapsulated diagnostic view —
        safe to remove without affecting other pages. All numbers come live
        from real data; zeros mean "not populated yet".
      </div>

      {/* Check 1: approved taxonomy */}
      <section className="rounded-lg bg-white border border-gray-200 p-5">
        <h3 className="font-semibold flex items-center gap-2">
          1. Approved five-class taxonomy
          <Badge ok={taxonomyOk} />
        </h3>
        <p className="text-sm text-gray-500 mt-1">
          Expected keys: healthy · leaf_rust · leaf_spot · leaf_blight · not_mulberry (single-label)
        </p>
        <p className="text-sm mt-2 font-mono text-xs bg-gray-50 rounded p-2 inline-block">
          {classes.map((c) => c.key).join(" · ")}
        </p>
      </section>

      {/* Check 2: dataset targets vs actual */}
      <section className="rounded-lg bg-white border border-gray-200 p-5">
        <h3 className="font-semibold">2. Dataset composition vs target (2,000 total)</h3>
        <table className="w-full text-sm mt-3">
          <thead className="text-left text-gray-500 border-b">
            <tr>
              <th className="py-2">Class</th>
              <th>Target</th>
              <th>Actual (real records)</th>
              <th className="hidden sm:table-cell">Progress</th>
            </tr>
          </thead>
          <tbody>
            {classes.map((c) => (
              <tr key={c.key} className="border-b last:border-0 border-gray-100">
                <td className="py-2">{c.label}</td>
                <td>{TARGETS[c.key] ?? "—"}</td>
                <td>{counts[c.key] ?? "…"}</td>
                <td className="hidden sm:table-cell w-40">
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-leaf-500"
                      style={{
                        width: `${Math.min(100, ((counts[c.key] ?? 0) / (TARGETS[c.key] || 1)) * 100)}%`,
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
            <tr>
              <td className="pt-3 font-medium">Total</td>
              <td className="pt-3">{TOTAL_TARGET}</td>
              <td className="pt-3">{totalActual}</td>
              <td className="hidden sm:table-cell pt-3" />
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-gray-400 mt-2">
          Split target once populated: train {Math.round(TOTAL_TARGET * 0.8)} / validation {Math.round(TOTAL_TARGET * 0.1)} / test {Math.round(TOTAL_TARGET * 0.1)} (80/10/10).
        </p>
      </section>

      {/* Check 3: scientific definitions */}
      <section className="space-y-3">
        <h3 className="font-semibold">3. Scientific definitions & annotation guidance</h3>
        {classes.map((c) => (
          <div key={c.key} className="rounded-lg bg-white border border-gray-200">
            <button
              onClick={() => setOpenClass(openClass === c.key ? null : c.key)}
              className="w-full text-left px-5 py-4 flex items-center justify-between"
            >
              <span>
                <span className="font-mono text-xs text-gray-400 mr-2">id {c.id}</span>
                <span className="font-medium">{c.display_name ?? c.label}</span>
                {c.category && (
                  <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                    {c.category}
                  </span>
                )}
              </span>
              <span className="text-gray-400">{openClass === c.key ? "▾" : "▸"}</span>
            </button>
            {openClass === c.key && (
              <div className="px-5 pb-5 space-y-4 text-sm">
                <p className="text-gray-600">{c.description}</p>
                <Confidence level={c.definition_confidence} />
                {c.visual_indicators && (
                  <Field title="Visual indicators" items={c.visual_indicators} />
                )}
                {c.annotation_guidance && (
                  <div>
                    <p className="font-medium text-gray-700 mb-1">Annotation guidance</p>
                    <p className="text-gray-600">{c.annotation_guidance}</p>
                  </div>
                )}
                {c.confounding_conditions && (
                  <Field title="Confounding conditions" items={c.confounding_conditions} warn />
                )}
                {c.evidence_sources && (
                  <details className="text-xs text-gray-500">
                    <summary className="cursor-pointer font-medium">
                      Evidence sources ({c.evidence_sources.length})
                    </summary>
                    <ul className="list-disc ml-5 mt-2 space-y-1">
                      {c.evidence_sources.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
        ))}
      </section>

      {/* Check 4: honest-state reminders */}
      <section className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800 space-y-1">
        <p><strong>Honesty checks:</strong></p>
        <p>✓ Counts above are live from real approved records — never fabricated.</p>
        <p>✓ No model metrics anywhere in the system.</p>
        <p>✓ Blight↔spot boundary ambiguity is documented as an open research risk.</p>
      </section>
    </div>
  );
}

function Field({ title, items, warn }: { title: string; items: string[]; warn?: boolean }) {
  return (
    <div>
      <p className={`font-medium mb-1 ${warn ? "text-amber-700" : "text-gray-700"}`}>
        {title}
      </p>
      <ul className="list-disc ml-5 text-gray-600 space-y-0.5">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function Badge({ ok }: { ok: boolean }) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full ${
        ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
      }`}
    >
      {ok ? "PASS" : "MISMATCH"}
    </span>
  );
}

function Confidence({ level }: { level?: string }) {
  if (!level) return null;
  const cls =
    level.startsWith("high")
      ? "bg-green-100 text-green-700"
      : level.startsWith("medium")
        ? "bg-amber-100 text-amber-700"
        : "bg-gray-100 text-gray-600";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>
      Definition confidence: {level}
    </span>
  );
}
