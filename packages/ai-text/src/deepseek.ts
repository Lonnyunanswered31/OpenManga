import {
  ConcurrencyLimiter,
  classifyFetchError,
  classifyHttpStatus,
  ProviderError,
  parseRetryAfter,
  refuseRedirect,
  withRetry,
} from "@openmanga/domain/browser";
import type { Logger } from "@openmanga/logger";
import {
  runStructured,
  type StructuredRequest,
  type StructuredResult,
  type TextAIProvider,
  type TextRequest,
  type TextResult,
} from "./index.ts";

type DeepSeekResponse = {
  id?: string;
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    [k: string]: unknown;
  };
  error?: { message?: string; code?: string; type?: string };
};

/** Official DeepSeek API (OpenAI-compatible chat completions). No gateways. */
export class DeepSeekTextProvider implements TextAIProvider {
  readonly provider = "deepseek";
  readonly model: string;
  private readonly limiter: ConcurrencyLimiter;

  constructor(
    private readonly opts: {
      apiKey: string;
      baseUrl: string;
      model: string;
      timeoutMs: number;
      maxConcurrency: number;
      retries?: number;
      logger?: Logger;
      fetch?: typeof fetch;
    },
  ) {
    if (!opts.apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");
    this.model = opts.model;
    this.limiter = new ConcurrencyLimiter(opts.maxConcurrency);
  }

  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    return runStructured(this, req);
  }

  async generateText(req: TextRequest): Promise<TextResult> {
    return withRetry(() => this.limiter.run(() => this.once(req)), {
      retries: this.opts.retries ?? 2,
      onRetry: (e, attempt, delay) => {
        if (e.code === "rate_limited") this.limiter.cooldown(delay);
        this.opts.logger?.warn("deepseek retry", {
          code: e.code,
          attempt,
          delayMs: Math.round(delay),
          providerRequestId: e.requestId,
        });
      },
    });
  }

  private async once(req: TextRequest): Promise<TextResult> {
    if (req.messages.some((m) => m.images?.length))
      throw new ProviderError(
        this.provider,
        "invalid_request",
        "DeepSeek models can't read images; choose a vision model",
        {
          retryable: false,
        },
      );
    const started = performance.now();
    const f = this.opts.fetch ?? fetch;
    const signal = req.signal
      ? AbortSignal.any([req.signal, AbortSignal.timeout(this.opts.timeoutMs)])
      : AbortSignal.timeout(this.opts.timeoutMs);
    let res: Response;
    try {
      res = await f(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: req.temperature ?? (req.json ? 0.3 : 0.7),
          max_tokens: req.maxTokens ?? 8192,
          stream: false,
          ...(req.json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal,
        redirect: "manual",
      });
    } catch (e) {
      throw classifyFetchError(this.provider, e);
    }
    refuseRedirect(this.provider, res);
    const headerRequestId = res.headers.get("x-request-id") ?? res.headers.get("x-ds-trace-id");
    let bodyText: string;
    try {
      bodyText = await res.text();
    } catch (e) {
      throw classifyFetchError(this.provider, e);
    }
    let body: DeepSeekResponse = {};
    try {
      body = JSON.parse(bodyText) as DeepSeekResponse;
    } catch {
      if (res.ok)
        throw new ProviderError(this.provider, "invalid_response", "DeepSeek returned a non-JSON HTTP body", {
          requestId: headerRequestId ?? undefined,
        });
    }
    if (!res.ok) {
      const code = classifyHttpStatus(res.status);
      throw new ProviderError(
        this.provider,
        code,
        `DeepSeek HTTP ${res.status}: ${body.error?.message ?? bodyText.slice(0, 200)}`,
        {
          status: res.status,
          retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
          requestId: headerRequestId ?? undefined,
        },
      );
    }
    const choice = body.choices?.[0];
    const text = choice?.message?.content ?? "";
    const u = body.usage ?? {};
    const latencyMs = Math.round(performance.now() - started);
    if (choice?.finish_reason === "length")
      throw new ProviderError(
        this.provider,
        "invalid_json",
        `DeepSeek output was truncated at the max token limit (${req.maxTokens ?? 8192}); try a shorter input`,
        { requestId: body.id, retryable: false },
      );
    if (!text && !req.json)
      throw new ProviderError(this.provider, "invalid_response", "DeepSeek returned empty content", {
        requestId: body.id,
      });
    return {
      text,
      finishReason: choice?.finish_reason ?? null,
      call: {
        provider: this.provider,
        model: body.model ?? this.model,
        requestId: body.id ?? headerRequestId ?? null,
        purpose: "primary",
        inputTokens: u.prompt_tokens ?? 0,
        outputTokens: u.completion_tokens ?? 0,
        cachedTokens: u.prompt_cache_hit_tokens ?? 0,
        latencyMs,
        rawUsage: u as Record<string, unknown>,
        success: true,
      },
    };
  }
}
