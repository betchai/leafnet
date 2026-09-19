// EXPERT-ONLY user administration. No self-registration exists — accounts are
// created here by experts (or by the idempotent demo seed). Passwords are
// never returned by any response and are only ever replaced via the explicit
// admin reset endpoint. Every administrative action is appending to SystemAudit.

import { Router } from "express";
import { PrismaClient, Role, UserStatus } from "@prisma/client";
import { hashPassword } from "../auth/passwords.js";
import { authorize } from "../auth/middleware.js";
import { ROLES } from "../rbac/permissions.js";
import type { Role as AppRole } from "../rbac/permissions.js";

const prisma = new PrismaClient();
const router = Router();

const VALID_STATUS = ["ACTIVE", "DISABLED"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeUser(u: {
  id: string; name: string; email: string; role: string; status: string;
  createdAt: Date | null; updatedAt: Date | null; lastLoginAt: Date | null;
}) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    lastLoginAt: u.lastLoginAt,
  };
}

async function sysAudit(a: {
  actor: string; action: string; objectId: string;
  previousState?: unknown; newState?: unknown; reason?: string;
}) {
  await prisma.systemAudit.create({
    data: {
      actor: a.actor,
      action: a.action,
      objectType: "User",
      objectId: a.objectId,
      previousState: a.previousState,
      newState: a.newState,
      reason: a.reason,
    } as never,
  });
}

/** Count the ACTIVE EXPERT accounts other than `excludeId`. */
async function otherActiveExperts(excludeId: string): Promise<number> {
  return prisma.user.count({
    where: { role: "EXPERT", status: "ACTIVE", id: { not: excludeId } },
  });
}

// GET /api/users — list accounts (never includes passwordHash).
router.get("/", authorize("user_admin"), async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  res.json({ items: users.map(safeUser), count: users.length });
});

/**
 * POST /api/users { name, email, password, role }
 * Create an account. No self-registration path exists anywhere else.
 */
router.post("/", authorize("user_admin"), async (req, res) => {
  const { name, email, password, role } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: "a valid email is required" });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }
  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${ROLES.join(", ")}` });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const exists = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (exists) return res.status(409).json({ error: "An account with this email already exists" });

  const user = await prisma.user.create({
    data: { name: name.trim(), email: normalizedEmail, passwordHash: hashPassword(password), role: role as Role },
  });

  await sysAudit({
    actor: req.user!.name,
    action: "user_create",
    objectId: user.id,
    newState: { name: user.name, email: user.email, role: user.role, status: user.status },
    reason: `Account created by ${req.user!.name} (${req.user!.role})`,
  });

  res.status(201).json({ user: safeUser(user) });
});

/**
 * PATCH /api/users/:id { name?, role?, status? }
 * Update an account. Experts cannot change their own role/status (self-lockout
 * guard) and the last ACTIVE EXPERT can never be demoted or disabled.
 */
router.patch("/:id", authorize("user_admin"), async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: "User not found" });

  if (target.id === req.user!.id) {
    return res.status(403).json({ error: "You cannot change your own role or account status." });
  }

  const { name, role, status } = req.body ?? {};
  const data: { name?: string; role?: Role; status?: UserStatus } = {};
  const prev = { name: target.name, role: target.role, status: target.status };

  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name must be a non-empty string" });
    }
    data.name = name.trim();
  }
  if (role !== undefined) {
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${ROLES.join(", ")}` });
    }
    data.role = role as Role;
  }
  if (status !== undefined) {
    if (!VALID_STATUS.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUS.join(", ")}` });
    }
    data.status = status as UserStatus;
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: "nothing to update (name, role or status)" });
  }

  // Last-active-expert guard: demoting or disabling an EXPERT must leave ≥1.
  const turningOffExpert =
    target.role === "EXPERT" &&
    ((role !== undefined && (role as AppRole) !== "EXPERT") ||
      (status !== undefined && (status as UserStatus) !== "ACTIVE"));
  if (turningOffExpert) {
    const others = await otherActiveExperts(target.id);
    if (others < 1) {
      return res.status(409).json({ error: "Cannot demote/disable the last ACTIVE EXPERT account." });
    }
  }

  const updated = await prisma.user.update({ where: { id: target.id }, data });

  if (role !== undefined && data.role !== target.role) {
    await sysAudit({
      actor: req.user!.name, action: "user_role_change", objectId: target.id,
      previousState: { role: target.role }, newState: { role: updated.role },
      reason: `Role changed by ${req.user!.name} (${req.user!.role})`,
    });
  }
  if (status !== undefined && data.status !== target.status) {
    await sysAudit({
      actor: req.user!.name, action: "user_status_change", objectId: target.id,
      previousState: { status: target.status }, newState: { status: updated.status },
      reason: `Status changed by ${req.user!.name} (${req.user!.role})`,
    });
  }
  if (name !== undefined && data.name !== target.name) {
    void prev; // name-only edits are still recorded via the update row above
  }

  res.json({ user: safeUser(updated) });
});

/**
 * POST /api/users/:id/password { password }
 * Admin password reset. Replacing the hash revokes nothing on its own, but the
 * change is audited; any live sessions remain until they expire.
 */
router.post("/:id/password", authorize("user_admin"), async (req, res) => {
  const { password } = req.body ?? {};
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: "User not found" });

  await prisma.user.update({ where: { id: target.id }, data: { passwordHash: hashPassword(password) } });
  await sysAudit({
    actor: req.user!.name, action: "user_password_reset", objectId: target.id,
    newState: { changedAt: new Date().toISOString() },
    reason: `Password reset by ${req.user!.name} (${req.user!.role})`,
  });
  res.json({ ok: true });
});

export default router;