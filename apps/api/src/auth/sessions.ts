// Session persistence: create / resolve / destroy bearer sessions.
// Stores only the SHA-256 hash of the token (see tokens.ts).

import { PrismaClient } from "@prisma/client";
import { hashToken, newRawToken } from "./tokens.js";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const prisma = new PrismaClient();

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: "FARMER" | "RESEARCHER" | "EXPERT";
  status: string;
}

export async function createSession(userId: string): Promise<{ token: string }> {
  const token = newRawToken();
  await prisma.userSession.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return { token };
}

/**
 * Resolve a raw bearer token to an ACTIVE user. Returns null when the token
 * is unknown, expired, or the account is DISABLED.
 */
export async function resolveSession(
  rawToken: string
): Promise<{ user: PublicUser; sessionId: string } | null> {
  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.userSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (session.user.status !== "ACTIVE") return null;

  // Throttle lastUsedAt writes to at most once per hour per session.
  const stale = !session.lastUsedAt || Date.now() - session.lastUsedAt.getTime() > 60 * 60 * 1000;
  if (stale) {
    await prisma.userSession
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role as PublicUser["role"],
      status: session.user.status,
    },
    sessionId: session.id,
  };
}

export async function destroySession(rawToken: string): Promise<void> {
  if (!rawToken) return;
  await prisma.userSession.delete({ where: { tokenHash: hashToken(rawToken) } }).catch(() => {});
}