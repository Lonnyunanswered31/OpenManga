import { auditEvents, type DbOrTx, errorEvents } from "@openmanga/db";

export async function recordAudit(
  db: DbOrTx,
  e: {
    userId?: string | null;
    projectId?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
    ip?: string | null;
    requestId?: string | null;
  },
) {
  await db.insert(auditEvents).values({
    userId: e.userId ?? null,
    projectId: e.projectId ?? null,
    action: e.action,
    targetType: e.targetType ?? null,
    targetId: e.targetId ?? null,
    metadata: e.metadata ?? {},
    ip: e.ip ?? null,
    requestId: e.requestId ?? null,
  });
}

export async function recordError(
  db: DbOrTx,
  e: {
    source: string;
    code?: string | null;
    message: string;
    requestId?: string | null;
    jobId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await db
    .insert(errorEvents)
    .values({
      source: e.source,
      code: e.code ?? null,
      message: e.message.slice(0, 2000),
      requestId: e.requestId ?? null,
      jobId: e.jobId ?? null,
      metadata: e.metadata ?? {},
    })
    .catch(() => {});
}
