import { type DbOrTx, sql } from "@openmanga/db";
import type { ProjectSettings } from "@openmanga/schemas";

export type PauseSettings = Pick<ProjectSettings, "narrationPauseMs" | "sceneBreakPauseMs">;

/**
 * Sets every narration segment's pause to the project's narration pause, and the last segment of each scene (and of
 * the chapter) to the longer scene-break pause. With one narration line per panel every line used to be its own
 * paragraph and got a 700 ms pause, which put ~9% silence into a film. Pauses are applied at compose time, so this
 * never touches synthesized audio.
 */
export async function applyNarrationPauses(
  db: DbOrTx,
  chapterId: string,
  language: string,
  settings: Partial<PauseSettings>,
) {
  const pause = settings.narrationPauseMs ?? 350;
  const sceneBreak = settings.sceneBreakPauseMs ?? 700;
  const rows = await db.execute<{ id: string }>(sql`
    with l as (
      select nl.id, nl."order", coalesce(pn.scene_id, pg.scene_id, lpg.scene_id) as scene_id
      from narration_lines nl
      left join panels pn on pn.id = nl.panel_id
      left join pages pg on pg.id = pn.page_id
      left join pages lpg on lpg.id = nl.page_id
      where nl.chapter_id = ${chapterId} and nl.language = ${language}
    ),
    ends as (
      select id from (
        select id, scene_id, lead(id) over w as next_id, lead(scene_id) over w as next_scene
        from l window w as (order by "order")
      ) x
      where next_id is null or next_scene is distinct from scene_id
    ),
    last_seg as (
      select distinct on (narration_line_id) id from narration_segments
      where narration_line_id in (select id from l)
      order by narration_line_id, "order" desc
    )
    update narration_segments s
    set pause_after_ms = case
      when s.id in (select id from last_seg) and s.narration_line_id in (select id from ends) then ${sceneBreak}::int
      else ${pause}::int end
    where s.narration_line_id in (select id from l)
    returning s.id`);
  return [...rows].length;
}
