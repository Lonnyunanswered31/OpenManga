import { aiUsage, type Database, eq, projects, sql } from "@openmanga/db";

export type BudgetStatus = {
  limitUsd: number | null;
  spentUsd: number;
  remainingUsd: number | null;
  exceeded: boolean;
  /** Billable calls made against a model nobody has priced: real spend that `spentUsd` cannot see. */
  unpricedCalls: number;
};

/**
 * An ai_usage row whose cost could not be computed: no rate snapshot, but real billable quantity. Its
 * estimated_cost_usd is 0, so every total built from that column is a floor. Local synthesis really is free
 * (metadata.local) and is not counted. Unqualified so it can be dropped into any single-table ai_usage query.
 */
export const UNPRICED_USAGE = sql`rate_snapshot_id is null and metadata->>'local' is distinct from 'true'
  and text_input_tokens + text_output_tokens + image_input_tokens + image_output_tokens + images + characters > 0`;

/** Project spend from recorded usage against the project's optional budget cap. */
export async function projectBudget(db: Database, projectId: string): Promise<BudgetStatus> {
  const [row] = await db
    .select({
      settings: projects.settings,
      spent: sql<string>`(select coalesce(sum(${aiUsage.estimatedCostUsd}), 0) from ${aiUsage} where ${aiUsage.projectId} = ${projectId})`,
      unpriced: sql<number>`(select count(*)::int from ${aiUsage} where ${aiUsage.projectId} = ${projectId} and ${UNPRICED_USAGE})`,
    })
    .from(projects)
    .where(eq(projects.id, projectId));
  const spentUsd = Number(row?.spent ?? 0);
  const limit = row?.settings.budgetUsd;
  const limitUsd = typeof limit === "number" ? limit : null;
  return {
    limitUsd,
    spentUsd,
    remainingUsd: limitUsd === null ? null : Math.max(0, limitUsd - spentUsd),
    exceeded: limitUsd !== null && spentUsd >= limitUsd,
    unpricedCalls: row?.unpriced ?? 0,
  };
}
