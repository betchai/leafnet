import { Routes, Route, NavLink, Link } from "react-router-dom";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import Analyzer from "./pages/Analyzer";
import DatasetPage from "./pages/Dataset";
import Models from "./pages/Models";
// INSIGHTS
import Insights from "./pages/Insights";
// TOOLS: encapsulated researcher tooling. Remove this block + the marked
// routes/nav to drop the entire Tools section (see pages/tools/ToolsLayout.tsx).
import ToolsLayout from "./pages/tools/ToolsLayout";
import LabelTool from "./pages/tools/LabelTool";
import BulkIngestTool from "./pages/tools/BulkIngestTool"; // TOOLS
import ReviewTool from "./pages/tools/ReviewTool";
import StatusTool from "./pages/tools/StatusTool";
import PipelineTool from "./pages/tools/PipelineTool"; // TOOLS + PIPELINE
import FeedbackReviewTool from "./pages/tools/FeedbackReviewTool"; // PHASE 9.1
import MonitoringTool from "./pages/tools/MonitoringTool"; // PHASE 9.1
import Phase2Check from "./pages/tools/Phase2Check";

function AppLayout() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <Link to="/" className="text-xl font-bold text-leaf-700">
            🍃 Leafnet
          </Link>
          <nav className="sm:ml-auto flex gap-1 overflow-x-auto">
            {[
              ["Dashboard", "/dashboard"],
              ["Leaf Analyzer", "/analyzer"],
              ["Dataset", "/dataset"],
              ["Models", "/models"],
              ["Insights", "/insights"],
              ["Tools", "/tools"], // TOOLS
            ].map(([label, to]) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/dashboard"}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap ${
                    isActive
                      ? "bg-leaf-500 text-white"
                      : "text-gray-600 hover:bg-gray-100"
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8">
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/analyzer" element={<Analyzer />} />
          <Route path="/dataset" element={<DatasetPage />} />
          <Route path="/models" element={<Models />} />
          <Route path="/insights" element={<Insights />} />
          {/* TOOLS */}
          <Route path="/tools" element={<ToolsLayout />}>
            <Route index element={<LabelTool />} />
            <Route path="label" element={<LabelTool />} />
            <Route path="bulk" element={<BulkIngestTool />} /> {/* TOOLS */}
            <Route path="review" element={<ReviewTool />} />
            <Route path="feedback-review" element={<FeedbackReviewTool />} /> {/* PHASE 9.1 */}
            <Route path="monitoring" element={<MonitoringTool />} /> {/* PHASE 9.1 */}
            <Route path="pipeline" element={<PipelineTool />} /> {/* TOOLS + PIPELINE */}
            <Route path="status" element={<StatusTool />} />
            <Route path="phase2" element={<Phase2Check />} />
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

export default function App() {
  return (
    <Routes>
      {/* Public landing page (standalone, no app chrome) */}
      <Route path="/" element={<Landing />} />
      {/* Application */}
      <Route path="/*" element={<AppLayout />} />
    </Routes>
  );
}
