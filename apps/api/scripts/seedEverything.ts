// One-shot turnkey seeder — populates a fresh clone's database + uploads from
// the committed dataset and staged model artifacts so the app is fully
// functional without manual uploads:
//   1. demo users            (same accounts as src/seedUsers.ts)
//   2. images                copied from dataset/ + RAW UNEDITED DATA/ and
//                            matched to the locked prepared manifest by sha256
//   3. Dataset v1.0 row      per-class + split counts from the manifest
//   4. ModelVersion rows     metrics from ml/reports/evaluation/* and verdicts
//                            from acceptance.json; writes ml/models/active.json
// Run AFTER  npm run db:migrate:
//   npm run seed:everything --workspace @mulberry/api
// Idempotent — safe to re-run (existing rows/keyed hashes are reused).

import "dotenv/config";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile, readdir, stat, readFile } from "node:fs/promises";
import { PrismaClient, AnnotationStatus, Role, UserStatus } from "@prisma/client";
import { prepareIngest } from "../src/services/ingestion.js";
import { hashPassword } from "../src/auth/passwords.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const uploadDir = resolve(repoRoot, process.env.UPLOAD_DIRECTORY ?? "uploads");

const ACTIVE_MODEL = process.env.ACTIVE_MODEL ?? "v1.0_EXP-1.0-FT";

// Directories scanned for source photos. Defaults to the repo-local folders;
// override with SEED_DATA_DIRS (absolute, comma-separated) when the photos are
// kept outside the git repo.
const SEED_DATA_DIRS = (process.env.SEED_DATA_DIRS ?? "dataset,RAW UNEDITED DATA")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean)
  .map((d) => (d.startsWith("/") ? d : resolve(repoRoot, d)));

const prisma = new PrismaClient();

const DEMO_USERS: Array<{ name: string; email: string; password: string; role: Role }> = [
  { name: "Demo Farmer", email: "farmer.demo@mulberry.local", password: "FarmerDemo2026!", role: "FARMER" },
  { name: "Demo Researcher", email: "researcher.demo@mulberry.local", password: "ResearcherDemo2026!", role: "RESEARCHER" },
  { name: "Demo Expert", email: "expert.demo@mulberry.local", password: "ExpertDemo2026!", role: "EXPERT" },
];

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const h = createHash("sha256");
    const s = createReadStream(filePath);
    s.on("error", reject);
    s.on("data", (c) => h.update(c));
    s.on("end", () => resolvePromise(h.digest("hex")));
  });
}

async function isDir(p: string): Promise<boolean> {
  return !!(await stat(p).catch(() => null))?.isDirectory();
}

async function walkImgs(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkImgs(p)));
    else if (/\.(jpe?g|png)$/i.test(e.name)) out.push(p);
  }
  return out;
}

async function findManifest(): Promise<string> {
  const candidates = await readdir(join(repoRoot, "ml/data/prepared"));
  const m = candidates.find((f) => f.endsWith(".jsonl"));
  if (!m) throw new Error("no prepared manifest found under ml/data/prepared/");
  return join(repoRoot, "ml/data/prepared", m);
}

interface ManifestRow {
  image_id: string;
  path: string;
  source?: string | null;
  source_type?: string | null;
  background_type?: string | null;
  class: string;
  split?: string | null;
  annotation_status?: string | null;
  sha256: string;
  dataset_version?: string | null;
}

async function seedUsers() {
  let created = 0;
  for (const u of DEMO_USERS) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    if (existing) continue;
    await prisma.user.create({
      data: {
        name: u.name,
        email: u.email,
        passwordHash: hashPassword(u.password),
        role: u.role,
        status: UserStatus.ACTIVE,
      },
    });
    created++;
    console.log(`[seed] user created: ${u.email} (${u.role})`);
  }
  console.log(`[seed] users ready (created ${created})`);
}

