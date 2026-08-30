import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

/** Public landing page for Leafnet — no app chrome, standalone presentation. */

// SCHEMATIC: if public/schematic.png exists it is shown; otherwise the built-in SVG fallback renders.
function useSchematicImage() {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setSrc("/schematic.png");
    img.src = "/schematic.png";
  }, []);
  return src;
}

const FEATURES = [
  {
    icon: "🍃",
    title: "Analyze a leaf",
    text: "Upload a mulberry leaf photo and get an instant four-class visual assessment: Healthy, Leaf Rust, Leaf Spot, or Leaf Blight.",
    to: "/analyzer",
    cta: "Open Leaf Analyzer",
  },
  {
    icon: "📊",
    title: "Research insights",
    text: "Explore what the dataset reveals and how the MobileNetV2 model performs — per class, with confusion analysis and confidence behavior.",
    to: "/insights",
    cta: "View Insights",
  },
  {
    icon: "🧪",
    title: "Built for research",
    text: "Every label is expert-reviewed, every model version is traceable to its exact training data, and every claim is backed by evidence.",
    to: "/models",
    cta: "See Model Registry",
  },
];

const WORKFLOW = [
  ["1", "Upload", "A clear photo of a mulberry leaf"],
  ["2", "Analyze", "MobileNetV2 classifies it visually"],
  ["3", "Review", "See confidence and all probabilities"],
  ["4", "Feedback", "Help improve the model with expert review"],
];

