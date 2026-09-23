import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

interface RecordAuditLogInput {
  organizationId: string;
  userId?: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}

export async function recordAuditLog(input: RecordAuditLogInput) {
  return db.auditLog.create({ data: input });
}

export async function listAuditLogs(organizationId: string, take = 20) {
  return db.auditLog.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take,
  });
}
