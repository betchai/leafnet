// Session token utilities: opaque random tokens; only SHA-256 hashes are
// persisted so a leaked database can never replay a session.

import { createHash, randomBytes } from "node:crypto";

export function newRawToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}