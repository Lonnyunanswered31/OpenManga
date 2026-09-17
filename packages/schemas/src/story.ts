import { z } from "zod";

const str = z.string().trim();
const optStr = z.string().trim().optional().default("");
const strList = z.array(z.string().trim()).optional().default([]);

export const CharacterRole = z.enum(["protagonist", "antagonist", "supporting", "minor"]);

/** Visual + personality description used for a CharacterVersion. */
export const CharacterBible = z.object({
  genderPresentation: optStr,
  ageRange: optStr,
  height: optStr,
  build: optStr,
  faceShape: optStr,
  skinTone: optStr,
  eyes: optStr,
  eyebrows: optStr,
  nose: optStr,
  mouth: optStr,
  hair: optStr,
  facialHair: optStr,
  distinctiveFeatures: strList,
  wardrobe: optStr,
  accessories: strList,
  weapons: strList,
  props: strList,
  personality: optStr,
  visualMannerisms: optStr,
  defaultExpression: optStr,
  immutableTraits: strList,
  outfitVariants: z
    .array(z.object({ name: str, description: optStr }))
    .optional()
    .default([]),
  summary: optStr,
});
export type CharacterBible = z.infer<typeof CharacterBible>;

export const AnalysisCharacter = z.object({
  key: str.min(1).describe("stable slug used to reference this character inside the analysis"),
  name: str.min(1),
  aliases: strList,
  role: CharacterRole.catch("supporting"),
  bible: CharacterBible,
});

export const LocationDescription = z.object({
  kind: optStr.describe("room, building, street, vehicle interior, landscape..."),
  architecture: optStr,
  layout: optStr,
  palette: optStr,
  lighting: optStr,
  atmosphere: optStr,
  keyFeatures: strList,
  immutableTraits: strList,
  summary: optStr,
});
export type LocationDescription = z.infer<typeof LocationDescription>;

export const PropDescription = z.object({
  kind: optStr,
  material: optStr,
  size: optStr,
  colors: optStr,
  keyFeatures: strList,
  immutableTraits: strList,
  summary: optStr,
});
export type PropDescription = z.infer<typeof PropDescription>;

export const AnalysisLocation = z.object({ key: str.min(1), name: str.min(1), description: LocationDescription });
export const AnalysisProp = z.object({
  key: str.min(1),
  name: str.min(1),
  recurring: z.boolean().optional().default(false),
  description: PropDescription,
});

export const Relationship = z.object({ from: str, to: str, kind: str, notes: optStr });

export const PlotBeat = z.object({
  order: z.coerce.number().int(),
  summary: str,
  characters: strList,
  locationKey: optStr,
});

export const AnalysisChapter = z.object({
  order: z.coerce.number().int(),
  title: str,
  summary: optStr,
  sourceStart: optStr.describe("first ~12 words of the chapter in the source text"),
  beats: strList,
});

export const WorldBible = z.object({
  worldRules: strList,
  factions: z
    .array(z.object({ name: str, description: optStr }))
    .optional()
    .default([]),
  uniforms: strList,
  technology: optStr,
  magicSystem: optStr,
  recurringScenery: strList,
  vehicles: strList,
  notes: optStr,
});

export const StoryAnalysis = z.object({
  title: optStr,
  summary: str,
  genre: optStr,
  subgenre: optStr,
  tone: optStr,
  themes: strList,
  setting: optStr,
  period: optStr,
  pacing: optStr,
  visualMotifs: strList,
  protagonistKey: optStr,
  characters: z.array(AnalysisCharacter).default([]),
  relationships: z.array(Relationship).optional().default([]),
  locations: z.array(AnalysisLocation).optional().default([]),
  props: z.array(AnalysisProp).optional().default([]),
  world: WorldBible.optional().default({
    worldRules: [],
    factions: [],
    uniforms: [],
    technology: "",
    magicSystem: "",
    recurringScenery: [],
    vehicles: [],
    notes: "",
  }),
  plotBeats: z.array(PlotBeat).optional().default([]),
  chapters: z.array(AnalysisChapter).min(1),
});
export type StoryAnalysis = z.infer<typeof StoryAnalysis>;
