import { expect, test } from "bun:test";
import { computeCrop, panImageTransform } from "./store.ts";

test("panning moves the crop opposite to the drag and never past the image edge", () => {
  const t = { focalX: 0.5, focalY: 0.5, scale: 1 };
  // 1024x1536 portrait art in a wide 800x400 frame: crop is full width, can only move vertically
  const down = panImageTransform(1024, 1536, 800, 400, t, 0, 100);
  expect(down.focalY).toBeLessThan(0.5);
  expect(down.focalX).toBe(0.5);
  const far = panImageTransform(1024, 1536, 800, 400, t, 0, -100_000);
  const crop = computeCrop(1024, 1536, 2, far);
  expect(crop.y + crop.height).toBeCloseTo(1536, 0);
  expect(far.focalY).toBeCloseTo(1 - crop.height / 2 / 1536, 3);
  const zoomed = panImageTransform(1024, 1536, 800, 400, t, 50, 0, 2);
  expect(zoomed.scale).toBe(2);
  expect(zoomed.focalX).toBeLessThan(0.5);
  expect(panImageTransform(1024, 1536, 800, 400, t, 0, 0, 20).scale).toBe(8);
});
