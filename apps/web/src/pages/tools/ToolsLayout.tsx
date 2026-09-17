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
import { useAuth } from "../../auth/AuthContext";
import { Role } from "../../components/RouteGuards";

type Tab = { label: string; to: string; roles: Role[] };

// TOOLS tabs, role-filtered: Researchers can acquire/label + bulk ingest;
// everything else (expert review, feedback, monitoring, status, pipeline,
// phase-2 validation) is Expert-only.
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

export default function ToolsLayout() {
  const { user } = useAuth();
  const role = user?.role ?? "FARMER";
  const tabs = TABS.filter((t) => t.roles.includes(role));

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-slate-100 border border-slate-200 p-3 text-xs text-slate-600">
        🧰 <strong>Researcher tools.</strong> Internal workflow tooling — not part of
        the public app. All actions are recorded in the annotation audit trail.
      </div>
      <nav className="flex gap-1 overflow-x-auto border-b border-gray-200 pb-2">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              `px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap ${
                isActive ? "bg-slate-700 text-white" : "text-gray-600 hover:bg-gray-100"
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
