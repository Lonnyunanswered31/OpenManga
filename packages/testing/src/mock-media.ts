import { createHash } from "node:crypto";
import sharp from "sharp";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Placeholder PNG with label, prompt hash and timestamp. Deterministic colors from the prompt hash. */
export async function mockImagePng(opts: {
  width: number;
  height: number;
  prompt: string;
  label?: string;
  timestamp?: string;
  edited?: boolean;
}) {
  const hash = createHash("sha256").update(opts.prompt).digest("hex");
  const hue = Number.parseInt(hash.slice(0, 2), 16) * 1.4;
  const hue2 = (hue + 60) % 360;
  const { width: w, height: h } = opts;
  const fs = Math.round(Math.min(w, h) / 22);
  const label = esc((opts.label ?? "MOCK IMAGE").slice(0, 60));
  const lines = [
    label,
    `prompt ${hash.slice(0, 16)}`,
    esc(opts.timestamp ?? new Date().toISOString()),
    opts.edited ? "EDITED" : "",
  ].filter(Boolean);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,70%)"/><stop offset="1" stop-color="hsl(${hue2},45%,35%)"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <circle cx="${w * 0.62}" cy="${h * 0.45}" r="${Math.min(w, h) * 0.18}" fill="hsl(${hue2},30%,20%)" opacity="0.55"/>
  <rect x="${w * 0.52}" y="${h * 0.6}" width="${w * 0.2}" height="${h * 0.35}" rx="${w * 0.04}" fill="hsl(${hue2},30%,20%)" opacity="0.55"/>
  ${opts.edited ? `<rect x="${w * 0.05}" y="${h * 0.05}" width="${w * 0.3}" height="${h * 0.3}" fill="none" stroke="#ff0" stroke-width="${fs / 3}" stroke-dasharray="${fs}"/>` : ""}
  ${lines.map((l, i) => `<text x="${w * 0.05}" y="${h * 0.75 + i * fs * 1.3}" font-family="DejaVu Sans, sans-serif" font-size="${fs}" fill="#fff" stroke="#000" stroke-width="${fs / 12}">${l}</text>`).join("")}
</svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

/** 16-bit PCM mono WAV with a soft tone whose length tracks the text length (~14 chars/sec). */
export function mockWav(text: string, opts: { sampleRate?: number; speed?: number } = {}) {
  const sr = opts.sampleRate ?? 24000;
  const seconds = Math.max(0.6, Math.min(60, text.length / 14 / (opts.speed ?? 1)));
  const n = Math.round(seconds * sr);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  const freq = 180 + (createHash("sha1").update(text).digest()[0]! % 120);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 2000, (n - i) / 2000);
    v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * freq * i) / sr) * 3000 * env), true);
  }
  return { data: new Uint8Array(buf), sampleRate: sr, durationMs: Math.round((n / sr) * 1000) };
}

export type MockScenario =
  | "429"
  | "500"
  | "502"
  | "503"
  | "timeout"
  | "reset"
  | "auth"
  | "quota"
  | "policy"
  | "invalid-json"
  | "fenced-json"
  | "schema-invalid"
  | "repairable"
  | "bad-image"
  | "slow";

export const MOCK_SCENARIOS: MockScenario[] = [
  "429",
  "500",
  "502",
  "503",
  "timeout",
  "reset",
  "auth",
  "quota",
  "policy",
  "invalid-json",
  "fenced-json",
  "schema-invalid",
  "repairable",
  "bad-image",
  "slow",
];

/** Find `[[mock:scenario]]` markers in request text. */
export function scenarioFromText(text: string): MockScenario | null {
  const m = text.match(/\[\[mock:([a-z0-9-]+)\]\]/);
  return m && (MOCK_SCENARIOS as string[]).includes(m[1]!) ? (m[1] as MockScenario) : null;
}
