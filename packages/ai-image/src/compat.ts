import {
  ConcurrencyLimiter,
  classifyFetchError,
  classifyHttpStatus,
  ProviderError,
  parseRetryAfter,
  refuseRedirect,
  softenText,
  withRetry,
} from "@openmanga/domain/browser";
import { chooseImageDimensions, probeImage, type SizeOption } from "@openmanga/image-utils";
import type { Logger } from "@openmanga/logger";
import { geminiAspectFor } from "./gemini.ts";
import type { EditImageRequest, GenerateImageRequest, ImageAIProvider, ImageInputFile, ImageResult } from "./index.ts";

type BaseOpts = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxConcurrency: number;
  retries?: number;
  logger?: Logger;
  fetch?: typeof fetch;
};

const dataUrl = (f: ImageInputFile) => `data:${f.mime};base64,${Buffer.from(f.data).toString("base64")}`;
const MASK_NOTE =
  "An edit mask follows the image to edit: only change the areas that are transparent in the mask; keep everything else unchanged.";

/** Shared JSON POST with retry, limiter and error classification for OpenAI-shaped image APIs. */
abstract class JsonImageProvider implements ImageAIProvider {
  abstract readonly provider: string;
  protected abstract readonly label: string;
  readonly model: string;
  private readonly limiter: ConcurrencyLimiter;

  constructor(protected readonly opts: BaseOpts) {
    if (!opts.apiKey) throw new Error("Image provider API key is not configured");
    this.model = opts.model;
    this.limiter = new ConcurrencyLimiter(opts.maxConcurrency);
  }

  abstract sizeFor(aspectRatio: number): SizeOption;
  abstract generate(input: GenerateImageRequest): Promise<ImageResult>;
  abstract edit(input: EditImageRequest): Promise<ImageResult>;

  protected post<T>(path: string, body: unknown, signal?: AbortSignal) {
    return withRetry(() => this.limiter.run(() => this.once<T>(path, body, signal)), {
      retries: this.opts.retries ?? 2,
      baseMs: 2000,
      onRetry: (e, attempt, delay) => {
        if (e.code === "rate_limited") this.limiter.cooldown(delay);
        this.opts.logger?.warn(`${this.provider} image retry`, { code: e.code, attempt, delayMs: Math.round(delay) });
      },
    });
  }

