import { Routes, Route, NavLink, Link } from "react-router-dom";
import { Navigate } from "react-router-dom";
import { RequireAuth, RequireRole, Role } from "./components/RouteGuards";
import { useAuth } from "./auth/AuthContext";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Analyzer from "./pages/Analyzer";
import DatasetPage from "./pages/Dataset";
import Models from "./pages/Models";
import Insights from "./pages/Insights";
import Users from "./pages/Users";
// TOOLS
import ToolsLayout from "./pages/tools/ToolsLayout";
import LabelTool from "./pages/tools/LabelTool";
import BulkIngestTool from "./pages/tools/BulkIngestTool";
import ReviewTool from "./pages/tools/ReviewTool";
import StatusTool from "./pages/tools/StatusTool";
import PipelineTool from "./pages/tools/PipelineTool";
import FeedbackReviewTool from "./pages/tools/FeedbackReviewTool";
import MonitoringTool from "./pages/tools/MonitoringTool";
import Phase2Check from "./pages/tools/Phase2Check";

const ROLE_LABEL: Record<Role, string> = {
  FARMER: "Farmer",
  RESEARCHER: "Researcher",
  EXPERT: "Expert",
};

function AppLayout() {
  const { user, logout } = useAuth();
  const roleName = user?.role ?? "FARMER";
  const allowed = (roles: Role[]) => roles.includes(roleName);

  const nav = [
    { label: "Dashboard", to: "/dashboard", roles: ["RESEARCHER", "EXPERT"] as Role[] },
    { label: "Leaf Analyzer", to: "/analyzer", roles: ["FARMER", "RESEARCHER", "EXPERT"] as Role[] },
    { label: "Tools", to: "/tools", roles: ["RESEARCHER", "EXPERT"] as Role[] },
    { label: "Dataset", to: "/dataset", roles: ["EXPERT"] as Role[] },
    { label: "Models", to: "/models", roles: ["EXPERT"] as Role[] },
    { label: "Insights", to: "/insights", roles: ["EXPERT"] as Role[] },
    { label: "Users", to: "/users", roles: ["EXPERT"] as Role[] },
  ].filter((n) => allowed(n.roles));

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <Link to="/" className="text-xl font-bold text-leaf-700">
            🍃 Leafnet
          </Link>
          <nav className="sm:ml-auto flex gap-1 overflow-x-auto">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === "/dashboard"}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap ${
                    isActive ? "bg-leaf-500 text-white" : "text-gray-600 hover:bg-gray-100"
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="sm:ml-3 flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-xs text-slate-600">
              {ROLE_LABEL[roleName]}
            </span>
            <span className="hidden sm:inline text-sm text-gray-500">{user?.name}</span>
            <button
              onClick={logout}
              className="px-3 py-1.5 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100 border border-gray-300"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8">
        <Routes>
          <Route path="/dashboard" element={<RequireRole roles={["RESEARCHER", "EXPERT"]}><Dashboard /></RequireRole>} />
          <Route path="/analyzer" element={<RequireAuth><Analyzer /></RequireAuth>} />
          <Route path="/dataset" element={<RequireRole roles={["EXPERT"]}><DatasetPage /></RequireRole>} />
          <Route path="/models" element={<RequireRole roles={["EXPERT"]}><Models /></RequireRole>} />
          <Route path="/insights" element={<RequireRole roles={["EXPERT"]}><Insights /></RequireRole>} />
          <Route path="/users" element={<RequireRole roles={["EXPERT"]}><Users /></RequireRole>} />
          {/* TOOLS — tabs are individually role-gated; ToolsLayout hides disallowed tabs */}
          <Route path="/tools" element={<RequireAuth><ToolsLayout /></RequireAuth>}>
            <Route index element={<ToolsIndex />} />
            <Route path="label" element={<RequireRole roles={["RESEARCHER", "EXPERT"]}><LabelTool /></RequireRole>} />
            <Route path="bulk" element={<RequireRole roles={["RESEARCHER", "EXPERT"]}><BulkIngestTool /></RequireRole>} />
            <Route path="review" element={<RequireRole roles={["EXPERT"]}><ReviewTool /></RequireRole>} />
            <Route path="feedback-review" element={<RequireRole roles={["EXPERT"]}><FeedbackReviewTool /></RequireRole>} />
            <Route path="monitoring" element={<RequireRole roles={["EXPERT"]}><MonitoringTool /></RequireRole>} />
            <Route path="pipeline" element={<RequireRole roles={["EXPERT"]}><PipelineTool /></RequireRole>} />
            <Route path="status" element={<RequireRole roles={["EXPERT"]}><StatusTool /></RequireRole>} />
            <Route path="phase2" element={<RequireRole roles={["EXPERT"]}><Phase2Check /></RequireRole>} />
          </Route>
        </Routes>
      </main>

      <footer className="border-t border-gray-200 py-4 text-center text-xs text-gray-400">
        Leafnet — Mulberry Leaf Intelligence · research prototype · visual classification is not a diagnosis ·{" "}
        <Link to="/" className="hover:text-leaf-600">Home</Link>
      </footer>
    </div>
  );
}

function ToolsIndex() {
  return <Navigate to="/tools/label" replace />;
}

export default function App() {
  return (
    <Routes>
      {/* Public landing + login (standalone, no app chrome) */}
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      {/* Application (authenticated layout) */}
      <Route path="/*" element={<AppLayout />} />
    </Routes>
  );
}