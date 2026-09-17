import {
  ConcurrencyLimiter,
  classifyFetchError,
  classifyHttpStatus,
  ProviderError,
  parseRetryAfter,
  refuseRedirect,
  withRetry,
} from "@openmanga/domain/browser";
import { probeImage, type SizeOption } from "@openmanga/image-utils";
import type { Logger } from "@openmanga/logger";
import type { EditImageRequest, GenerateImageRequest, ImageAIProvider, ImageInputFile, ImageResult } from "./index.ts";

/** Output dimensions Gemini image models return at 1K for each supported aspect ratio. */
export const GEMINI_ASPECTS: { ratio: string; width: number; height: number }[] = [
  { ratio: "1:1", width: 1024, height: 1024 },
  { ratio: "2:3", width: 832, height: 1248 },
  { ratio: "3:2", width: 1248, height: 832 },
  { ratio: "3:4", width: 864, height: 1184 },
  { ratio: "4:3", width: 1184, height: 864 },
  { ratio: "4:5", width: 896, height: 1152 },
  { ratio: "5:4", width: 1152, height: 896 },
  { ratio: "9:16", width: 768, height: 1344 },
  { ratio: "16:9", width: 1344, height: 768 },
  { ratio: "21:9", width: 1536, height: 672 },
];

export function geminiAspectFor(aspectRatio: number) {
  const target = Math.log(aspectRatio > 0 ? aspectRatio : 1);
  return GEMINI_ASPECTS.reduce((best, a) =>
    Math.abs(Math.log(a.width / a.height) - target) < Math.abs(Math.log(best.width / best.height) - target) ? a : best,
  );
}

type Part = { text?: string; inlineData?: { mimeType?: string; data?: string }; thought?: boolean };
type TokenDetail = { modality?: string; tokenCount?: number };
type GeminiResponse = {
  responseId?: string;
  candidates?: { content?: { parts?: Part[] }; finishReason?: string; finishMessage?: string }[];
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
    promptTokensDetails?: TokenDetail[];
    candidatesTokensDetails?: TokenDetail[];
    [k: string]: unknown;
  };
  error?: { code?: number; message?: string; status?: string };
};

const POLICY_FINISH = new Set([
  "SAFETY",
  "IMAGE_SAFETY",
  "PROHIBITED_CONTENT",
  "IMAGE_PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "RECITATION",
  "IMAGE_RECITATION",
]);

const b64 = (d: Uint8Array) => Buffer.from(d).toString("base64");
const image = (f: ImageInputFile): Part => ({ inlineData: { mimeType: f.mime, data: b64(f.data) } });
const tokens = (details: TokenDetail[] | undefined, modality: string) =>
  details?.filter((d) => d.modality === modality).reduce((s, d) => s + (d.tokenCount ?? 0), 0);

/** Google Gemini image models (Nano Banana family) via generateContent. The only module that knows Gemini formats. */
export class GeminiImageProvider implements ImageAIProvider {
  readonly provider = "google";
  readonly model: string;
  private readonly limiter: ConcurrencyLimiter;

  constructor(
    private readonly opts: {
      apiKey: string;
      baseUrl: string;
      model: string;
      /** "1K" (default), "2K", "4K" or "512px" where the model supports it. */
      imageSize: string;
      timeoutMs: number;
      maxConcurrency: number;
      retries?: number;
      logger?: Logger;
      fetch?: typeof fetch;
    },
  ) {
    if (!opts.apiKey) throw new Error("GOOGLE_API_KEY is not configured");
    this.model = opts.model;
    this.limiter = new ConcurrencyLimiter(opts.maxConcurrency);
  }

  sizeFor(aspectRatio: number): SizeOption {
    const a = geminiAspectFor(aspectRatio);
    return { width: a.width, height: a.height };
  }

  generate(input: GenerateImageRequest) {
    const parts: Part[] = [{ text: input.prompt }];
    for (const [i, r] of input.references.entries()) {
      parts.push({ text: `Reference image ${i + 1}: ${r.label}` }, image(r));
    }
    return this.call(parts, geminiAspectFor(input.aspectRatio), input.references.length, input.signal);
  }

  async edit(input: EditImageRequest) {
    const { width, height } = await probeImage(input.target.data);
    const parts: Part[] = [
      { text: input.prompt },
      { text: "Image to edit (keep composition, size and everything outside the edit region unchanged):" },
      image(input.target),
    ];
    if (input.mask) {
      parts.push(
        {
          text: "Edit mask for the image above: only change the areas that are transparent in this mask; opaque areas must stay pixel-identical.",
        },
        image({ ...input.mask, mime: "image/png" }),
      );
    }
    for (const [i, r] of input.references.entries()) {
      parts.push({ text: `Reference image ${i + 1}: ${r.label}` }, image(r));
    }
    return this.call(parts, geminiAspectFor(width / height), input.references.length, input.signal, "edit");
  }

  private call(
    parts: Part[],
    aspect: (typeof GEMINI_ASPECTS)[number],
    referenceCount: number,
    signal: AbortSignal | undefined,
    op: "generate" | "edit" = "generate",
  ): Promise<ImageResult> {
    return withRetry(() => this.limiter.run(() => this.once(parts, aspect, referenceCount, signal, op)), {
      retries: this.opts.retries ?? 2,
      baseMs: 2000,
      onRetry: (e, attempt, delay) => {
        if (e.code === "rate_limited") this.limiter.cooldown(delay);
        this.opts.logger?.warn("gemini image retry", {
          code: e.code,
          attempt,
          delayMs: Math.round(delay),
          providerRequestId: e.requestId,
        });
      },
    });
  }

