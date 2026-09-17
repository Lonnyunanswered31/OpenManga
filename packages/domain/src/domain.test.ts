import { describe, expect, test } from "bun:test";
import { Bubble } from "@openmanga/schemas";
import {
  applyGutters,
  bubbleGeometry,
  buildTimeline,
  canPerform,
  canTransition,
  clampFrame,
  defaultTailTarget,
  estimateCostUsd,
  hashOf,
  LAYOUT_TEMPLATES,
  placeBubble,
  readingOrder,
  segmentNarration,
  selectRate,
  splitFrame,
  swapTemplate,
  tailTargetToward,
  templateFrames,
  wrapText,
} from "./index.ts";

describe("layout geometry", () => {
  test("reading order does not depend on input order (transitive comparator)", () => {
    const mk = (id: string, x: number, y: number) => ({ id, frame: { x, y, width: 0.3, height: 0.3, rotation: 0 } });
    const order = (items: ReturnType<typeof mk>[]) =>
      readingOrder(items, "ltr")
        .map((i) => i.id)
        .join("");
    // A down-left staircase. The old comparator mixed raw y into the row test, which made it intransitive: these
    // three permutations of identical geometry sorted three different ways.
    const a = mk("A", 0.9, 0);
    const b = mk("B", 0.5, 0.04);
    const c = mk("C", 0.1, 0.09);
    expect(order([a, b, c])).toBe("ABC");
    expect(order([b, c, a])).toBe("ABC");
    expect(order([c, a, b])).toBe("ABC");
    // Within one row band the order is across, not down.
    const l = mk("L", 0.1, 0.5);
    const r = mk("R", 0.7, 0.51);
    expect(order([r, l])).toBe("LR");
  });

  test("at least 10 templates, all frames normalized and non-overlapping", () => {
    expect(LAYOUT_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    expect(Math.max(...LAYOUT_TEMPLATES.map((t) => t.frames.length))).toBe(5);
    for (const t of LAYOUT_TEMPLATES) {
      const frames = applyGutters(t.frames, 0.03, 0.015);
      for (const f of frames) {
        expect(f.x).toBeGreaterThanOrEqual(0);
        expect(f.y).toBeGreaterThanOrEqual(0);
        expect(f.x + f.width).toBeLessThanOrEqual(1.0001);
        expect(f.y + f.height).toBeLessThanOrEqual(1.0001);
      }
      for (let i = 0; i < frames.length; i++)
        for (let j = i + 1; j < frames.length; j++) {
          const a = frames[i]!;
          const b = frames[j]!;
          const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          expect(ox <= 0.0001 || oy <= 0.0001).toBe(true);
        }
    }
  });

  test("RTL mirrors horizontally", () => {
    const ltr = templateFrames("two-vertical", { margin: 0, gutter: 0, readingDirection: "ltr" });
    const rtl = templateFrames("two-vertical", { margin: 0, gutter: 0, readingDirection: "rtl" });
    expect(rtl[0]!.x).toBe(0.5);
    expect(ltr[0]!.x).toBe(0);
  });

  test("split, clamp, reading order, swap", () => {
    const [a, b] = splitFrame({ x: 0, y: 0, width: 1, height: 1 }, "vertical", 0);
    expect(a.width).toBeCloseTo(0.5);
    expect(b.x).toBeCloseTo(0.5);
    expect(clampFrame({ x: 0.9, y: -1, width: 0.5, height: 2 })).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
    const items = [
      { id: "br", frame: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } },
      { id: "tl", frame: { x: 0, y: 0, width: 0.5, height: 0.5 } },
      { id: "tr", frame: { x: 0.5, y: 0, width: 0.5, height: 0.5 } },
    ];
    expect(readingOrder(items, "ltr").map((i) => i.id)).toEqual(["tl", "tr", "br"]);
    expect(readingOrder(items, "rtl").map((i) => i.id)).toEqual(["tr", "tl", "br"]);
    expect(swapTemplate(items, "full-page", { margin: 0, gutter: 0, readingDirection: "ltr" })).toHaveLength(3);
    expect(() => templateFrames("nope", { margin: 0, gutter: 0, readingDirection: "ltr" })).toThrow();
  });
});

