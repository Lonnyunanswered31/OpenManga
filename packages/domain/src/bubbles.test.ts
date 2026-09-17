import { describe, expect, test } from "bun:test";
import { Bubble } from "@openmanga/schemas";
import { bubbleGeometry } from "./bubbles.ts";

const base = Bubble.parse({ x: 0.1, y: 0.1, width: 0.25, height: 0.08, tailTarget: { x: 0.2, y: 0.4 } });

describe("bubble geometry", () => {
  test("normal bubble includes tail tip toward target", () => {
    const g = bubbleGeometry(base, 1600, 2400);
    expect(g.x).toBeCloseTo(160);
    expect(g.width).toBeCloseTo(400);
    const tipX = 0.2 * 1600 - g.x;
    const tipY = 0.4 * 2400 - g.y;
    expect(g.path).toContain(`${Math.round(tipX * 10) / 10},${Math.round(tipY * 10) / 10}`);
    expect(g.path.endsWith("Z")).toBe(true);
  });

  test("no tail when target is inside or tail disabled", () => {
    const inside = bubbleGeometry({ ...base, tailTarget: { x: 0.2, y: 0.12 } }, 1600, 2400);
    const noTail = bubbleGeometry({ ...base, tail: false }, 1600, 2400);
    expect(inside.path).toBe(noTail.path);
  });

  test("types: whisper dashed, system inner border, narration rect, thought cloud", () => {
    expect(bubbleGeometry({ ...base, type: "whisper" }, 1000, 1000).dash).not.toBeNull();
    expect(bubbleGeometry({ ...base, type: "system" }, 1000, 1000).innerBorder).not.toBeNull();
    expect(bubbleGeometry({ ...base, type: "narration" }, 1000, 1000).path).toContain("Q");
    expect(bubbleGeometry({ ...base, type: "thought" }, 1000, 1000).path).toContain("A");
    expect(bubbleGeometry({ ...base, type: "shout", tail: false }, 1000, 1000).path.split("L").length).toBeGreaterThan(
      30,
    );
  });

  test("deterministic", () => {
    expect(bubbleGeometry(base, 1600, 2400)).toEqual(bubbleGeometry(structuredClone(base), 1600, 2400));
  });
});
