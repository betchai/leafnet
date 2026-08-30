import { useEffect, useState } from "react";
import { api, ClassConfig } from "../lib/api";

interface Img {
  id: string;
  filename: string;
  annotationStatus: string;
  classifications: { classKey: string }[];
}

/** Dataset browser. Shows real APPROVED research images once they exist. */
export default function DatasetPage() {
  const [classes, setClasses] = useState<ClassConfig | null>(null);
  const [images, setImages] = useState<Img[] | null>(null);
  const [classFilter, setClassFilter] = useState("");
  const [annotationFilter, setAnnotationFilter] = useState("APPROVED");

  useEffect(() => {
    api.classes().then(setClasses).catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (classFilter) params.set("class", classFilter);
    if (annotationFilter) params.set("annotationStatus", annotationFilter);
    api
      .images(`?${params.toString()}`)
      .then((r) => setImages(r.items as unknown as Img[]))
      .catch(() => setImages([]));
  }, [classFilter, annotationFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All classes</option>
          {classes?.classes.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          value={annotationFilter}
          onChange={(e) => setAnnotationFilter(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="UNLABELED">Unlabeled</option>
          <option value="NEEDS_REVIEW">Needs review</option>
          <option value="ANNOTATED">Annotated</option>
          <option value="EXPERT_REVIEWED">Expert reviewed</option>
          <option value="APPROVED">Approved</option>
          <option value="UNCERTAIN">Uncertain</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <span className="text-xs text-gray-400 self-center">
          Dev fixtures are excluded automatically. Cut a dataset version in Tools to formalize membership.
        </span>
      </div>

      {images === null ? (
        <p className="text-gray-500">Loading…</p>
      ) : images.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-10 text-center">
          <p className="font-medium text-gray-700">No matching images</p>
          <p className="mt-1 text-sm text-gray-500 max-w-md mx-auto">
            Approved research images will appear here as they complete the
            expert-review workflow in Tools.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-400">{images.length} images</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {images.map((img) => {
              const cls = img.classifications?.[0]?.classKey;
              return (
                <div key={img.id} className="rounded-lg bg-white border border-gray-200 overflow-hidden">
                  <img src={`/api/images/${img.id}/file`} alt={img.filename} className="w-full h-36 object-cover bg-gray-50" />
                  <div className="p-2 text-xs space-y-0.5">
                    <p className="font-medium">{cls ?? "—"}</p>
                    <p className="text-gray-400 truncate">{img.filename}</p>
                    <span className={`inline-block px-1.5 rounded ${
                      img.annotationStatus === "APPROVED"
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-500"
                    }`}>
                      {img.annotationStatus.toLowerCase()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
