/**
 * TOOLS SECTION — encapsulated researcher tooling (annotation, review, validators).
 *
 * Everything under src/pages/tools/ plus the "TOOLS" lines in App.tsx is
 * self-contained application tooling, deliberately kept out of the public
 * product pages (Dashboard / Analyzer / Dataset / Models).
 *
 * To remove the entire Tools section:
 *   1. Delete this directory.
 *   2. Remove the routes/nav marked "TOOLS" in src/App.tsx.
 * No product page or API contract depends on it.
 */
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Role } from "../../components/RouteGuards";

type Tab = { label: string; to: string; roles: Role[] };

const TABS: Tab[] = [
  { label: "Acquire & Label", to: "/tools/label", roles: ["RESEARCHER", "EXPERT"] },
  { label: "Bulk Ingest", to: "/tools/bulk", roles: ["RESEARCHER", "EXPERT"] },
  { label: "Expert Review", to: "/tools/review", roles: ["EXPERT"] },
  { label: "Feedback Review", to: "/tools/feedback-review", roles: ["EXPERT"] },
  { label: "Monitoring", to: "/tools/monitoring", roles: ["EXPERT"] },
  { label: "Dataset Status", to: "/tools/status", roles: ["EXPERT"] },
  { label: "Pipeline Runner", to: "/tools/pipeline", roles: ["EXPERT"] },
  { label: "Phase 2 Validator", to: "/tools/phase2", roles: ["EXPERT"] },
];

// End-to-end workflow — doubles as the tools navigation. Step 4 is the Dataset
// Status tool, which checks readiness and cuts a versioned dataset from APPROVED
// images before the pipeline can run.
const FLOW: Array<{ to: string; label: string }> = [
  { to: "/tools/label", label: "Acquire & Label" },
  { to: "/tools/bulk", label: "Bulk Ingest" },
  { to: "/tools/review", label: "Expert Review" },
  { to: "/tools/status", label: "Status & Cut" },
  { to: "/tools/pipeline", label: "Pipeline Runner" },
  { to: "/tools/feedback-review", label: "Feedback Review" },
  { to: "/tools/monitoring", label: "Monitoring" },
];
const SUPPORT_ORDER = ["/tools/phase2"];

const STEP_GUIDE: Record<string, { step: string; name: string; purpose: string; drives: string }> = {
  "/tools/label": {
    step: "1",
    name: "Acquire & Label",
    purpose:
      "Upload individual leaf photos and attach that image's first class label (healthy / rust / spot / blight). Reject or flag unusable images.",
    drives:
      "A labeled image becomes ANNOTATED and is queued for Expert Review — the entry gate to ground truth.",
  },
  "/tools/bulk": {
    step: "2",
    name: "Bulk Ingest",
    purpose:
      "Upload many photos at once with shared metadata (source, session, farm, license). Optionally assigns one preliminary label to the whole batch.",
    drives:
      "Grows the labeled pool quickly toward the per-class target, and queues every accepted image for Expert Review.",
  },
  "/tools/review": {
    step: "3",
    name: "Expert Review",
    purpose:
      "An expert confirms or corrects each label (relabel, second opinion, uncertain, reject). APPROVED is the only state a dataset cut accepts.",
    drives:
      "Drives dataset cuts and training — only APPROVED images count as ground truth and may enter a dataset version.",
  },
  "/tools/pipeline": {
    step: "5",
    name: "Pipeline Runner",
    purpose:
      "First cut a dataset version from APPROVED images (Dataset page). Then one click for explore → train → evaluate on that version. Runs in the Python ML service.",
    drives:
      "Produces trained model versions plus evaluation artifacts (metrics.json / acceptance.json) and the PASS / FAIL verdict.",
  },
  "/tools/feedback-review": {
    step: "6",
    name: "Feedback Review",
    purpose:
      "Experts verify end-user feedback on live predictions (agree / disagree / unsure). VERIFIED feedback becomes candidate training data — never autolabels an image.",
    drives:
      "Feeds field-performance monitoring, real-world confusion detection, and candidate data for the next dataset version.",
  },
  "/tools/monitoring": {
    step: "7",
    name: "Monitoring",
    purpose:
      "Lab vs field comparison per model: held-out acceptance metrics versus expert-verified real-world accuracy, confidence, and drift signals.",
    drives:
      "Signals degradation or drift so an expert can decide when to retrain or promote the next model.",
  },
  "/tools/status": {
    step: "4",
    name: "Dataset Status & Cut",
    purpose:
      "Check live progress toward the 500-image-per-class target, class balance, and duplicate flags — then snapshot all APPROVED research images into a versioned dataset.",
    drives:
      "Produces the versioned dataset the Pipeline Runner trains on; readiness signals that tell you when to cut.",
  },
  "/tools/phase2": {
    step: "s",
    name: "Phase 2 Validator",
    purpose:
      "Reads the class taxonomy and per-class image counts to validate the 4-class annotation scheme.",
    drives:
      "Confirms the taxonomy and acquisition are healthy before labeling and training — an early data-quality check.",
  },
};

