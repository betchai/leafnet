import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  prepareIngest,
  initialStatus,
  sha256File,
} from "./ingestion.js";

// Pure-layer tests: no database involved. DB-backed paths are exercised
// against the running API (see PHASE_3_STATUS.md).

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "leafnet-test-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("checksum generation", () => {
  it("produces identical sha256 for identical content", async () => {
    const p = path.join(dir, "a.jpg");
    await writeFile(p, Buffer.from("identical-bytes"));
    const p2 = path.join(dir, "b.jpg");
    await writeFile(p2, Buffer.from("identical-bytes"));
    expect(await sha256File(p2)).toBe(await sha256File(p));
    expect(await sha256File(p)).toBe(
      createHash("sha256").update("identical-bytes").digest("hex")
    );
  });
});

describe("ingest preparation", () => {
  it("rejects unsupported formats before any persistence", () => {
    expect(() =>
      prepareIngest({ originalName: "x.gif", buffer: Buffer.from("gif") })
    ).toThrowError(/Unsupported format/);
    try {
      prepareIngest({ originalName: "x.bmp", buffer: Buffer.from("bmp") });
      expect.unreachable();
    } catch (e) {
      expect((e as { code?: string }).code).toBe("UNSUPPORTED_FORMAT");
    }
  });

  it("accepts jpg/jpeg/png with valid image bytes", () => {
    const jpegBytes = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from("payload")]);
    for (const name of ["a.jpg", "a.jpeg", "a.PNG"]) {
      expect(() => prepareIngest({ originalName: name, buffer: jpegBytes })).not.toThrow();
    }
  });

  it("generates unique stored names so originals are never overwritten", () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from("same")]);
    const a = prepareIngest({ originalName: "leaf_photo.jpg", buffer: jpeg });
    const b = prepareIngest({ originalName: "leaf_photo.jpg", buffer: jpeg });
    expect(a.storedName).not.toBe(b.storedName);
    expect(a.sha256).toBe(b.sha256); // same content -> same hash -> duplicate flag
    // filename sanitized of path traversal / odd characters
    expect(a.storedName).toMatch(/^[0-9a-z_-]+\.jpg$/i);
  });

  it("flags exact duplicates and dev fixtures into NEEDS_REVIEW", () => {
    expect(initialStatus(true, false)).toBe("NEEDS_REVIEW");
    expect(initialStatus(false, true)).toBe("NEEDS_REVIEW");
    expect(initialStatus(false, false)).toBe("UNLABELED");
  });
});
