export * from "./browser.ts";

import { createHash } from "node:crypto";

/** Stable JSON (sorted keys) for hashing. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export const hashOf = (v: unknown) =>
  createHash("sha256")
    .update(typeof v === "string" ? v : stableStringify(v))
    .digest("hex");
