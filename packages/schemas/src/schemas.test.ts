import { describe, expect, test } from "bun:test";
import {
  Bubble,
  ChapterPlan,
  countWords,
  narrationDraftFor,
  PanelSpec,
  ProjectSettings,
  StoryAnalysis,
} from "./index.ts";

describe("story schema validation", () => {
  const minimal = {
    summary: "s",
    chapters: [{ order: 1, title: "One" }],
    characters: [{ key: "a", name: "A", bible: {} }],
  };

  test("fills defaults and coerces", () => {
    const r = StoryAnalysis.parse(minimal);
    expect(r.characters[0]!.role).toBe("supporting");
    expect(r.characters[0]!.bible.immutableTraits).toEqual([]);
    expect(r.world.worldRules).toEqual([]);
    expect(StoryAnalysis.parse({ ...minimal, chapters: [{ order: "2", title: "Two" }] }).chapters[0]!.order).toBe(2);
  });

  test("unknown enum values degrade gracefully, missing required fields fail", () => {
    const r = StoryAnalysis.parse({
      ...minimal,
      characters: [{ key: "a", name: "A", role: "villain-ish", bible: {} }],
    });
    expect(r.characters[0]!.role).toBe("supporting");
    expect(StoryAnalysis.safeParse({ summary: "x", chapters: [] }).success).toBe(false);
    expect(StoryAnalysis.safeParse({ chapters: [{ order: 1, title: "t" }] }).success).toBe(false);
    expect(StoryAnalysis.safeParse({ ...minimal, characters: [{ name: "no key", bible: {} }] }).success).toBe(false);
  });

  test("panel specs catch bad camera data", () => {
    const s = PanelSpec.parse({ beat: "b", shotType: "drone", cameraAngle: "weird" });
    expect(s.shotType).toBe("medium");
    expect(s.cameraAngle).toBe("eye-level");
    expect(PanelSpec.safeParse({ shotType: "wide" }).success).toBe(false);
  });

  test("chapter plan requires scenes with pages with 1-5 panels", () => {
    const panel = { spec: { beat: "b" } };
    const scene = { title: "S", pages: [{ panels: [panel] }] };
    expect(ChapterPlan.safeParse({ scenes: [scene] }).success).toBe(true);
    expect(ChapterPlan.safeParse({ scenes: [{ title: "S", pages: [] }] }).success).toBe(false);
    expect(ChapterPlan.safeParse({ scenes: [{ title: "S", pages: [{ panels: Array(6).fill(panel) }] }] }).success).toBe(
      false,
    );
  });

  test("editor geometry is normalized", () => {
    expect(Bubble.safeParse({ x: 0.1, y: 0.1, width: 0.2, height: 0.1 }).success).toBe(true);
    expect(Bubble.safeParse({ x: 1.2, y: 0.1, width: 0.2, height: 0.1 }).success).toBe(false);
    expect(ProjectSettings.parse({}).imageQuality).toBe("low");
  });
});

describe("narration v2 coverage", () => {
  const panels = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, beat: `beat ${i}` }));
  const line = (id: string, words: number) => ({
    panelId: id,
    text: Array.from({ length: words }, () => "word").join(" "),
  });

  test("accepts full coverage at the target length", () => {
    const r = narrationDraftFor(panels, 21).safeParse({ lines: panels.map((p) => line(p.id, 21)) });
    expect(r.success).toBe(true);
    expect(ProjectSettings.parse({}).narrationWordsPerPanel).toBe(21);
  });

  test("rejects missing panelId, low coverage (listing beats) and short drafts", () => {
    const schema = narrationDraftFor(panels, 21);
    expect(schema.safeParse({ lines: [{ text: "no panel" }] }).success).toBe(false);
    const low = schema.safeParse({ lines: panels.slice(0, 5).map((p) => line(p.id, 60)) });
    expect(low.success).toBe(false);
    expect(JSON.stringify(low.error!.issues)).toContain("p7 (beat 7)");
    const short = schema.safeParse({ lines: panels.map((p) => line(p.id, 3)) });
    expect(short.success).toBe(false);
    expect(JSON.stringify(short.error!.issues)).toContain("too short");
    // 90% coverage with unknown ids ignored still passes
    const ok = schema.safeParse({ lines: [...panels.slice(0, 9).map((p) => line(p.id, 24)), line("bogus", 5)] });
    expect(ok.success).toBe(true);
    expect(countWords("  a  b\nc ")).toBe(3);
    expect(countWords("今日はとても静かな朝だった", "ja")).toBe(7);
  });
});
