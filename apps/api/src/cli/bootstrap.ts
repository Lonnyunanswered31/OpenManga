/** Container start-up task: apply migrations, then sync reference data (idempotent). */
import { mkdir } from "node:fs/promises";
import { getConfig } from "@openmanga/config";
import { createDb } from "@openmanga/db";
import { runMigrations } from "@openmanga/db/migrate";
import { createLogger } from "@openmanga/logger";
import { bootstrapReferenceData, KeyRing, rotateCredentials } from "@openmanga/services";

const config = getConfig();
const logger = createLogger({ service: "bootstrap" }, config.LOG_LEVEL);

for (let attempt = 1; ; attempt++) {
  try {
    await runMigrations(config.DATABASE_URL);
    break;
  } catch (e) {
    if (attempt >= 10) throw e;
    logger.warn("migration attempt failed, retrying", { attempt, error: e instanceof Error ? e.message : String(e) });
    await Bun.sleep(2000);
  }
}
logger.info("migrations applied");

const { db, client } = createDb(config.DATABASE_URL, { max: 2 });
await bootstrapReferenceData(db, config, logger);
// Re-encrypt saved API keys onto the primary key after a rotation (no-op when already current).
await rotateCredentials(db, new KeyRing(config), { logger });
await mkdir(config.ASSET_ROOT, { recursive: true }).catch(() => {});
await client.end();
logger.info("bootstrap complete");
