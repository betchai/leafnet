// Authentication endpoints: login (rate-limited), logout, current user.

import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { verifyPassword } from "../auth/passwords.js";
import { createSession, destroySession, SESSION_TTL_MS } from "../auth/sessions.js";
import { AUTH_COOKIE, extractToken, requireAuth } from "../auth/middleware.js";

const prisma = new PrismaClient();
const router = Router();

// Simple in-memory failed-login limiter: 5 failed attempts / minute / IP.
// Successful logins never count toward the budget.
const attempts = new Map<string, { count: number; reset: number }>();
function isLimited(ip: string): boolean {
  const now = Date.now();
  const e = attempts.get(ip);
  if (!e || e.reset < now) return false;
  return e.count >= 5;
}
function noteFailure(ip: string) {
  const now = Date.now();
  const e = attempts.get(ip);
  if (!e || e.reset < now) {
    attempts.set(ip, { count: 1, reset: now + 60_000 });
    return;
  }
  e.count++;
}

function publicUser(u: { id: string; name: string; email: string; role: string; status: string }) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, status: u.status };
}

/**
 * POST /api/auth/login { email, password }
 * Verifies credentials, records lastLoginAt, opens a session and returns the
 * token + user. The token is also set as an HttpOnly cookie so `<img>` and
 * other non-JS requests are authenticated too.
 */
router.post("/login", async (req, res) => {
  const ip = req.ip ?? "unknown";
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !verifyPassword(password, user.passwordHash) || user.status !== "ACTIVE") {
    noteFailure(ip);
    if (isLimited(ip)) {
      return res.status(429).json({ error: "Too many failed login attempts. Please wait a minute." });
    }
    return res.status(401).json({ error: "Invalid email or password." });
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const { token } = await createSession(user.id);

  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
  res.json({ token, user: publicUser(user) });
});

/** POST /api/auth/logout — revoke the current session and clear the cookie. */
router.post("/logout", async (req, res) => {
  const token = extractToken(req);
  if (token) await destroySession(token);
  res.clearCookie(AUTH_COOKIE, { path: "/" });
  res.json({ ok: true });
});

/** GET /api/auth/me — the authenticated user (used to resume sessions). */
router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;