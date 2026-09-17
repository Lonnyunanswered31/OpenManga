import { expect, test } from "bun:test";
import { fitBox, scrollPlan } from "@openmanga/domain";
import { focusInCrop } from "@openmanga/image-utils";
import { kenBurnsZoom, toSrt } from "./video.ts";

test("scroll is capped and centred when the hold is short", () => {
  expect(scrollPlan(648, 1.1, 60)).toEqual({ y0: 291, travel: 66 });
  expect(scrollPlan(648, 20, 60)).toEqual({ y0: 0, travel: 648 });
  expect(scrollPlan(-10, 5, 60)).toEqual({ y0: 0, travel: 0 });
});

test("Ken Burns: wide shots push in, close shots pull out", () => {
  expect(kenBurnsZoom("wide", 0.06, 90)).toBe("1+0.06*on/90");
  expect(kenBurnsZoom("medium", 0.06, 90)).toBe("1+0.06*on/90");
  expect(kenBurnsZoom("close", 0.06, 90)).toBe("1.0600-0.06*on/90");
  expect(kenBurnsZoom("insert", 0.1, 0)).toBe("1.1000-0.1*on/1");
});

test("panels fit inside the frame margin with even dimensions", () => {
  expect(fitBox(2 / 3, 1804.8, 1015.2)).toEqual({ w: 676, h: 1014 });
  expect(fitBox(21 / 9, 1804.8, 1015.2)).toEqual({ w: 1804, h: 772 });
});

test("srt cues are numbered with hh:mm:ss,mmm times", () => {
  expect(
    toSrt([
      { startMs: 0, endMs: 1500, text: "One." },
      { startMs: 3_723_004, endMs: 3_725_000, text: " Two. " },
    ]),
  ).toBe("1\n00:00:00,000 --> 00:00:01,500\nOne.\n\n2\n01:02:03,004 --> 01:02:05,000\nTwo.\n");
});

test("the move is aimed at the image focus inside the visible crop", () => {
  // centred focus on a matching aspect: centre
  expect(focusInCrop(2048, 1152, 16 / 9, { focalX: 0.5, focalY: 0.5, scale: 1 })).toEqual({ x: 0.5, y: 0.5 });
  // no room to pan on a matching aspect: focus maps to its own position
  expect(focusInCrop(2048, 1152, 16 / 9, { focalX: 0.8, focalY: 0.3, scale: 1 })).toEqual({ x: 0.8, y: 0.3 });
  // zoomed crop centred on the focus: centre of the crop
  const f = focusInCrop(2048, 1152, 16 / 9, { focalX: 0.6, focalY: 0.5, scale: 2 });
  expect(f.x).toBeCloseTo(0.5, 2);
});
