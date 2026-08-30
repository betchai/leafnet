/**
 * Image ingestion service (Phase 3).
 *
 * Pure file/hash/validation layer (`prepareIngest`) is separated from the
 * database layer (`persistIngest`) so it is unit-testable without Postgres.
 * Originals are never overwritten; exact duplicates are flagged, not refused.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const uploadDir = path.resolve(
  process.cwd(),
  process.env.UPLOAD_DIRECTORY ?? "./uploads"
);

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export async function ensureUploadDir(dir = uploadDir): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/** Pure validation + naming. No I/O side effects beyond none. */
export function prepareIngest(params: {
  originalName: string;
  buffer: Buffer;
}) {
  const ext = path.extname(params.originalName).toLowerCase();
  if (![".jpg", ".jpeg", ".png"].includes(ext)) {
    throw Object.assign(new Error(`Unsupported format ${ext}`), {
      code: "UNSUPPORTED_FORMAT",
    });
  }
  // Magic-byte content check: reject corrupt/mislabeled files at ingest
  const b = params.buffer;
  const isJpeg = b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
  const isPng = b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (!isJpeg && !isPng) {
    throw Object.assign(new Error("File content is not a valid JPEG/PNG image"), {
      code: "INVALID_IMAGE_CONTENT",
    });
  }
  // Never overwrite originals: unique stored name per ingest
  const storedName = `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}-${path
    .basename(params.originalName, ext)
    .replace(/[^a-zA-Z0-9_-]/g, "_")}${ext}`;
  return {
    storedName,
    sha256: createHash("sha256").update(params.buffer).digest("hex"),
    sizeBytes: params.buffer.length,
  };
}

/** Pure decision: what workflow state should a new ingest start in? */
export function initialStatus(isExactDuplicate: boolean, isDevFixture: boolean) {
  return isExactDuplicate || isDevFixture ? ("NEEDS_REVIEW" as const) : ("UNLABELED" as const);
}

/** Full ingest including persistence. Used by the API route. */
export async function ingestImage(params: {
  originalName: string;
  buffer: Buffer;
  metadata: Record<string, string | undefined>;
  isDevFixture: boolean;
}, prisma: import("@prisma/client").PrismaClient) {
  await ensureUploadDir();
  const prep = prepareIngest({
    originalName: params.originalName,
    buffer: params.buffer,
  });
  const storedPath = path.join(uploadDir, prep.storedName);
  await writeFile(storedPath, params.buffer);

  const existing = await prisma.image.findFirst({ where: { sha256: prep.sha256 } });
  const isExactDuplicate = Boolean(existing);

  const m = params.metadata;
  const image = await prisma.image.create({
    data: {
      filename: params.originalName,
      storagePath: storedPath,
      sizeBytes: prep.sizeBytes,
      sha256: prep.sha256,
      source: m.source || null,
      sourceType: m.sourceType || null,
      location: m.location || null,
      cultivar: m.cultivar || null,
      leafAge: m.leafAge || null,
      growthStage: m.growthStage || null,
      lightingCondition: m.lightingCondition || null,
      cameraType: m.cameraType || null,
      orientation: m.orientation || null,
      plantId: m.plantId || null,
      leafId: m.leafId || null,
      farmId: m.farmId || null,
      collectionSessionId: m.collectionSessionId || null,
      license: m.license || null,
      notes: m.notes || null,
      capturedAt: m.captureDate ? new Date(m.captureDate) : null,
      isDevFixture: params.isDevFixture,
      annotationStatus: initialStatus(isExactDuplicate, params.isDevFixture),
    },
  });

  if (isExactDuplicate && existing) {
    await prisma.imageRelation
      .create({
        data: {
          imageAId: existing.id,
          imageBId: image.id,
          relationType: "exact_duplicate",
          similarity: 1,
        },
      })
      .catch(() => {});
  }

  return { image, isExactDuplicate, duplicateOf: existing?.id };
}
