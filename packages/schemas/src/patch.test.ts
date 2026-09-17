import { expect, test } from "bun:test";
import { asPatch, ProjectSettings } from "./index.ts";

const FILM = ProjectSettings.parse({
  format: "film",
  pageWidth: 1920,
  pageHeight: 1080,
  pageMargin: 0,
  pageGutter: 0,
  narrationVoice: "am_adam",
  imageQuality: "high",
});

test("a patch applies only the keys the caller sent", () => {
  const patch = asPatch(ProjectSettings).parse({ narrationSpeed: 1.2 });
  expect(Object.keys(patch)).toEqual(["narrationSpeed"]);
  const merged = ProjectSettings.parse({ ...FILM, ...patch });
  // The bug this guards: .partial() keeps the inner .default()s, so every customised field reset to its default
  // (a film project silently became a 1600x2400 comic) on a patch that sent one unrelated key.
  expect(merged.format).toBe("film");
  expect([merged.pageWidth, merged.pageHeight]).toEqual([1920, 1080]);
  expect(merged.pageMargin).toBe(0);
  expect(merged.narrationVoice).toBe("am_adam");
  expect(merged.imageQuality).toBe("high");
  expect(merged.narrationSpeed).toBe(1.2);
});

test("a patch still validates, and can clear an optional field it does send", () => {
  expect(asPatch(ProjectSettings).safeParse({ pageWidth: 99_999_999 }).success).toBe(false);
  expect(asPatch(ProjectSettings).safeParse({ consistencyCheck: { enabled: true } }).success).toBe(true);
  const patch = asPatch(ProjectSettings).parse({ budgetUsd: null });
  expect(ProjectSettings.parse({ ...FILM, ...patch }).budgetUsd).toBeNull();
});
