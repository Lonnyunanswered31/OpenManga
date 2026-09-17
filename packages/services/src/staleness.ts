import { characterVersions, type Database, type DbOrTx, inArray, locationVersions, propVersions } from "@openmanga/db";
import { hashOf, promptVisibleCharacter } from "@openmanga/domain";

export type ReferenceSubject = "character" | "location" | "prop" | "style";

export const characterFingerprint = (v: {
  description: Parameters<typeof promptVisibleCharacter>[0];
  immutableTraits: string[];
}) => hashOf(promptVisibleCharacter(v.description, v.immutableTraits));

const descriptionFingerprint = (description: unknown) => hashOf(description ?? {});

/**
 * Current fingerprints of subject versions' prompt-visible descriptions. A reference whose stored fingerprint
 * differs was made from an older description and silently undermines any bible fix until regenerated.
 * Styles are not fingerprinted (their references are the style itself).
 */
export async function versionFingerprints(
  db: Database | DbOrTx,
  subject: ReferenceSubject,
  versionIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(versionIds)];
  if (!ids.length || subject === "style") return new Map();
  if (subject === "character") {
    const rows = await db.select().from(characterVersions).where(inArray(characterVersions.id, ids));
    return new Map(rows.map((r) => [r.id, characterFingerprint(r)]));
  }
  const table = subject === "location" ? locationVersions : propVersions;
  const rows = await db
    .select({ id: table.id, description: table.description })
    .from(table)
    .where(inArray(table.id, ids));
  return new Map(rows.map((r) => [r.id, descriptionFingerprint(r.description)]));
}

export async function versionFingerprint(db: Database | DbOrTx, subject: ReferenceSubject, versionId: string) {
  return (await versionFingerprints(db, subject, [versionId])).get(versionId) ?? null;
}

export const isStale = (ref: { sourceFingerprint: string | null }, current: string | undefined) =>
  Boolean(ref.sourceFingerprint && current && ref.sourceFingerprint !== current);