  private async once<T>(path: string, body: unknown, signal?: AbortSignal) {
    const started = performance.now();
    const s = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(this.opts.timeoutMs)])
      : AbortSignal.timeout(this.opts.timeoutMs);
    let res: Response;
    try {
      res = await (this.opts.fetch ?? fetch)(`${this.opts.baseUrl.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify(body),
        signal: s,
        redirect: "manual",
      });
    } catch (e) {
      throw classifyFetchError(this.provider, e);
    }
    refuseRedirect(this.provider, res);
    const requestId = res.headers.get("x-request-id") ?? undefined;
    let text: string;
    try {
      text = await res.text();
    } catch (e) {
      throw classifyFetchError(this.provider, e);
    }
    let json: Record<string, unknown> & { error?: { message?: string; code?: string | number; type?: string } } = {};
    try {
      json = JSON.parse(text);
    } catch {
      if (res.ok)
        throw new ProviderError(this.provider, "invalid_response", `${this.label} returned non-JSON`, { requestId });
    }
    if (!res.ok) {
      const msg = json.error?.message ?? text.slice(0, 300);
      const policy = /safety|content (management )?policy|content_filter|moderation|prohibited|refus/i.test(
        `${json.error?.code} ${json.error?.type} ${msg}`,
      );
      throw new ProviderError(
        this.provider,
        policy ? "content_policy" : classifyHttpStatus(res.status),
        `${this.label} HTTP ${res.status}: ${msg}`,
        { status: res.status, retryAfterMs: parseRetryAfter(res.headers.get("retry-after")), requestId },
      );
    }
    return { json: json as T, requestId: requestId ?? null, latencyMs: Math.round(performance.now() - started) };
  }

  protected async finish(
    b64: string | undefined,
    meta: { requestId: string | null; latencyMs: number; endpoint: string; referenceCount: number; quality: string },
    usage: ImageResult["usage"],
  ): Promise<ImageResult> {
    // The request was answered, so it was billed: carry what it cost even when the answer is unusable.
    if (!b64)
      throw new ProviderError(this.provider, "invalid_response", `${this.label} response had no image`, {
        requestId: meta.requestId ?? undefined,
        usage,
      });
    const data = new Uint8Array(Buffer.from(b64, "base64"));
    let probed: Awaited<ReturnType<typeof probeImage>>;
    try {
      probed = await probeImage(data);
    } catch {
      throw new ProviderError(this.provider, "invalid_response", `${this.label} returned an invalid image`, {
        requestId: meta.requestId ?? undefined,
        usage,
      });
    }
    return {
      data,
      mime: probed.mime,
      width: probed.width,
      height: probed.height,
      provider: this.provider,
      model: this.model,
      quality: meta.quality,
      requestId: meta.requestId,
      latencyMs: meta.latencyMs,
      usage,
      request: {
        endpoint: meta.endpoint,
        size: `${probed.width}x${probed.height}`,
        referenceCount: meta.referenceCount,
      },
    };
  }
}

type MetaImagesResponse = {
  data?: { b64_json?: string }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { image_tokens?: number; text_tokens?: number };
  };
};

/**
 * Meta Model API Muse Image (OpenAI-shaped images endpoints). Muse's moderator is the strictest we use, so its
 * prompt policy softens unambiguous body-harm words ("gaunt", "burn scar") before sending; see content-lint. `size` only sets the aspect ratio; reference
 * images and edit targets go through /images/edits as data URLs. There is no mask parameter, so masks are
 * sent as an extra image with an instruction.
 */
export class MetaImageProvider extends JsonImageProvider {
  readonly provider = "meta";
  protected readonly label = "Meta";

  constructor(
    opts: BaseOpts,
    private readonly sizes: SizeOption[],
  ) {
    super(opts);
  }

  sizeFor(aspectRatio: number) {
    return chooseImageDimensions(aspectRatio, this.sizes);
  }

  private usage(u: MetaImagesResponse["usage"] = {}) {
    const imageIn = u.input_tokens_details?.image_tokens ?? 0;
    return {
      textInputTokens: u.input_tokens_details?.text_tokens ?? Math.max(0, (u.input_tokens ?? 0) - imageIn),
      imageInputTokens: imageIn,
      imageOutputTokens: u.output_tokens ?? 0,
      cachedInputTokens: 0,
      raw: u as Record<string, unknown>,
    };
  }

  async generate(input: GenerateImageRequest) {
    const size = this.sizeFor(input.aspectRatio);
    const common = {
      model: this.model,
      n: 1,
      size: `${size.width}x${size.height}`,
      response_format: "b64_json",
      output_format: "png",
    };
    const refs = input.references;
    const policy = softenText(input.prompt);
    const prompt = refs.length
      ? `${policy.text}\n\n${refs.map((r, i) => `Reference image ${i + 1}: ${r.label}`).join("\n")}`
      : policy.text;
    const endpoint = refs.length ? "/images/edits" : "/images/generations";
    const r = await this.post<MetaImagesResponse>(
      endpoint,
      refs.length ? { ...common, prompt, images: refs.map((f) => ({ image_url: dataUrl(f) })) } : { ...common, prompt },
      input.signal,
    );
    const out = await this.finish(
      r.json.data?.[0]?.b64_json,
      { ...r, endpoint, referenceCount: refs.length, quality: "standard" },
      this.usage(r.json.usage),
    );
    return policy.replaced.length ? { ...out, softened: policy.replaced } : out;
  }

  async edit(input: EditImageRequest) {
    const { width, height } = await probeImage(input.target.data);
    const size = this.sizeFor(width / height);
    const images = [input.target, ...(input.mask ? [{ ...input.mask, mime: "image/png" }] : []), ...input.references];
    const policy = softenText(input.prompt);
    const prompt = [
      policy.text,
      "Image 1 is the image to edit; keep its composition and everything outside the edit region unchanged.",
      input.mask ? `Image 2 is the edit mask. ${MASK_NOTE}` : "",
      ...input.references.map((r, i) => `Image ${i + (input.mask ? 3 : 2)}: reference — ${r.label}`),
    ]
      .filter(Boolean)
      .join("\n");
    const r = await this.post<MetaImagesResponse>(
      "/images/edits",
      {
        model: this.model,
        prompt,
        n: 1,
        size: `${size.width}x${size.height}`,
        response_format: "b64_json",
        output_format: "png",
        images: images.map((f) => ({ image_url: dataUrl(f) })),
      },
      input.signal,
    );
    const out = await this.finish(
      r.json.data?.[0]?.b64_json,
      { ...r, endpoint: "/images/edits", referenceCount: input.references.length, quality: "standard" },
      this.usage(r.json.usage),
    );
    return policy.replaced.length ? { ...out, softened: policy.replaced } : out;
  }
}

type OpenRouterChatResponse = {
  id?: string;
  choices?: {
    finish_reason?: string | null;
    message?: { content?: string | null; images?: { image_url?: { url?: string } }[] };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; [k: string]: unknown };
};

/** OpenRouter image models through chat completions with `modalities: ["image","text"]`. */
export class OpenRouterImageProvider extends JsonImageProvider {
  readonly provider = "openrouter";
  protected readonly label = "OpenRouter";

  sizeFor(aspectRatio: number) {
    const a = geminiAspectFor(aspectRatio);
    return { width: a.width, height: a.height };
  }

  private async call(
    parts: ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[],
    aspectRatio: number,
    referenceCount: number,
    signal?: AbortSignal,
  ) {
    const r = await this.post<OpenRouterChatResponse>(
      "/chat/completions",
      {
        model: this.model,
        messages: [{ role: "user", content: parts }],
        modalities: ["image", "text"],
        image_config: { aspect_ratio: geminiAspectFor(aspectRatio).ratio },
        usage: { include: true },
      },
      signal,
    );
    const choice = r.json.choices?.[0];
    const url = choice?.message?.images?.[0]?.image_url?.url;
    const b64 = url?.startsWith("data:") ? url.slice(url.indexOf(",") + 1) : undefined;
    if (!b64) {
      const said = choice?.message?.content?.slice(0, 200);
      const reason = choice?.finish_reason ?? "no image";
      throw new ProviderError(
        this.provider,
        /content_filter|safety/i.test(reason) ? "content_policy" : "invalid_response",
        `OpenRouter returned no image (${reason}${said ? ` — model said: ${said}` : ""})`,
        { requestId: r.json.id ?? r.requestId ?? undefined },
      );
    }
    const u = r.json.usage ?? {};
    return this.finish(
      b64,
      { ...r, requestId: r.json.id ?? r.requestId, endpoint: "/chat/completions", referenceCount, quality: "standard" },
      {
        textInputTokens: u.prompt_tokens ?? 0,
        imageInputTokens: 0,
        imageOutputTokens: u.completion_tokens ?? 0,
        cachedInputTokens: 0,
        raw: u as Record<string, unknown>,
      },
    );
  }

  generate(input: GenerateImageRequest) {
    return this.call(
      [
        { type: "text", text: input.prompt },
        ...input.references.flatMap((r, i) => [
          { type: "text" as const, text: `Reference image ${i + 1}: ${r.label}` },
          { type: "image_url" as const, image_url: { url: dataUrl(r) } },
        ]),
      ],
      input.aspectRatio,
      input.references.length,
      input.signal,
    );
  }

  async edit(input: EditImageRequest) {
    const { width, height } = await probeImage(input.target.data);
    return this.call(
      [
        { type: "text", text: input.prompt },
        { type: "text", text: "Image to edit (keep composition and everything outside the edit region unchanged):" },
        { type: "image_url", image_url: { url: dataUrl(input.target) } },
        ...(input.mask
          ? [
              { type: "text" as const, text: MASK_NOTE },
              { type: "image_url" as const, image_url: { url: dataUrl({ ...input.mask, mime: "image/png" }) } },
            ]
          : []),
        ...input.references.flatMap((r, i) => [
          { type: "text" as const, text: `Reference image ${i + 1}: ${r.label}` },
          { type: "image_url" as const, image_url: { url: dataUrl(r) } },
        ]),
      ],
      width / height,
      input.references.length,
      input.signal,
    );
  }
}
