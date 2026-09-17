import {
  classifyFetchError,
  classifyHttpStatus,
  ProviderError,
  parseRetryAfter,
  refuseRedirect,
  withRetry,
} from "@openmanga/domain/browser";
import type { SynthesizeRequest, SynthesizeResult, TTSProvider, TTSStatus, Voice } from "./index.ts";

/** Wrap raw 16-bit little-endian PCM in a WAV header so cloud audio concatenates with Kokoro output. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24_000, channels = 1) {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

type CloudOpts = { apiKey: string; baseUrl: string; model: string; timeoutMs?: number; fetch?: typeof fetch };

abstract class CloudTTS implements TTSProvider {
  abstract readonly provider: string;
  protected abstract readonly label: string;
  constructor(protected readonly opts: CloudOpts) {
    if (!opts.apiKey) throw new Error("TTS API key is not configured");
  }

  async health(): Promise<TTSStatus> {
    return { ok: true, state: "ready", modelVersion: this.opts.model };
  }
  abstract voices(): Promise<Voice[]>;
  protected abstract request(r: SynthesizeRequest): {
    url: string;
    init: RequestInit;
    pcm: (res: Response) => Promise<{ pcm: Uint8Array; rate: number }>;
  };

  synthesize(r: SynthesizeRequest): Promise<SynthesizeResult> {
    return withRetry(
      async () => {
        const { url, init, pcm } = this.request(r);
        let res: Response;
        try {
          res = await (this.opts.fetch ?? fetch)(url, {
            ...init,
            signal: AbortSignal.timeout(this.opts.timeoutMs ?? 180_000),
            redirect: "manual",
          });
        } catch (e) {
          throw classifyFetchError(this.provider, e);
        }
        refuseRedirect(this.provider, res);
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          let msg = body.slice(0, 300);
          try {
            const j = JSON.parse(body) as {
              error?: { message?: string } | string;
              detail?: { message?: string } | string;
            };
            msg =
              (typeof j.error === "string" ? j.error : j.error?.message) ??
              (typeof j.detail === "string" ? j.detail : j.detail?.message) ??
              msg;
          } catch {}
          throw new ProviderError(
            this.provider,
            classifyHttpStatus(res.status),
            `${this.label} TTS HTTP ${res.status}: ${msg}`,
            {
              status: res.status,
              retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
            },
          );
        }
        const { pcm: data, rate } = await pcm(res);
        if (!data.length) throw new ProviderError(this.provider, "synthesis_error", `${this.label} returned no audio`);
        const wav = pcmToWav(data.length % 2 ? data.slice(0, -1) : data, rate);
        return {
          wav,
          sampleRate: rate,
          durationMs: Math.round((data.length / 2 / rate) * 1000),
          modelVersion: this.opts.model,
          provider: this.provider,
        };
      },
      { retries: 2, baseMs: 2000 },
    );
  }
}

const rawPcm = async (res: Response) => ({ pcm: new Uint8Array(await res.arrayBuffer()), rate: 24_000 });

export const OPENAI_TTS_VOICES = [
  "marin",
  "cedar",
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
];

/** tts-1 / tts-1-hd reject the voices added with gpt-4o-mini-tts (HTTP 400 on marin, cedar, ballad, verse). */
export const OPENAI_LEGACY_TTS_VOICES = ["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"];
export const openaiVoicesFor = (model: string) => (/^tts-1/.test(model) ? OPENAI_LEGACY_TTS_VOICES : OPENAI_TTS_VOICES);

