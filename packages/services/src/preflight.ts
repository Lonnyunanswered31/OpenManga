import {
  asc,
  characterOutfits,
  characters,
  characterVersions,
  type Database,
  eq,
  inArray,
  pages,
  panels,
  referenceAssets,
  sql,
} from "@openmanga/db";
import { lintCharacter, lintText, panelDistressRisk } from "@openmanga/domain";
import type { PanelSpec } from "@openmanga/schemas";
import { isStale, versionFingerprints } from "./staleness.ts";

export type PreflightPanel = {
  panelId: string;
  pageOrder: number;
  panelOrder: number;
  /** Harm words in this panel's own spec/prompt text. */
  terms: string[];
  /** Characters whose prompt-visible description carries harm words. */
  characters: string[];
  distress: string[];
  staleReferences: string[];
  missingReferences: string[];
};

export type Preflight = {
  panels: number;
  harmVocabulary: { panels: number; terms: { term: string; panels: number }[] };
  characterWarnings: { characterId: string; name: string; versionNumber: number; panels: number; terms: string[] }[];
  distress: { panels: number };
  staleReferences: { characterId: string; name: string; versionNumber: number; panels: number }[];
  missingReferences: { characterId: string; name: string; versionNumber: number; panels: number }[];
  items: PreflightPanel[];
};

const MAX_ITEMS = 300;

/**
 * Everything that makes image moderators block panels is detectable before a request is sent: harm vocabulary in
 * character bibles or panel text, the lone-figure-underlit-distressed combination, and references that no longer
 * match (or are missing for) the character version a panel uses. Report it so one edit replaces a repair loop.
 */
