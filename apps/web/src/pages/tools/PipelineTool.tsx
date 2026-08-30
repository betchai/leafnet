// TOOLS + PIPELINE
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";

interface DatasetRow {
  id: string;
  version: string;
  totalImages: number | null;
}

interface JobState {
  status: string;
  steps: Record<string, { status: string; [k: string]: unknown }>;
  log: string[];
  error?: string;
}

/** Pipeline Runner — one click for Steps 9→10→11 (explore → train → evaluate)
 *  after cutting a dataset version. Runs in the Python ML service. */
const JOB_KEY = "leafnet.pipeline.jobId";

export default function PipelineTool() {
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [versionId, setVersionId] = useState("");
  const [epochs, setEpochs] = useState(20);
  const [fineTuneLayers, setFineTuneLayers] = useState(5);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    api.datasets().then((r) => {
      const rows = (r.items as DatasetRow[]) ?? [];
      setDatasets(rows);
      if (rows[0]) setVersionId(rows[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem(JOB_KEY);
    if (saved) {
      setJobId(saved);
      setBusy(true);
      return;
    }
    fetch("/api/tools/pipeline/jobs")
      .then((r) => r.json())
      .then((list) => {
        if (!Array.isArray(list)) return;
        const running = (list as { job_id: string; status: string }[]).find((j) => j.status === "running");
        if (running?.job_id) {
          setJobId(running.job_id);
          sessionStorage.setItem(JOB_KEY, running.job_id);
          setBusy(true);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!jobId) return;
    timer.current = window.setInterval(async () => {
      let d: JobState & { error?: string };
      try {
        const r = await fetch(`/api/tools/pipeline/status/${jobId}`);
        d = await r.json();
      } catch {
        return;
      }
      if (d?.error) {
        try {
          const list = await fetch("/api/tools/pipeline/jobs").then((r) => r.json());
          const running = Array.isArray(list)
            ? (list as { job_id: string; status: string }[]).find((j) => j.status === "running")
            : null;
          if (running?.job_id) {
            setJobId(running.job_id);
            sessionStorage.setItem(JOB_KEY, running.job_id);
            setBusy(true);
            return;
          }
        } catch {
        }
        setError("This pipeline job is no longer tracked — the ML service restarted and its in-memory job state was lost. Start a new run.");
        setBusy(false);
        window.clearInterval(timer.current);
        return;
      }
      setJob(d);
      if (d.status === "completed" || d.status === "failed") {
        window.clearInterval(timer.current);
        setBusy(false);
      }
    }, 3000);
    return () => window.clearInterval(timer.current);
  }, [jobId]);

  async function run() {
    const ds = datasets.find((d) => d.id === versionId);
    if (!ds) return setError("Select a dataset version");
    setBusy(true);
    setError(null);
    setJob(null);

    // Two experiments per methodology: baseline + fine-tune (controlled comparison)
    const res = await fetch("/api/tools/pipeline/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        datasetId: versionId,
        versionLabel: ds.version,
        experiments: [
          { id: `EXP-${ds.version.replace("v", "")}-B`, strategy: "baseline",
            epochs, notes: `baseline on ${ds.version} via pipeline runner` },
          { id: `EXP-${ds.version.replace("v", "")}-FT`, strategy: "fine_tune",
            fineTuneLayers, epochs,
            notes: `fine-tune last ${fineTuneLayers} blocks on ${ds.version}` },
        ],
      }),
    });
    const d = await res.json();
    if (!res.ok) {
      setError(d.error ?? `HTTP ${res.status}`);
      setBusy(false);
      return;
    }
    setJobId(d.jobId);
    sessionStorage.setItem(JOB_KEY, d.jobId);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <section className="rounded-lg bg-white border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold">Run pipeline: Step 9 → 10 → 11</h2>
        <p className="text-xs text-gray-500">
          Exploration report refresh → preflight → train baseline + fine-tune
          candidates → evaluate on the isolated test set. Long-running on CPU.
          Test set is evaluated exactly once per candidate.
        </p>
        <select className="w-full border rounded px-2 py-1.5 text-sm"
          value={versionId} onChange={(e) => setVersionId(e.target.value)}>
          <option value="">— select dataset version —</option>
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.version} ({d.totalImages ?? "?"} images)
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="flex flex-col gap-1">
            Epochs
            <input type="number" min={1} max={200} className="border rounded px-2 py-1"
              value={epochs} onChange={(e) => setEpochs(Number(e.target.value))} />
          </label>
          <label className="flex flex-col gap-1">
            Fine-tune blocks (EXP-FT)
            <input type="number" min={0} max={19} className="border rounded px-2 py-1"
              value={fineTuneLayers} onChange={(e) => setFineTuneLayers(Number(e.target.value))} />
          </label>
        </div>
        <button onClick={run} disabled={busy || !versionId}
          className="px-5 py-2 rounded-md bg-slate-700 text-white font-medium disabled:opacity-40">
          {busy ? "Pipeline running…" : "▶ Run Steps 9–11"}
        </button>
        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</p>}
      </section>

      {job && (
        <section className="rounded-lg bg-white border border-gray-200 p-5 space-y-2 text-sm">
          <p className="font-medium">
            Job {jobId} ·{" "}
            <span className={job.status === "failed" ? "text-red-600" : "text-green-700"}>
              {job.status}
            </span>
          </p>
          <ul className="space-y-1">
            {Object.entries(job.steps).map(([step, s]) => (
              <li key={step} className="font-mono text-xs">
                {s.status === "done" ? "✅" : s.status === "failed" ? "❌" : "⏳"}{" "}
                {step}
                {s.epoch != null
                  ? ` — epoch ${s.epoch}${s.val_accuracy != null ? ` · val acc ${s.val_accuracy}` : ""}${s.train_accuracy != null ? ` · train acc ${s.train_accuracy}` : ""}`
                  : ""}
                {"accuracy" in s ? ` — accuracy ${s.accuracy}` : ""}
              </li>
            ))}
          </ul>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-gray-500">log</summary>
            <pre className="text-[10px] bg-gray-50 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-64">
              {job.log.join("\n")}
            </pre>
          </details>
          {job.status === "completed" && (
            <p className="text-xs text-gray-500 pt-2">
              Artifacts: ml/models/ and ml/reports/experiments/, evaluation in
              ml/reports/evaluation/. Hand results to the assistant for model cards +
              Phase 6 status update.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