export default function ToolsLayout() {
  const { user } = useAuth();
  const role = user?.role ?? "FARMER";
  const tabs = TABS.filter((t) => t.roles.includes(role));
  const { pathname } = useLocation();
  const active = tabs.some((t) => t.to === pathname) ? pathname : tabs[0]?.to ?? "/tools/label";
  const guide = STEP_GUIDE[active] ?? STEP_GUIDE["/tools/label"];

  return (
    <div className="space-y-5">
      {/* Header: step explainer + workflow (one block, no duplicated header) */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900 text-white p-5 sm:p-6 shadow-lg ring-1 ring-black/5 overflow-hidden relative">
        <div className="absolute -right-16 -top-24 w-72 h-72 bg-emerald-500/10 rounded-full blur-2xl" />
        <div className="relative">
          <p className="text-[11px] font-semibold tracking-[.14em] uppercase text-slate-300 text-center">
            Research &amp; verification console
          </p>
          <h1 className="text-lg sm:text-xl font-bold mt-1 tracking-tight text-center">{guide.name}</h1>

          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <div className="rounded-xl bg-white/8 ring-1 ring-white/10 backdrop-blur-sm p-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300 mb-1">
                What this step does
              </p>
              <p className="text-sm text-slate-100 leading-relaxed">{guide.purpose}</p>
            </div>
            <div className="rounded-xl bg-white/8 ring-1 ring-white/10 backdrop-blur-sm p-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300 mb-1">
                What it drives
              </p>
              <p className="text-sm text-slate-100 leading-relaxed">{guide.drives}</p>
            </div>
          </div>

          {/* End-to-end workflow — also serves as the tools navigation */}
          <div className="mt-5 pt-4 border-t border-white/10">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
              End-to-end workflow
            </p>
            <div className="flex flex-wrap justify-center items-center gap-y-2">
              {FLOW.map((f, i) => (
                <div key={f.to} className="flex items-center">
                  <NavLink
                    to={f.to}
                    className={({ isActive }) =>
                      `whitespace-nowrap px-2 py-1 rounded-md text-xs font-medium ring-1 transition ${
                        isActive
                          ? "bg-emerald-600 text-white ring-emerald-500"
                          : "bg-white/10 text-slate-100 ring-white/15 hover:bg-white/20"
                      }`
                    }
                  >
                    <span className="inline-block w-3.5 text-right mr-1 font-bold opacity-60">{i + 1}</span>
                    {f.label}
                  </NavLink>
                  {i < FLOW.length - 1 && (
                    <span className="mx-1 text-slate-500 select-none">→</span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap justify-center items-center gap-2 mt-2.5">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mr-1">
                Supporting checks
              </span>
              {SUPPORT_ORDER.map((to) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `px-2 py-1 rounded-md text-[12px] font-medium ring-1 transition ${
                      isActive
                        ? "bg-emerald-600 text-white ring-emerald-500"
                        : "bg-white/5 text-slate-300 ring-white/10 hover:bg-white/10"
                    }`
                  }
                >
                  {STEP_GUIDE[to].name}
                </NavLink>
              ))}
              <span className="text-[11px] text-slate-500 ml-1">— data-quality aid</span>
            </div>
          </div>
        </div>
      </div>

      <Outlet />
    </div>
  );
}