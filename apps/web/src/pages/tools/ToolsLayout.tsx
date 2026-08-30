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
import { NavLink, Outlet } from "react-router-dom";

const TABS = [
  ["Acquire & Label", "/tools/label"],
  ["Bulk Ingest", "/tools/bulk"], // TOOLS
  ["Expert Review", "/tools/review"],
  ["Feedback Review", "/tools/feedback-review"], // PHASE 9.1
  ["Monitoring", "/tools/monitoring"], // PHASE 9.1
  ["Dataset Status", "/tools/status"],
  ["Pipeline Runner", "/tools/pipeline"], // TOOLS + PIPELINE
  ["Phase 2 Validator", "/tools/phase2"],
] as const;

export default function ToolsLayout() {
  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-slate-100 border border-slate-200 p-3 text-xs text-slate-600">
        🧰 <strong>Researcher tools.</strong> Internal workflow tooling — not part of
        the public app. All actions are recorded in the annotation audit trail.
      </div>
      <nav className="flex gap-1 overflow-x-auto border-b border-gray-200 pb-2">
        {TABS.map(([label, to]) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap ${
                isActive ? "bg-slate-700 text-white" : "text-gray-600 hover:bg-gray-100"
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