async function main() {
  await seedUsers();
  await mkdir(uploadDir, { recursive: true });

  const manifestPath = await findManifest();
  const rows = (await readFile(manifestPath, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ManifestRow);
  console.log(`[seed] manifest: ${rows.length} rows (${manifestPath.split("/").pop()})`);

  const rowsByHash = new Map(rows.map((r) => [r.sha256, r]));
  const counts = { perClass: new Map<string, number>(), splits: new Map<string, number>() };
  for (const r of rows) {
    counts.perClass.set(r.class, (counts.perClass.get(r.class) ?? 0) + 1);
    counts.splits.set(r.split ?? "unknown", (counts.splits.get(r.split ?? "unknown") ?? 0) + 1);
  }

  console.log("[seed] indexing source photos by sha256 (this may take a minute)...");
  const sourceByHash = new Map<string, string>();
  for (const dir of SEED_DATA_DIRS) {
    const files = await walkImgs(dir);
    for (const f of files) {
      const h = await sha256File(f);
      if (rowsByHash.has(h) && !sourceByHash.has(h)) sourceByHash.set(h, f);
    }
  }
  console.log(`[seed] matched ${sourceByHash.size} / ${rows.length} manifest rows to source photos`);

  let created = 0;
  const imageIds: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (seen.has(row.sha256)) continue;
    seen.add(row.sha256);

    const existing = await prisma.image.findFirst({ where: { sha256: row.sha256 } });
    if (existing) {
      imageIds.push(existing.id);
      continue;
    }

    const src = sourceByHash.get(row.sha256);
    if (!src) {
      console.warn(`[seed] WARN no source file for sha256 ${row.sha256.slice(0, 12)} (${row.class})`);
      continue;
    }

    const buffer = await readFile(src);
    const prep = prepareIngest({ originalName: src.split("/").pop() ?? "leaf.jpg", buffer });
    await writeFile(join(uploadDir, prep.storedName), buffer);

    const status: AnnotationStatus =
      row.annotation_status === "APPROVED"
        ? AnnotationStatus.APPROVED
        : row.annotation_status === "ANNOTATED"
          ? AnnotationStatus.ANNOTATED
          : AnnotationStatus.UNLABELED;

    const image = await prisma.image.create({
      data: {
        filename: src.split("/").pop() ?? "leaf.jpg",
        storagePath: join(uploadDir, prep.storedName),
        sizeBytes: prep.sizeBytes,
        sha256: prep.sha256,
        source: row.source ?? "raw-2026-09",
        sourceType: row.source_type ?? null,
        backgroundType: row.background_type ?? null,
        annotationStatus: status,
        classifications: { create: { classKey: row.class } },
      },
    });
    imageIds.push(image.id);
    created++;
  }
  console.log(`[seed] images ingested: ${created} created, ${imageIds.length} total in run`);

  const perClass: Record<string, number> = Object.fromEntries(counts.perClass);
  const splitCounts: Record<string, number> = Object.fromEntries(counts.splits);
  const datasetVersion = rows.find((r) => r.dataset_version)?.dataset_version ?? "v1.0";

  let dataset = await prisma.dataset.findUnique({ where: { version: datasetVersion } });
  if (!dataset) {
    dataset = await prisma.dataset.create({
      data: {
        name: `Mulberry leaf dataset ${datasetVersion} (raw, ungrouped)`,
        version: datasetVersion,
        description: "2,000 single-label leaf photos (500/class) locked via prepared manifest.",
        status: "READY",
        totalImages: imageIds.length,
        imagesPerClass: perClass,
        splitCounts,
      },
    });
    console.log(`[seed] dataset created: ${dataset.version}`);
  }
  await prisma.dataset.update({
    where: { id: dataset.id, },
    data: {
      totalImages: imageIds.length,
      imagesPerClass: perClass,
      splitCounts,
      images: { connect: imageIds.map((id) => ({ id })) },
    },
  });
  console.log(`[seed] dataset ${dataset.version}: linked ${imageIds.length} images`);

  const modelRoot = join(repoRoot, "ml/models");
  const dirs = (await readdir(modelRoot)).filter((d) => !d.startsWith("."));
  let registered = 0;
  for (const d of dirs) {
    const metaFile = join(modelRoot, d, "metadata.json");
    if (!(await stat(metaFile).catch(() => null))) continue;

    const meta = JSON.parse(await readFile(metaFile, "utf8"));
    const evalDir = join(repoRoot, "ml/reports/evaluation", d);
    const metricsFile = join(evalDir, "metrics.json");
    const accFile = join(evalDir, "acceptance.json");
    const metrics = (await stat(metricsFile).catch(() => null))
      ? (JSON.parse(await readFile(metricsFile, "utf8")) as any)
      : null;
    const verdict = (await stat(accFile).catch(() => null))
      ? (JSON.parse(await readFile(accFile, "utf8")) as any).verdict
      : null;
    const m = metrics?.metrics ?? {};
    const bestVal = meta.best_val_accuracy ?? null;

    const mv = await prisma.modelVersion.upsert({
      where: { version: d },
      create: {
        version: d,
        architecture: meta.architecture ?? "mobilenet_v2",
        datasetId: dataset!.id,
        artifactPath: `ml/models/${d}/model_best.pt`,
        framework: meta.environment?.pytorch ? `pytorch-${meta.environment.pytorch}` : "pytorch",
        trainingDate: meta.trained_at ? new Date(meta.trained_at) : new Date(),
        accuracy: m.accuracy ?? bestVal ?? null,
        precision: m.macro?.precision ?? null,
        recall: m.macro?.recall ?? null,
        f1Score: m.macro?.f1 ?? null,
        confusionMatrix: metrics?.confusion_matrix ?? null,
        acceptanceVerdict: verdict ?? null,
        lifecycleStatus: verdict === "PASS" ? "approved" : "candidate",
        isActive: d === ACTIVE_MODEL,
        notes: meta.notes ?? `seeded from staged artifact + ${evalDir.split("/").pop()} evaluation`,
      },
      update: {
        isActive: d === ACTIVE_MODEL,
      },
    });
    registered++;
    console.log(`[seed] model ${mv.version}: verdict=${verdict ?? "n/a"} active=${d === ACTIVE_MODEL}`);
  }

  if (await stat(join(modelRoot, ACTIVE_MODEL, "model_best.pt")).catch(() => null)) {
    await writeFile(
      join(modelRoot, "active.json"),
      JSON.stringify({ model_version: ACTIVE_MODEL }, null, 2) + "\n"
    );
    console.log(`[seed] wrote ml/models/active.json -> ${ACTIVE_MODEL}`);
  } else {
    console.warn(`[seed] WARN active model ${ACTIVE_MODEL} has no model_best.pt; active.json not written`);
  }

  console.log(`[seed] DONE — ${imageIds.length} images, dataset ${dataset?.version}, ${registered} models registered.`);
}

main()
  .catch((e) => {
    console.error("[seed] failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());