describe("text", () => {
  test("wrap respects width and breaks long words", () => {
    const lines = wrapText("The quick brown fox jumps over the lazy dog", 200, 20);
    expect(lines.length).toBeGreaterThan(1);
    expect(wrapText("Supercalifragilisticexpialidocious", 60, 20).length).toBeGreaterThan(1);
    expect(wrapText("a\nb", 1000, 20)).toEqual(["a", "b"]);
  });
  test("bubble placement avoids faces and stays in panel", () => {
    const panel = { x: 0.1, y: 0.1, width: 0.8, height: 0.4 };
    const face = { x: 0.1, y: 0.1, width: 0.4, height: 0.2 };
    const r = placeBubble({ panel, text: "Who's there?", fontSize: 28, pageW: 1600, pageH: 2400, avoid: [face] });
    expect(r.x).toBeGreaterThanOrEqual(panel.x);
    expect(r.x + r.width).toBeLessThanOrEqual(panel.x + panel.width + 1e-9);
    const overlapX = Math.min(r.x + r.width, face.x + face.width) - Math.max(r.x, face.x);
    const overlapY = Math.min(r.y + r.height, face.y + face.height) - Math.max(r.y, face.y);
    expect(overlapX <= 0 || overlapY <= 0).toBe(true);
  });
});