export default function Landing() {
  const schematic = useSchematicImage();
  return (
    <div className="min-h-screen bg-gradient-to-b from-leaf-50 via-white to-white">
      {/* Hero */}
      <header className="max-w-5xl mx-auto px-6 pt-16 pb-12 text-center">
        <p className="text-sm font-semibold tracking-widest text-leaf-600 uppercase">
          Mulberry Leaf Intelligence
        </p>
        <h1 className="mt-3 text-4xl sm:text-6xl font-extrabold text-gray-900 leading-tight">
          Leaf<span className="text-leaf-600">net</span>
        </h1>
        <p className="mt-5 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto">
          An AI-powered visual classification system that helps identify the
          health of mulberry leaves — supporting sericulture research and
          the growers behind it.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/analyzer"
            className="px-8 py-3 rounded-lg bg-leaf-600 text-white font-semibold text-lg hover:bg-leaf-700 focus:ring-2 focus:ring-leaf-500 focus:ring-offset-2">
            🍃 Analyze a Leaf
          </Link>
          <Link to="/insights"
            className="px-8 py-3 rounded-lg border-2 border-leaf-600 text-leaf-700 font-semibold text-lg hover:bg-leaf-50">
            Research Insights
          </Link>
        </div>
        <p className="mt-4 text-xs text-gray-400">
          Visual classification only — not a laboratory diagnosis.
        </p>
      </header>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 py-10 grid grid-cols-1 md:grid-cols-3 gap-6">
        {FEATURES.map((f) => (
          <div key={f.title}
            className="rounded-2xl bg-white border border-gray-200 shadow-sm p-6 flex flex-col hover:shadow-md transition-shadow">
            <span className="text-3xl">{f.icon}</span>
            <h2 className="mt-3 font-bold text-lg text-gray-900">{f.title}</h2>
            <p className="mt-2 text-sm text-gray-600 flex-1">{f.text}</p>
            <Link to={f.to} className="mt-4 text-sm font-semibold text-leaf-600 hover:text-leaf-700">
              {f.cta} →
            </Link>
          </div>
        ))}
      </section>

      {/* Workflow */}
      <section className="max-w-5xl mx-auto px-6 py-10">
        <h2 className="text-center text-2xl font-bold text-gray-900">How it works</h2>
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-4 gap-4">
          {WORKFLOW.map(([n, t, d]) => (
            <div key={n} className="rounded-xl bg-white border border-gray-200 p-5 text-center">
              <span className="inline-flex w-9 h-9 items-center justify-center rounded-full bg-leaf-600 text-white font-bold">
                {n}
              </span>
              <p className="mt-3 font-semibold">{t}</p>
              <p className="text-xs text-gray-500 mt-1">{d}</p>
            </div>
          ))}
        </div>

        {/* System architecture schematic */}
        <div className="mt-10 rounded-2xl bg-slate-900 p-6 sm:p-8 overflow-x-auto">
          <h3 className="text-center text-sm font-semibold tracking-widest text-slate-400 uppercase">
            System architecture
          </h3>
          {schematic ? (
            <img src={schematic} alt="LEAFNET system architecture diagram"
              className="w-full mt-4 rounded-lg" />
          ) : (
          <>
          <svg viewBox="0 0 880 360" className="w-full min-w-[720px] mt-4" role="img"
            aria-label="System architecture: React frontend to Node.js API to Python ML service to MobileNetV2, with PostgreSQL database">
            <defs>
              <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <path d="M0,0 L9,3 L0,6 Z" fill="#94a3b8" />
              </marker>
              <linearGradient id="leafgrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#16a34a" />
                <stop offset="100%" stopColor="#15803d" />
              </linearGradient>
            </defs>

            {/* boxes */}
            <g fontFamily="system-ui, sans-serif" fontSize="13">
              {/* user */}
              <rect x="20" y="150" width="120" height="60" rx="12" fill="#1e293b" stroke="#475569" />
              <text x="80" y="175" textAnchor="middle" fill="#e2e8f0" fontWeight="600">User</text>
              <text x="80" y="193" textAnchor="middle" fill="#94a3b8" fontSize="11">leaf photo</text>

              {/* react */}
              <rect x="200" y="140" width="140" height="80" rx="12" fill="url(#leafgrad)" />
              <text x="270" y="172" textAnchor="middle" fill="#fff" fontWeight="700">React Frontend</text>
              <text x="270" y="190" textAnchor="middle" fill="#dcfce7" fontSize="11">TypeScript · Tailwind</text>

              {/* node */}
              <rect x="400" y="140" width="150" height="80" rx="12" fill="#0ea5e9" />
              <text x="475" y="166" textAnchor="middle" fill="#fff" fontWeight="700">Node.js API</text>
              <text x="475" y="184" textAnchor="middle" fill="#e0f2fe" fontSize="11">Express · Prisma</text>
              <text x="475" y="200" textAnchor="middle" fill="#bae6fd" fontSize="11">validation · persistence</text>

              {/* ml */}
              <rect x="610" y="140" width="150" height="80" rx="12" fill="#f59e0b" />
              <text x="685" y="166" textAnchor="middle" fill="#fff" fontWeight="700">Python ML Service</text>
              <text x="685" y="184" textAnchor="middle" fill="#fef3c7" fontSize="11">FastAPI · PyTorch</text>
              <text x="685" y="200" textAnchor="middle" fill="#fde68a" fontSize="11">MobileNetV2</text>

              {/* db */}
              <ellipse cx="475" cy="300" rx="85" ry="32" fill="#334155" stroke="#64748b" />
              <text x="475" y="296" textAnchor="middle" fill="#e2e8f0" fontWeight="600">PostgreSQL</text>
              <text x="475" y="314" textAnchor="middle" fill="#94a3b8" fontSize="11">images · predictions · feedback</text>
            </g>

            {/* arrows */}
            <g stroke="#94a3b8" strokeWidth="2" markerEnd="url(#arrow)">
              <line x1="140" y1="180" x2="196" y2="180" />
              <line x1="340" y1="180" x2="396" y2="180" />
              <line x1="550" y1="180" x2="606" y2="180" />
              {/* node <-> db */}
              <line x1="475" y1="220" x2="475" y2="264" />
            </g>
            {/* return arrows (dashed) */}
            <g stroke="#64748b" strokeWidth="1.5" strokeDasharray="5 4" markerEnd="url(#arrow)">
              <line x1="606" y1="205" x2="550" y2="205" />
              <line x1="396" y1="205" x2="344" y2="205" />
            </g>

            {/* arrow labels */}
            <g fontFamily="system-ui, sans-serif" fontSize="10" fill="#cbd5e1">
              <text x="268" y="172" textAnchor="middle">upload / request</text>
              <text x="473" y="170" textAnchor="middle">/predict (HTTP)</text>
              <text x="692" y="216" textAnchor="middle" fill="#94a3b8">probabilities</text>
              <text x="368" y="220" textAnchor="middle" fill="#94a3b8">result + persistence</text>
              <text x="505" y="246" fill="#94a3b8">store</text>
            </g>

            {/* model output chips */}
            <g fontFamily="system-ui, sans-serif" fontSize="11">
              <rect x="600" y="250" width="170" height="76" rx="10" fill="#14532d" stroke="#22c55e" />
              <text x="685" y="272" textAnchor="middle" fill="#bbf7d0" fontWeight="600">Four-class output</text>
              <text x="685" y="290" textAnchor="middle" fill="#86efac">healthy · leaf_rust</text>
              <text x="685" y="306" textAnchor="middle" fill="#86efac">leaf_spot · leaf_blight</text>
              <line x1="760" y1="220" x2="730" y2="250" stroke="#94a3b8" strokeWidth="2" markerEnd="url(#arrow)" />
            </g>
          </svg>
          </>
          )}
        </div>
      </section>

      {/* Research note */}
      <section className="max-w-3xl mx-auto px-6 py-10">
        <div className="rounded-2xl bg-slate-800 text-slate-100 p-8 text-center">
          <h2 className="text-xl font-bold">More than a demo — a chain of evidence</h2>
          <p className="mt-3 text-sm text-slate-300">
            Leafnet was built with research discipline: every training image is
            expert-verified, every model version is traceable to its exact dataset,
            and every metric comes from a held-out test set. The system is honest
            about what it knows — and about what is still being learned.
          </p>
          <Link to="/tools/status"
            className="inline-block mt-5 px-5 py-2 rounded-lg bg-white text-slate-900 text-sm font-semibold hover:bg-slate-200">
            Live research status →
          </Link>
        </div>
      </section>

      <footer className="border-t border-gray-200 py-6 text-center text-xs text-gray-400">
        Leafnet · Masteral research project · Visual classification is not a laboratory diagnosis.
        <Link to="/tools" className="block mt-2 text-leaf-600 hover:underline">Researcher sign-in</Link>
      </footer>
    </div>
  );
}
