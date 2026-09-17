import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  and,
  assets,
  assetVariants,
  audioJobs,
  eq,
  exportJobs,
  exportsTable,
  generationJobs,
  inArray,
  lt,
  or,
  passwordResetTokens,
  sessions,
  sql,
} from "@openmanga/db";
import { KeyRing, rotateCredentials } from "@openmanga/services";
import type { WorkerDeps } from "../context.ts";

/** Periodic cleanup. Only disposable data is removed; canonical assets and version history are kept. */
export async function runMaintenance(deps: WorkerDeps) {
  const now = new Date();
  const log = deps.logger.child({ task: "maintenance" });
  const result: Record<string, number> = {};

  result.expiredSessions = (
    await deps.db
      .delete(sessions)
      .where(or(lt(sessions.expiresAt, now), lt(sessions.revokedAt, new Date(now.getTime() - 7 * 86400_000))))
      .returning({ id: sessions.id })
  ).length;
  result.expiredResetTokens = (
    await deps.db
      .delete(passwordResetTokens)
      .where(
        or(
          lt(passwordResetTokens.expiresAt, new Date(now.getTime() - 86400_000)),
          sql`${passwordResetTokens.usedAt} is not null`,
        ),
      )
      .returning({ id: passwordResetTokens.id })
  ).length;

  // Prompt-reference derivatives are reproducible: drop ones unused for 30 days.
  const staleVariants = await deps.db
    .select()
    .from(assetVariants)
    .where(
      and(
        eq(assetVariants.variant, "prompt_ref"),
        lt(assetVariants.lastUsedAt, new Date(now.getTime() - 30 * 86400_000)),
      ),
    )
    .limit(1000);
  for (const v of staleVariants) await deps.assets.storage.delete(v.storageKey).catch(() => {});
  if (staleVariants.length)
    await deps.db.delete(assetVariants).where(
      inArray(
        assetVariants.id,
        staleVariants.map((v) => v.id),
      ),
    );
  result.promptDerivativesRemoved = staleVariants.length;

  // Expired export files (the export job record stays for history).
  const expired = await deps.db
    .select({ e: exportsTable, a: assets })
    .from(exportsTable)
    .innerJoin(assets, eq(assets.id, exportsTable.assetId))
    .where(lt(exportsTable.expiresAt, now))
    .limit(500);
  for (const { a } of expired) await deps.assets.hardDelete(a);
  result.expiredExports = expired.length;

  // Trashed assets older than 30 days (never locked / never active artwork).
  const trashed = await deps.db
    .select()
    .from(assets)
    .where(
      and(
        lt(assets.deletedAt, new Date(now.getTime() - 30 * 86400_000)),
        sql`${assets.status} <> 'locked'`,
        sql`not exists (select 1 from panels p where p.active_artwork_asset_id = ${assets.id})`,
      ),
    )
    .limit(500);
  for (const a of trashed) await deps.assets.hardDelete(a);
  result.trashedAssetsPurged = trashed.length;

  // Temp files older than 6h (failed/abandoned processing).
  result.tempEntriesRemoved = 0;
  try {
    for (const name of await readdir(deps.config.TEMP_ROOT)) {
      const p = join(deps.config.TEMP_ROOT, name);
      const s = await stat(p).catch(() => null);
      if (s && now.getTime() - s.mtimeMs > 6 * 3600_000) {
        await rm(p, { recursive: true, force: true });
        result.tempEntriesRemoved++;
      }
    }
  } catch {}

  // Jobs stuck in processing for >2h (worker crash) become failed so the UI and retries work.
  const stuck = await deps.db
    .update(generationJobs)
    .set({
      status: "failed",
      failureCode: "stalled",
      failureReason: "The worker stopped while processing this job. Retry it.",
      finishedAt: now,
    })
    .where(
      and(
        eq(generationJobs.status, "processing"),
        lt(generationJobs.startedAt, new Date(now.getTime() - 2 * 3600_000)),
      ),
    )
    .returning({ id: generationJobs.id });
  result.stalledJobs = stuck.length;
  await deps.db
    .update(audioJobs)
    .set({
      status: "failed",
      failureCode: "stalled",
      failureReason: "Worker stopped during synthesis",
      finishedAt: now,
    })
    .where(and(eq(audioJobs.status, "processing"), lt(audioJobs.startedAt, new Date(now.getTime() - 2 * 3600_000))));
  await deps.db
    .update(exportJobs)
    .set({ status: "failed", failureReason: "Worker stopped during export", finishedAt: now })
    .where(and(eq(exportJobs.status, "processing"), lt(exportJobs.startedAt, new Date(now.getTime() - 2 * 3600_000))));

  await deps.db.execute(
    sql`delete from outbox where status = 'published' and published_at < now() - interval '7 days'`,
  );
  const rot = await rotateCredentials(deps.db, new KeyRing(deps.config), { logger: log });
  result.credentialsRotated = rot.rotated;
  result.credentialRotationFailures = rot.failed;
  log.info("maintenance complete", result);
  return result;
}
