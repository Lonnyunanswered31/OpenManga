import { expect, test } from "bun:test";
import { sliceChapters } from "./apply.ts";

test("sliceChapters uses sourceStart hints and falls back to even split", () => {
  const story = "Chapter One. Mina ran to the station at dawn.\n\nChapter Two. Jun waited on the platform for hours.";
  const parts = sliceChapters(story, ["Chapter One. Mina ran", "Chapter Two. Jun waited on"]);
  expect(parts[0]).toContain("Mina ran");
  expect(parts[0]).not.toContain("Jun waited");
  expect(parts[1]!.startsWith("Chapter Two")).toBe(true);
  expect(sliceChapters(story, ["x"])).toEqual([story]);
  const fallback = sliceChapters(story, ["a", "not in story at all"]);
  expect(fallback).toHaveLength(2);
  expect(fallback.join("")).toBe(story);
});
