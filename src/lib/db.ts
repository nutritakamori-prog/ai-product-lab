import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";

// Prisma 7 requires an explicit driver adapter — there is no more implicit
// connection from just a datasource URL. See docs/DECISIONS.md.
function createClient() {
  const pool = new Pool({ connectionString: getEnv().DATABASE_URL });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

// Standard Next.js pattern: reuse one PrismaClient across hot reloads in dev,
// so `next dev` doesn't open a fresh connection pool on every file save.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
