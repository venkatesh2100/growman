// One Prisma client for the process. connect() in postgres.js calls initPrisma
// before any handler runs. Model helpers call getPrisma() at query time.

import { PrismaClient } from "@prisma/client";

let prisma = null;

export function initPrisma(connectionString, { logSql = false } = {}) {
  if (prisma) return prisma;
  process.env.DATABASE_URL = connectionString;
  prisma = new PrismaClient({
    datasources: { db: { url: connectionString } },
    log: logSql ? ["query", "warn", "error"] : ["warn", "error"],
  });
  return prisma;
}

export function getPrisma() {
  if (!prisma) throw new Error("database is not connected");
  return prisma;
}

export async function disconnectPrisma() {
  if (!prisma) return;
  await prisma.$disconnect();
  prisma = null;
}