export async function generationPreflight(db: Database, panelIds: string[]): Promise<Preflight> {
  const empty: Preflight = {
    panels: 0,
    harmVocabulary: { panels: 0, terms: [] },
    characterWarnings: [],
    distress: { panels: 0 },
    staleReferences: [],
    missingReferences: [],
    items: [],
  };
  if (!panelIds.length) return empty;
  const rows = await db
    .select({ p: panels, pageOrder: pages.order })
    .from(panels)
    .innerJoin(pages, eq(pages.id, panels.pageId))
    .where(inArray(panels.id, panelIds))
    .orderBy(asc(pages.order), asc(panels.order));
  const specs = await db.execute<{ panel_id: string; spec: PanelSpec }>(
    sql`select distinct on (panel_id) panel_id, spec from panel_specs where panel_id in (${sql.join(
      rows.map((r) => sql`${r.p.id}`),
      sql`, `,
    )}) order by panel_id, version_number desc`,
  );
  const specOf = new Map([...specs].map((s) => [s.panel_id, s.spec]));

  const versionIds = [...new Set(rows.flatMap((r) => r.p.characterVersionIds))];
  const versions = versionIds.length
    ? await db
        .select({ v: characterVersions, name: characters.name })
        .from(characterVersions)
        .innerJoin(characters, eq(characters.id, characterVersions.characterId))
        .where(inArray(characterVersions.id, versionIds))
    : [];
  const outfits = versions.length
    ? await db
        .select()
        .from(characterOutfits)
        .where(
          inArray(
            characterOutfits.characterId,
            versions.map((v) => v.v.characterId),
          ),
        )
    : [];
  const refs = versionIds.length
    ? await db.select().from(referenceAssets).where(inArray(referenceAssets.characterVersionId, versionIds))
    : [];
  const fingerprints = await versionFingerprints(db, "character", versionIds);

  const byVersion = new Map(
    versions.map(({ v, name }) => {
      const lint = lintCharacter(
        v.description,
        v.immutableTraits,
        outfits.filter(
          (o) => o.characterId === v.characterId && (!o.characterVersionId || o.characterVersionId === v.id),
        ),
      );
      const approved = refs.filter(
        (r) => r.characterVersionId === v.id && (r.status === "approved" || r.status === "locked"),
      );
      const fresh = approved.filter((r) => !isStale(r, fingerprints.get(v.id)));
      return [
        v.id,
        {
          characterId: v.characterId,
          name,
          versionNumber: v.versionNumber,
          terms: [...new Set(lint.map((l) => l.term))],
          stale: approved.length > 0 && fresh.length === 0,
          missing: approved.length === 0,
        },
      ] as [
        string,
        { characterId: string; name: string; versionNumber: number; terms: string[]; stale: boolean; missing: boolean },
      ];
    }),
  );

  const termPanels = new Map<string, number>();
  const tally = new Map<string, { panels: number }>();
  const bump = (key: string) => tally.set(key, { panels: (tally.get(key)?.panels ?? 0) + 1 });
  const items: PreflightPanel[] = [];
  let harmPanels = 0;
  let distressPanels = 0;

  for (const { p, pageOrder } of rows) {
    const spec = specOf.get(p.id);
    const draft = (p.promptDraft ?? {}) as Record<string, unknown>;
    const texts = [
      p.storyBeat,
      p.promptOverride,
      spec?.beat,
      spec?.action,
      spec?.emotion,
      spec?.lighting,
      spec?.composition,
      spec?.foreground,
      spec?.midground,
      spec?.background,
      ...(spec?.continuityRequirements ?? []),
      ...(spec?.characters ?? []).flatMap((c) => [c.action, c.pose, c.expression, c.outfit]),
      ...["intent", "action", "expression", "composition", "lighting"].map((k) =>
        typeof draft[k] === "string" ? (draft[k] as string) : "",
      ),
    ];
    const terms = [...new Set(texts.flatMap((t) => lintText(t).map((m) => m.term)))];
    const used = p.characterVersionIds.map((id) => byVersion.get(id)).filter((v) => v !== undefined);
    const charTerms = used.filter((v) => v.terms.length);
    const distress = panelDistressRisk({
      lighting: (typeof draft.lighting === "string" && draft.lighting) || spec?.lighting,
      emotion: spec?.emotion,
      cameraAngle: p.cameraAngle ?? spec?.cameraAngle,
      characterCount: p.characterVersionIds.length,
    });
    const allTerms = new Set([...terms, ...charTerms.flatMap((v) => v.terms)]);
    for (const t of allTerms) termPanels.set(t, (termPanels.get(t) ?? 0) + 1);
    if (allTerms.size) harmPanels++;
    if (distress.length) distressPanels++;
    for (const id of new Set(p.characterVersionIds)) {
      const v = byVersion.get(id);
      if (v?.terms.length) bump(`warn:${id}`);
      if (v?.stale) bump(`stale:${id}`);
      if (v?.missing) bump(`missing:${id}`);
    }
    const item: PreflightPanel = {
      panelId: p.id,
      pageOrder,
      panelOrder: p.order,
      terms,
      characters: charTerms.map((v) => v.name),
      distress,
      staleReferences: used.filter((v) => v.stale).map((v) => v.name),
      missingReferences: used.filter((v) => v.missing).map((v) => v.name),
    };
    if (
      items.length < MAX_ITEMS &&
      (item.terms.length ||
        item.characters.length ||
        item.distress.length ||
        item.staleReferences.length ||
        item.missingReferences.length)
    )
      items.push(item);
  }

  const summarize = (prefix: string) =>
    [...tally.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, t]) => {
        const v = byVersion.get(k.slice(prefix.length))!;
        return {
          characterId: v.characterId,
          name: v.name,
          versionNumber: v.versionNumber,
          panels: t.panels,
          terms: v.terms,
        };
      })
      .sort((a, b) => b.panels - a.panels);

  return {
    panels: rows.length,
    harmVocabulary: {
      panels: harmPanels,
      terms: [...termPanels.entries()].map(([term, n]) => ({ term, panels: n })).sort((a, b) => b.panels - a.panels),
    },
    characterWarnings: summarize("warn:"),
    distress: { panels: distressPanels },
    staleReferences: summarize("stale:").map(({ terms: _t, ...r }) => r),
    missingReferences: summarize("missing:").map(({ terms: _t, ...r }) => r),
    items,
  };
}
