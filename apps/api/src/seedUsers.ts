// Idempotent demo-user seeder. Run:  cd apps/api && npx tsx src/seedUsers.ts
// Creates the three fixed demo accounts (FARMER / RESEARCHER / EXPERT).
// Passwords are set ONLY on creation by default — re-running never resets an
// existing password. To force a reset to the documented demo credentials
// (e.g. after they were changed through the Users UI), run:
//   RESET_DEMO_PASSWORDS=1 npx tsx src/seedUsers.ts
// Existing accounts are otherwise only normalized for name/role/status.

import "dotenv/config";
import { PrismaClient, Role, UserStatus } from "@prisma/client";
import { hashPassword } from "./auth/passwords.js";

const prisma = new PrismaClient();

const DEMO_USERS: Array<{
  name: string;
  email: string;
  password: string;
  role: Role;
}> = [
  { name: "Demo Farmer", email: "farmer.demo@mulberry.local", password: "FarmerDemo2026!", role: "FARMER" },
  { name: "Demo Researcher", email: "researcher.demo@mulberry.local", password: "ResearcherDemo2026!", role: "RESEARCHER" },
  { name: "Demo Expert", email: "expert.demo@mulberry.local", password: "ExpertDemo2026!", role: "EXPERT" },
];

const RESET = process.env.RESET_DEMO_PASSWORDS === "1";

async function main() {
  let created = 0;
  let existed = 0;
  for (const u of DEMO_USERS) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          name: u.name,
          role: u.role,
          status: UserStatus.ACTIVE,
          ...(RESET ? { passwordHash: hashPassword(u.password) } : {}),
        },
      });
      existed++;
      console.log(
        RESET
          ? `[seed] password reset: ${u.email}`
          : `[seed] exists (unchanged password): ${u.email}`
      );
    } else {
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
      console.log(`[seed] created: ${u.email} (${u.role})`);
    }
  }
  console.log(`[seed] done — created ${created}, already present ${existed}${RESET ? " (passwords reset)" : ""}.`);
}

main()
  .catch((e) => {
    console.error("[seed] failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());