/** OpenAI (or OpenAI-compatible) /audio/speech, PCM 24 kHz. */
export class OpenAITTSProvider extends CloudTTS {
  readonly provider: string;
  protected readonly label: string;
  constructor(opts: CloudOpts, provider = "openai", label = "OpenAI") {
    super(opts);
    this.provider = provider;
    this.label = label;
  }
  async voices() {
    return openaiVoicesFor(this.opts.model).map((id) => ({
      id,
      name: id[0]!.toUpperCase() + id.slice(1),
      language: "multilingual",
    }));
  }
  protected request(r: SynthesizeRequest) {
    return {
      url: `${this.opts.baseUrl.replace(/\/$/, "")}/audio/speech`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify({
          model: this.opts.model,
          voice: r.voice,
          input: r.text,
          response_format: "pcm",
          speed: Math.min(4, Math.max(0.25, r.speed)),
        }),
      },
      pcm: rawPcm,
    };
  }
}

export const GEMINI_TTS_VOICES = [
  "Kore",
  "Puck",
  "Charon",
  "Zephyr",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
];

/** Gemini TTS via generateContent with AUDIO modality (base64 L16 PCM). Speed is conveyed as a style hint. */
export class GeminiTTSProvider extends CloudTTS {
  readonly provider = "google";
  protected readonly label = "Gemini";
  async voices() {
    return GEMINI_TTS_VOICES.map((id) => ({ id, name: id, language: "multilingual" }));
  }
  protected request(r: SynthesizeRequest) {
    const pace = r.speed > 1.1 ? "Read briskly: " : r.speed < 0.9 ? "Read slowly and calmly: " : "";
    return {
      url: `${this.opts.baseUrl.replace(/\/$/, "")}/models/${this.opts.model}:generateContent`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.opts.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${pace}${r.text}` }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: r.voice } } },
          },
        }),
      },
      pcm: async (res: Response) => {
        const j = (await res.json()) as {
          candidates?: {
            content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] };
            finishReason?: string;
          }[];
        };
        const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
        if (!part?.data)
          throw new ProviderError(
            this.provider,
            /SAFETY|PROHIBITED/.test(j.candidates?.[0]?.finishReason ?? "") ? "content_policy" : "synthesis_error",
            `Gemini returned no audio (${j.candidates?.[0]?.finishReason ?? "no candidate"})`,
          );
        const rate = Number(part.mimeType?.match(/rate=(\d+)/)?.[1] ?? 24_000);
        return { pcm: new Uint8Array(Buffer.from(part.data, "base64")), rate };
      },
    };
  }
}

/** ElevenLabs text-to-speech, pcm_24000. Voices come from the account. */
export class ElevenLabsTTSProvider extends CloudTTS {
  readonly provider = "elevenlabs";
  protected readonly label = "ElevenLabs";
  async voices() {
    let res: Response;
    try {
      res = await (this.opts.fetch ?? fetch)(`${this.opts.baseUrl.replace(/\/$/, "")}/v1/voices`, {
        headers: { "xi-api-key": this.opts.apiKey },
        signal: AbortSignal.timeout(15_000),
        redirect: "manual",
      });
    } catch (e) {
      throw classifyFetchError(this.provider, e);
    }
    refuseRedirect(this.provider, res);
    if (!res.ok)
      throw new ProviderError(this.provider, classifyHttpStatus(res.status), `ElevenLabs voices HTTP ${res.status}`);
    const j = (await res.json()) as { voices?: { voice_id: string; name: string; labels?: Record<string, string> }[] };
    return (j.voices ?? []).map((v) => ({
      id: v.voice_id,
      name: v.name,
      language: v.labels?.language ?? v.labels?.accent ?? "",
      gender: v.labels?.gender,
    }));
  }
  protected request(r: SynthesizeRequest) {
    return {
      url: `${this.opts.baseUrl.replace(/\/$/, "")}/v1/text-to-speech/${encodeURIComponent(r.voice)}?output_format=pcm_24000`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json", "xi-api-key": this.opts.apiKey },
        body: JSON.stringify({
          text: r.text,
          model_id: this.opts.model,
          voice_settings: { speed: Math.min(1.2, Math.max(0.7, r.speed)) },
        }),
      },
      pcm: rawPcm,
    };
  }
}
