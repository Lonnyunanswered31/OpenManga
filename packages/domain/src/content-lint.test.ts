import { expect, test } from "bun:test";
import { lintCharacter, lintText, panelDistressRisk, softenText } from "./content-lint.ts";
import { segmentNarration } from "./narration.ts";

test("lints the harm vocabulary from the production run, once per span", () => {
  const found = lintText(
    "lean and slightly underweight, hollow cheeks, sallow under the eyes, burn scar on the forearm",
  );
  expect(found.map((f) => f.term)).toEqual(["slightly underweight", "hollow cheeks", "sallow", "burn scar"]);
  expect(lintText("a scarf and a burnished helmet")).toEqual([]);
});

test("only prompt-visible character fields are linted; personality is not", () => {
  const lints = lintCharacter(
    {
      build: "gaunt",
      wardrobe: "sleeves rolled to show the scar",
      distinctiveFeatures: ["bruised knuckles"],
      personality: "hollowed out by grief",
    } as never,
    ["burn scar on the right forearm"],
    [{ name: "Work", description: "apron over a wound dressing" }],
  );
  expect(lints.map((l) => `${l.field}:${l.term}`)).toEqual([
    "build:gaunt",
    "distinctiveFeatures:bruise",
    "wardrobe:scar",
    "immutableTraits:burn scar",
    'outfit "Work":wound',
  ]);
});

test("softening rewrites unambiguous terms only", () => {
  const r = softenText("gaunt face, burn scar, wound up tight after a slow burn");
  expect(r.text).toBe("lean face, small faded mark, wound up tight after a slow burn");
  expect(r.replaced).toEqual(["gaunt", "burn scar"]);
});

test("distress grammar needs a lone figure plus underlighting and mood or angle", () => {
  const base = { lighting: "single bare bulb, deep shadow", emotion: "exhausted", cameraAngle: "eye-level" };
  expect(panelDistressRisk({ ...base, characterCount: 1 })).toEqual([
    "lone figure",
    'lighting "single bare"',
    'mood "exhausted"',
  ]);
  expect(panelDistressRisk({ ...base, characterCount: 2 })).toEqual([]);
  expect(
    panelDistressRisk({ lighting: "warm single bulb, clean shadows", emotion: "exhausted", characterCount: 1 }),
  ).toEqual([]);
  expect(
    panelDistressRisk({ lighting: "phone glow from below", emotion: "calm", cameraAngle: "dutch", characterCount: 1 }),
  ).toHaveLength(3);
});

test("narration segments use the configured pause", () => {
  expect(segmentNarration("One line.", 400, 250)).toEqual([{ text: "One line.", pauseAfterMs: 250 }]);
});
