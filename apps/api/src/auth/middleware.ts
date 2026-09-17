// Auth + authorization middleware. Every protected route goes through
// authorize(capability): 401 when unauthenticated, 403 when the authenticated
// role lacks the capability (rules live in src/rbac/permissions.ts).

import type { NextFunction, Request, Response } from "express";
import { resolveSession } from "./sessions.js";
import type { Capability, Role } from "../rbac/permissions.js";
import { CAPABILITY_ROLES } from "../rbac/permissions.js";

export const AUTH_COOKIE = "leaftoken";

/** Read the raw bearer token from the Authorization header or the auth cookie. */
export function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() || null;
  }
  const cookie = req.headers.cookie;
  if (cookie) {
    const m = cookie.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${AUTH_COOKIE}=`));
    if (m) return decodeURIComponent(m.slice(AUTH_COOKIE.length + 1));
  }
  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required. Please log in." });
    return;
  }
  const session = await resolveSession(token);
  if (!session) {
    res.status(401).json({ error: "Session is invalid or expired. Please log in again." });
    return;
  }
  req.user = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: session.user.role as Role,
  };
  next();
}

/** Gate a route by capability. Central role→capability rules are in permissions.ts. */
export function authorize(cap: Capability) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await requireAuth(req, res, async () => {
      const role = req.user?.role as Role;
      if (!role || !CAPABILITY_ROLES[cap].includes(role)) {
        res.status(403).json({
          error: `Access denied: role ${role ?? "none"} is not permitted for ${cap}.`,
        });
        return;
      }
      next();
    });
  };
}

/**
 * Service-to-service guard used by pipeline handoff endpoints (e.g.
 * POST /api/tools/models/register). When SERVICE_TOKEN is configured the
 * caller must present it via `X-Service-Token` (or a Bearer token); when it is
 * unset the endpoint stays open so the existing Python pipeline keeps working
 * in development without changes.
 */
export function requireServiceToken(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.SERVICE_TOKEN;
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      res.status(503).json({ error: "SERVICE_TOKEN not configured." });
      return;
    }
    next();
    return;
  }
  const sent = req.headers["x-service-token"] ?? extractToken(req);
  if (!sent || sent !== expected) {
    res.status(401).json({ error: "Invalid service token." });
    return;
  }
  next();
}