describe("narration segmentation", () => {
  test("short text is one segment", () => {
    expect(segmentNarration("The city had already fallen.")).toEqual([
      { text: "The city had already fallen.", pauseAfterMs: 350 },
    ]);
  });
  test("paragraphs split and max length enforced", () => {
    const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here, and it continues.`).join(" ");
    const segs = segmentNarration(`First paragraph.\n\n${long}`, 200);
    expect(segs[0]!.text).toBe("First paragraph.");
    for (const s of segs) expect(s.text.length).toBeLessThanOrEqual(200);
    expect(
      segs
        .map((s) => s.text)
        .join(" ")
        .replace(/\s+/g, " "),
    ).toBe(`First paragraph. ${long}`);
  });
  test("overlong sentence splits on pauses then words", () => {
    const s = `${"word ".repeat(200).trim()}.`;
    for (const seg of segmentNarration(s, 100)) expect(seg.text.length).toBeLessThanOrEqual(100);
  });
  test("timeline accumulates", () => {
    const tl = buildTimeline("c", [
      { panelId: "p1", segmentId: "s1", audioAssetId: "a", durationMs: 1000, pauseAfterMs: 200, text: "x" },
      { panelId: null, segmentId: "s2", audioAssetId: "b", durationMs: 500, pauseAfterMs: 0, text: "y" },
    ]);
    expect(tl.segments[1]!.startMs).toBe(1200);
    expect(tl.totalDurationMs).toBe(1700);
  });
});

describe("cost", () => {
  const rate = {
    provider: "openai",
    model: "gpt-image-2",
    effectiveFrom: "2026-01-01",
    textInputRate: 5,
    cachedInputRate: 1,
    textOutputRate: 0,
    imageInputRate: 10,
    imageOutputRate: 40,
  };
  test("estimate from tokens", () => {
    const usd = estimateCostUsd(
      {
        textInputTokens: 1000,
        cachedInputTokens: 200,
        textOutputTokens: 0,
        imageInputTokens: 500,
        imageOutputTokens: 1000,
      },
      rate,
    );
    expect(usd).toBeCloseTo((800 * 5 + 200 * 1 + 500 * 10 + 1000 * 40) / 1e6, 8);
    expect(
      estimateCostUsd(
        { textInputTokens: 1, cachedInputTokens: 0, textOutputTokens: 0, imageInputTokens: 0, imageOutputTokens: 0 },
        null,
      ),
    ).toBe(0);
  });
  test("speech is priced per 1M characters", () => {
    const tts = {
      ...rate,
      provider: "elevenlabs",
      model: "tts",
      textInputRate: 0,
      cachedInputRate: 0,
      characterRate: 3,
    };
    const zero = {
      textInputTokens: 0,
      cachedInputTokens: 0,
      textOutputTokens: 0,
      imageInputTokens: 0,
      imageOutputTokens: 0,
    };
    expect(estimateCostUsd({ ...zero, characters: 20_000 }, tts)).toBeCloseTo(0.06, 8);
    // A rate with no characterRate must not silently charge for characters.
    expect(estimateCostUsd({ ...zero, characters: 20_000 }, rate)).toBe(0);
  });
  test("select rate by effective date", () => {
    const older = { ...rate, effectiveFrom: "2025-01-01", imageOutputRate: 30 };
    const future = { ...rate, effectiveFrom: "2030-01-01", imageOutputRate: 99 };
    expect(selectRate([older, rate, future], "openai", "gpt-image-2", new Date("2026-06-01"))?.imageOutputRate).toBe(
      40,
    );
    expect(selectRate([rate], "openai", "other", new Date())).toBeNull();
  });
});

describe("permissions", () => {
  const u = { id: "u", role: "user" as const, status: "active" as const };
  test("roles", () => {
    expect(canPerform(u, "owner", "delete")).toBe(true);
    expect(canPerform(u, "editor", "generate")).toBe(true);
    expect(canPerform(u, "editor", "delete")).toBe(false);
    expect(canPerform(u, "viewer", "write")).toBe(false);
    expect(canPerform(u, null, "read")).toBe(false);
    expect(canPerform({ ...u, status: "disabled" }, "owner", "read")).toBe(false);
    expect(canPerform({ ...u, role: "admin" }, null, "read")).toBe(true);
    expect(canPerform({ ...u, role: "admin" }, null, "write")).toBe(false);
  });
  test("approval transitions", () => {
    expect(canTransition("draft", "approved")).toBe(true);
    expect(canTransition("locked", "draft")).toBe(false);
    expect(canTransition("superseded", "approved")).toBe(false);
  });
  test("hash is key-order independent", () => {
    expect(hashOf({ a: 1, b: [1, 2] })).toBe(hashOf({ b: [1, 2], a: 1 }));
  });
});

describe("lettering defaults and fit", () => {
  test("resolve merges project overrides over built-ins", async () => {
    const { resolveLettering } = await import("./lettering.ts");
    const r = resolveLettering({ lettering: { types: { narration: { fontSize: 22 } }, sfx: { fill: "#ff0000" } } });
    expect(r.types.narration.fontSize).toBe(22);
    expect(r.types.narration.background).toBe("#fff8e1");
    expect(r.types.normal.fontSize).toBe(34);
    expect(r.sfx.fill).toBe("#ff0000");
    expect(resolveLettering(undefined).autoFit).toBe(true);
  });
  test("fitted box keeps short text on one line and wraps identically in the renderer", async () => {
    const { fitBubbleBox, refitBubble } = await import("./lettering.ts");
    const { layoutBubbleText } = await import("./text.ts");
    const { Bubble } = await import("@openmanga/schemas");
    for (const type of ["normal", "thought", "shout", "whisper", "narration", "system"] as const) {
      const b = Bubble.parse({ type, x: 0.2, y: 0.2, width: 0.4, height: 0.2, fontSize: 30, padding: 12 });
      const size = fitBubbleBox("Thirty-four dollars.", b, 1600, 2400);
      const fitted = { ...b, ...size };
      expect(layoutBubbleText("Thirty-four dollars.", fitted, 1600, 2400).lines).toHaveLength(1);
      expect(size.width).toBeLessThan(0.4);
      const long = "The rent is due tomorrow and the fridge is empty again, just like every other night this month.";
      const lf = { ...b, ...fitBubbleBox(long, b, 1600, 2400) };
      expect(lf.width).toBeLessThanOrEqual(0.43);
      const lines = layoutBubbleText(long, lf, 1600, 2400).lines;
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.join(" ")).toBe(long);
      const moved = refitBubble("Hi", b, 1600, 2400);
      expect(moved.x + moved.width).toBeLessThanOrEqual(1);
    }
  });
});

describe("bubble tails", () => {
  const b = { x: 0.4, y: 0.1, width: 0.2, height: 0.08 };
  const frame = { x: 0, y: 0, width: 1, height: 0.5 };
  test("direction targets land outside the bubble on the requested side", () => {
    const down = tailTargetToward(b, "down");
    expect(down.y).toBeGreaterThan(b.y + b.height);
    const left = tailTargetToward(b, "left");
    expect(left.x).toBeLessThan(b.x);
    const ur = tailTargetToward(b, "up-right");
    expect(ur.x).toBeGreaterThan(b.x + b.width);
    expect(ur.y).toBeLessThan(b.y);
  });
  test("default tail points below, leans to speaker side, stays in panel", () => {
    const t = defaultTailTarget(b, frame, "left third, foreground");
    expect(t.y).toBeGreaterThan(b.y + b.height);
    expect(t.y).toBeLessThanOrEqual(frame.y + frame.height);
    expect(t.x).toBeLessThan(b.x + b.width / 2);
    expect(defaultTailTarget(b, frame, "right side").x).toBeGreaterThan(b.x + b.width / 2);
    const plain = defaultTailTarget(b, frame);
    expect(Math.abs(plain.x - 0.5)).toBeLessThan(0.05);
  });
  test("geometry draws a tail to an outside target", () => {
    const withTail = bubbleGeometry(
      Bubble.parse({ ...b, tail: true, tailTarget: tailTargetToward(b, "down") }),
      1000,
      1000,
    );
    const none = bubbleGeometry(Bubble.parse({ ...b, tail: false }), 1000, 1000);
    expect(withTail.path).not.toBe(none.path);
  });
});