  private async once(
    parts: Part[],
    aspect: (typeof GEMINI_ASPECTS)[number],
    referenceCount: number,
    signal: AbortSignal | undefined,
    op: "generate" | "edit",
  ): Promise<ImageResult> {
    const started = performance.now();
    const endpoint = `/models/${this.model}:generateContent`;
    const s = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(this.opts.timeoutMs)])
      : AbortSignal.timeout(this.opts.timeoutMs);
    let res: Response;
    try {
      res = await (this.opts.fetch ?? fetch)(`${this.opts.baseUrl.replace(/\/$/, "")}${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.opts.apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: { aspectRatio: aspect.ratio, imageSize: this.opts.imageSize },
          },
        }),
        signal: s,
        redirect: "manual",
      });
    } catch (e) {
      throw classifyFetchError(this.provider, e);
    }
    refuseRedirect(this.provider, res);
    const text = await res.text().catch(() => "");
    let json: GeminiResponse = {};
    try {
      json = JSON.parse(text) as GeminiResponse;
    } catch {
      if (res.ok) throw new ProviderError(this.provider, "invalid_response", "Gemini returned non-JSON body");
    }
    const requestId = json.responseId ?? res.headers.get("x-goog-request-id");
    const ctx = { requestId: requestId ?? undefined };
    if (!res.ok) {
      const msg = json.error?.message ?? text.slice(0, 300);
      const st = json.error?.status;
      const code =
        st === "RESOURCE_EXHAUSTED" && /quota|billing|limit: 0/i.test(msg) && res.status !== 429
          ? "quota"
          : st === "FAILED_PRECONDITION"
            ? "quota"
            : /API key not valid|API_KEY_INVALID/i.test(msg)
              ? "auth"
              : classifyHttpStatus(res.status);
      throw new ProviderError(this.provider, code, `Gemini HTTP ${res.status}${st ? ` ${st}` : ""}: ${msg}`, {
        status: res.status,
        retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
        ...ctx,
      });
    }
    if (json.promptFeedback?.blockReason) {
      throw new ProviderError(
        this.provider,
        "content_policy",
        `Gemini blocked the prompt: ${json.promptFeedback.blockReason}${json.promptFeedback.blockReasonMessage ? ` (${json.promptFeedback.blockReasonMessage})` : ""}`,
        ctx,
      );
    }
    const um = json.usageMetadata ?? {};
    const billedImageIn = tokens(um.promptTokensDetails, "IMAGE") ?? 0;
    // The request was answered, so it was billed: carry what it cost even when the answer is unusable.
    const billed = {
      textInputTokens:
        tokens(um.promptTokensDetails, "TEXT") ?? Math.max(0, (um.promptTokenCount ?? 0) - billedImageIn),
      imageInputTokens: billedImageIn,
      imageOutputTokens: tokens(um.candidatesTokensDetails, "IMAGE") ?? um.candidatesTokenCount ?? 0,
    };
    const cand = json.candidates?.[0];
    const img = cand?.content?.parts?.find((p) => p.inlineData?.data && !p.thought)?.inlineData;
    if (!img?.data) {
      const reason = cand?.finishReason ?? "NO_CANDIDATE";
      const said = cand?.content?.parts?.find((p) => p.text && !p.thought)?.text?.slice(0, 200);
      const detail = `${reason}${cand?.finishMessage ? `: ${cand.finishMessage}` : ""}${said ? ` — model said: ${said}` : ""}`;
      if (POLICY_FINISH.has(reason))
        throw new ProviderError(this.provider, "content_policy", `Gemini refused the image (${detail})`, ctx);
      throw new ProviderError(this.provider, "invalid_response", `Gemini response had no image (${detail})`, {
        ...ctx,
        usage: billed,
      });
    }
    const data = new Uint8Array(Buffer.from(img.data, "base64"));
    let probed: Awaited<ReturnType<typeof probeImage>>;
    try {
      probed = await probeImage(data);
    } catch {
      throw new ProviderError(this.provider, "invalid_response", "Gemini returned an invalid image", {
        ...ctx,
        usage: billed,
      });
    }
    const u = json.usageMetadata ?? {};
    const imageIn = tokens(u.promptTokensDetails, "IMAGE") ?? 0;
    const textIn = tokens(u.promptTokensDetails, "TEXT") ?? Math.max(0, (u.promptTokenCount ?? 0) - imageIn);
    const imageOut = tokens(u.candidatesTokensDetails, "IMAGE") ?? u.candidatesTokenCount ?? 0;
    const textOut = Math.max(0, (u.candidatesTokenCount ?? 0) - imageOut) + (u.thoughtsTokenCount ?? 0);
    return {
      data,
      mime: probed.mime,
      width: probed.width,
      height: probed.height,
      provider: this.provider,
      model: this.model,
      quality: this.opts.imageSize,
      requestId: requestId ?? null,
      latencyMs: Math.round(performance.now() - started),
      usage: {
        textInputTokens: textIn,
        imageInputTokens: imageIn,
        imageOutputTokens: imageOut,
        textOutputTokens: textOut,
        cachedInputTokens: u.cachedContentTokenCount ?? 0,
        raw: u as Record<string, unknown>,
      },
      request: {
        endpoint: `${endpoint} (${op})`,
        size: `${probed.width}x${probed.height} ${aspect.ratio}`,
        referenceCount,
      },
    };
  }
}
