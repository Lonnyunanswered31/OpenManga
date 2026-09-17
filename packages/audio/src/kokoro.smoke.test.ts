import { expect, test } from "bun:test";
import { KokoroTTSProvider, parseWav } from "./index.ts";

/** Optional real Kokoro smoke test: KOKORO_SMOKE_URL=http://kokoro:8000 bun test packages/audio */
const url = process.env.KOKORO_SMOKE_URL;

test.skipIf(!url)(
  "real Kokoro synthesizes 24kHz mono WAV",
  async () => {
    const k = new KokoroTTSProvider({ url: url! });
    const health = await k.health();
    expect(health.state).toBe("ready");
    const voices = await k.voices();
    expect(voices.some((v) => v.id === "af_heart")).toBe(true);
    const r = await k.synthesize({ text: "The rain continued through the night.", voice: "af_heart", speed: 1 });
    const info = parseWav(r.wav);
    expect(info.sampleRate).toBe(24000);
    expect(info.channels).toBe(1);
    expect(r.durationMs).toBeGreaterThan(500);
    await expect(k.synthesize({ text: "x", voice: "not_a_voice", speed: 1 })).rejects.toMatchObject({
      code: "invalid_request",
    });
  },
  120_000,
);
