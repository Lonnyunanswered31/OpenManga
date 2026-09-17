import { describe, expect, test } from "bun:test";
import { ProviderError } from "@openmanga/domain";
import { mockImagePng } from "@openmanga/testing";
import {
  FakeImageAIProvider,
  GeminiImageProvider,
  geminiAspectFor,
  MetaImageProvider,
  OpenAIImageProvider,
  OpenRouterImageProvider,
} from "./index.ts";

const sizes = [
  { width: 1024, height: 1024 },
  { width: 1536, height: 1024 },
  { width: 1024, height: 1536 },
];

async function okResponse() {
  const png = await mockImagePng({ width: 64, height: 64, prompt: "x" });
  return new Response(
    JSON.stringify({
      data: [{ b64_json: Buffer.from(png).toString("base64") }],
      usage: { input_tokens: 300, output_tokens: 272, input_tokens_details: { text_tokens: 200, image_tokens: 100 } },
    }),
    { headers: { "x-request-id": "req_img_1" } },
  );
}

function capture(responses: (() => Promise<Response> | Response)[]) {
  const seen: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const f = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return responses[Math.min(i++, responses.length - 1)]!();
  }) as unknown as typeof fetch;
  return { f, seen };
}

const make = (f: typeof fetch) =>
  new OpenAIImageProvider({
    apiKey: "sk-x",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-image-2",
    quality: "low",
    sizes,
    timeoutMs: 5000,
    maxConcurrency: 2,
    retries: 1,
    fetch: f,
  });

describe("OpenAIImageProvider", () => {
  test("a 200 with no usable image still reports what the provider billed", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          data: [{}],
          usage: {
            input_tokens: 120,
            output_tokens: 200,
            input_tokens_details: { image_tokens: 100, text_tokens: 20 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    const provider = make(fetchImpl);
    try {
      await provider.generate({ prompt: "x", aspectRatio: 1, references: [] });
      throw new Error("expected a failure");
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      const err = e as ProviderError;
      expect(err.code).toBe("invalid_response");
      // The call was answered and charged, so the tokens travel with the error for the worker to record.
      expect(err.usage).toEqual({ textInputTokens: 20, imageInputTokens: 100, imageOutputTokens: 200 });
    }
  });

  test("generation without refs uses JSON /images/generations with gpt-image-2 low", async () => {
    const { f, seen } = capture([okResponse]);
    const r = await make(f).generate({ prompt: "a panel", aspectRatio: 1.6, references: [] });
    expect(seen[0]!.url).toBe("https://api.openai.com/v1/images/generations");
    const body = JSON.parse(String(seen[0]!.init.body));
    expect(body).toMatchObject({ model: "gpt-image-2", quality: "low", size: "1536x1024" });
    expect(r.requestId).toBe("req_img_1");
    expect(r.usage).toMatchObject({ textInputTokens: 200, imageInputTokens: 100, imageOutputTokens: 272 });
  });

  test("generation with refs uses multipart edits and sends each small ref", async () => {
    const { f, seen } = capture([okResponse]);
    const ref = await mockImagePng({ width: 160, height: 80, prompt: "ref" });
    await make(f).generate({
      prompt: "p",
      aspectRatio: 1,
      references: [
        { data: ref, mime: "image/png", label: "c1" },
        { data: ref, mime: "image/png", label: "l1" },
      ],
    });
    expect(seen[0]!.url).toEndWith("/images/edits");
    const form = seen[0]!.init.body as FormData;
    expect(form.getAll("image[]")).toHaveLength(2);
    expect(form.get("model")).toBe("gpt-image-2");
    expect(form.get("quality")).toBe("low");
  });

  test("edit sends full-size target first, then refs, and mask", async () => {
    const { f, seen } = capture([okResponse]);
    const target = await mockImagePng({ width: 1536, height: 1024, prompt: "t" });
    const mask = await mockImagePng({ width: 1536, height: 1024, prompt: "m" });
    const ref = await mockImagePng({ width: 160, height: 80, prompt: "r" });
    await make(f).edit({
      prompt: "fix",
      target: { data: target, mime: "image/png", label: "t" },
      mask: { data: mask, mime: "image/png", label: "m" },
      references: [{ data: ref, mime: "image/png", label: "r" }],
    });
    const form = seen[0]!.init.body as FormData;
    const images = form.getAll("image[]") as File[];
    expect(images[0]!.size).toBe(target.byteLength);
    expect(images[1]!.size).toBe(ref.byteLength);
    expect((form.get("mask") as File).size).toBe(mask.byteLength);
    expect(form.get("size")).toBe("1536x1024");
  });

  test("policy rejection is not retried", async () => {
    const { f, seen } = capture([
      () =>
        new Response(
          JSON.stringify({
            error: { code: "moderation_blocked", message: "Your request was rejected by the safety system" },
          }),
          { status: 400 },
        ),
    ]);
    await expect(make(f).generate({ prompt: "p", aspectRatio: 1, references: [] })).rejects.toMatchObject({
      code: "content_policy",
      retryable: false,
    });
    expect(seen).toHaveLength(1);
  });

  test("5xx retried; invalid image response classified", async () => {
    const { f, seen } = capture([() => new Response("oops", { status: 502 }), okResponse]);
    await make(f).generate({ prompt: "p", aspectRatio: 1, references: [] });
    expect(seen).toHaveLength(2);
    const bad = capture([
      () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("not an image").toString("base64") }] })),
    ]);
    const p = new OpenAIImageProvider({
      apiKey: "k",
      baseUrl: "http://x",
      model: "gpt-image-2",
      quality: "low",
      sizes,
      timeoutMs: 1000,
      maxConcurrency: 1,
      retries: 0,
      fetch: bad.f,
    });
    await expect(p.generate({ prompt: "p", aspectRatio: 1, references: [] })).rejects.toMatchObject({
      code: "invalid_response",
    });
  }, 20000);

  test("429 honors retry-after", async () => {
    const { f, seen } = capture([
      () => new Response("{}", { status: 429, headers: { "retry-after": "0" } }),
      okResponse,
    ]);
    await make(f).generate({ prompt: "p", aspectRatio: 1, references: [] });
    expect(seen).toHaveLength(2);
  }, 20000);
});

describe("FakeImageAIProvider", () => {
  test("produces valid PNG at provider size and supports scenarios", async () => {
    const p = new FakeImageAIProvider();
    const r = await p.generate({ prompt: "panel", aspectRatio: 0.6, references: [], label: "panel 1" });
    expect([r.width, r.height]).toEqual([1024, 1536]);
    await expect(p.generate({ prompt: "x [[mock:policy]]", aspectRatio: 1, references: [] })).rejects.toMatchObject({
      code: "content_policy",
    });
  });
});

describe("GeminiImageProvider", () => {
  const png = () => mockImagePng({ width: 64, height: 96, prompt: "g" });
  const ok = async () =>
    new Response(
      JSON.stringify({
        responseId: "gem_1",
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: "image/png", data: Buffer.from(await png()).toString("base64") } }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 600,
          candidatesTokenCount: 1120,
          thoughtsTokenCount: 30,
          promptTokensDetails: [
            { modality: "TEXT", tokenCount: 342 },
            { modality: "IMAGE", tokenCount: 258 },
          ],
          candidatesTokensDetails: [{ modality: "IMAGE", tokenCount: 1120 }],
        },
      }),
    );
  const gem = (f: typeof fetch) =>
    new GeminiImageProvider({
      apiKey: "g-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-3.1-flash-lite-image",
      imageSize: "1K",
      timeoutMs: 5000,
      maxConcurrency: 2,
      retries: 1,
      fetch: f,
    });

  test("maps aspect ratios to the nearest supported ratio", () => {
    expect(geminiAspectFor(1).ratio).toBe("1:1");
    expect(geminiAspectFor(2 / 3).ratio).toBe("2:3");
    expect(geminiAspectFor(0.68).ratio).toBe("2:3");
    expect(geminiAspectFor(1.6).ratio).toBe("3:2");
    expect(geminiAspectFor(1.8).ratio).toBe("16:9");
    expect(geminiAspectFor(2.4).ratio).toBe("21:9");
  });

  test("generate sends prompt, labelled inline refs, aspect ratio and parses usage", async () => {
    const { f, seen } = capture([ok]);
    const ref = await mockImagePng({ width: 160, height: 80, prompt: "ref" });
    const r = await gem(f).generate({
      prompt: "a panel",
      aspectRatio: 2 / 3,
      references: [{ data: ref, mime: "image/png", label: "Woo Jin portrait" }],
    });
    expect(seen[0]!.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-image:generateContent",
    );
    expect((seen[0]!.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("g-key");
    const body = JSON.parse(String(seen[0]!.init.body));
    expect(body.generationConfig).toEqual({
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "2:3", imageSize: "1K" },
    });
    const parts = body.contents[0].parts;
    expect(parts[0].text).toBe("a panel");
    expect(parts[1].text).toContain("Woo Jin portrait");
    expect(Buffer.from(parts[2].inlineData.data, "base64").equals(Buffer.from(ref))).toBe(true);
    expect(r).toMatchObject({ provider: "google", requestId: "gem_1", quality: "1K" });
    expect(r.usage).toMatchObject({
      textInputTokens: 342,
      imageInputTokens: 258,
      imageOutputTokens: 1120,
      textOutputTokens: 30,
    });
  });

  test("edit sends the full-res target and mask before refs", async () => {
    const { f, seen } = capture([ok]);
    const target = await mockImagePng({ width: 1024, height: 1536, prompt: "t" });
    const mask = await mockImagePng({ width: 1024, height: 1536, prompt: "m" });
    await gem(f).edit({
      prompt: "fix hand",
      target: { data: target, mime: "image/png", label: "target" },
      mask: { data: mask, mime: "image/png", label: "mask" },
      references: [],
    });
    const body = JSON.parse(String(seen[0]!.init.body));
    const imgs = body.contents[0].parts.filter((p: { inlineData?: unknown }) => p.inlineData);
    expect(imgs).toHaveLength(2);
    expect(Buffer.from(imgs[0].inlineData.data, "base64").byteLength).toBe(target.byteLength);
    expect(body.generationConfig.imageConfig.aspectRatio).toBe("2:3");
  });

  test("safety blocks are non-retryable content_policy", async () => {
    const blocked = () =>
      new Response(JSON.stringify({ candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }] }));
    const { f, seen } = capture([blocked]);
    const e = await gem(f)
      .generate({ prompt: "x", aspectRatio: 1, references: [] })
      .catch((x) => x);
    expect(e.code).toBe("content_policy");
    expect(seen).toHaveLength(1);
    const pf = () => new Response(JSON.stringify({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }));
    expect(
      (
        await gem(capture([pf]).f)
          .generate({ prompt: "x", aspectRatio: 1, references: [] })
          .catch((x) => x)
      ).code,
    ).toBe("content_policy");
  });

  test("429 retries then succeeds; bad key is auth; missing image is invalid_response", async () => {
    const limited = () =>
      new Response(JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "slow down" } }), {
        status: 429,
        headers: { "retry-after": "0" },
      });
    const { f, seen } = capture([limited, ok]);
    const r = await gem(f).generate({ prompt: "x", aspectRatio: 1, references: [] });
    expect(seen).toHaveLength(2);
    expect(r.requestId).toBe("gem_1");

    const bad = () =>
      new Response(
        JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid." } }),
        {
          status: 400,
        },
      );
    expect(
      (
        await gem(capture([bad]).f)
          .generate({ prompt: "x", aspectRatio: 1, references: [] })
          .catch((x) => x)
      ).code,
    ).toBe("auth");
    const textOnly = () =>
      new Response(
        JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "I can't" }] } }] }),
      );
    const e = await gem(capture([textOnly]).f)
      .generate({ prompt: "x", aspectRatio: 1, references: [] })
      .catch((x) => x);
    expect(e.code).toBe("invalid_response");
    expect(e.message).toContain("I can't");
  });
});

describe("MetaImageProvider and OpenRouterImageProvider", () => {
  const b64 = async () => Buffer.from(await mockImagePng({ width: 64, height: 96, prompt: "m" })).toString("base64");
  const cap = (make: () => Promise<Response>) => {
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init.body)) });
      return make();
    }) as unknown as typeof fetch;
    return { f, seen };
  };
  const opts = (f: typeof fetch, baseUrl: string, model: string) => ({
    apiKey: "k-12345678",
    baseUrl,
    model,
    timeoutMs: 5000,
    maxConcurrency: 1,
    retries: 0,
    fetch: f,
  });

  test("Meta: text-only uses generations; references and edits use /images/edits with data URLs", async () => {
    const ok = async () =>
      new Response(
        JSON.stringify({ data: [{ b64_json: await b64() }], usage: { input_tokens: 30, output_tokens: 4 } }),
      );
    const { f, seen } = cap(ok);
    const p = new MetaImageProvider(opts(f, "https://api.meta.ai/v1", "muse-image-1.0"), sizes);
    const r = await p.generate({ prompt: "a fox", aspectRatio: 2 / 3, references: [] });
    expect(seen[0]!.url).toBe("https://api.meta.ai/v1/images/generations");
    expect(seen[0]!.body).toMatchObject({ model: "muse-image-1.0", size: "1024x1536", response_format: "b64_json" });
    expect(r).toMatchObject({ provider: "meta", model: "muse-image-1.0" });
    const ref = await mockImagePng({ width: 32, height: 32, prompt: "r" });
    await p.generate({ prompt: "p", aspectRatio: 1, references: [{ data: ref, mime: "image/png", label: "hero" }] });
    expect(seen[1]!.url).toBe("https://api.meta.ai/v1/images/edits");
    const images = seen[1]!.body.images as { image_url: string }[];
    expect(images[0]!.image_url.startsWith("data:image/png;base64,")).toBe(true);
    expect(String(seen[1]!.body.prompt)).toContain("hero");
    const target = await mockImagePng({ width: 64, height: 96, prompt: "t" });
    await p.edit({
      prompt: "fix",
      target: { data: target, mime: "image/png", label: "t" },
      mask: { data: target, mime: "image/png", label: "m" },
      references: [],
    });
    expect((seen[2]!.body.images as unknown[]).length).toBe(2);
    expect(String(seen[2]!.body.prompt)).toContain("mask");
    // Muse's prompt policy softens unambiguous body-harm words and reports them; ambiguous ones are left alone
    const soft = await p.generate({
      prompt: "gaunt man with a burn scar, wound up tight",
      aspectRatio: 1,
      references: [],
    });
    expect(String(seen[3]!.body.prompt)).toBe("lean man with a small faded mark, wound up tight");
    expect(soft.softened).toEqual(["gaunt", "burn scar"]);
  });

  test("OpenRouter: chat completions with image modality; missing image is classified", async () => {
    const img = await b64();
    const { f, seen } = cap(
      async () =>
        new Response(
          JSON.stringify({
            id: "gen-1",
            choices: [{ message: { content: "", images: [{ image_url: { url: `data:image/png;base64,${img}` } }] } }],
            usage: { prompt_tokens: 12, completion_tokens: 1290, cost: 0.039 },
          }),
        ),
    );
    const p = new OpenRouterImageProvider(opts(f, "https://openrouter.ai/api/v1", "google/gemini-2.5-flash-image"));
    const r = await p.generate({ prompt: "x", aspectRatio: 16 / 9, references: [] });
    expect(seen[0]!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(seen[0]!.body).toMatchObject({ modalities: ["image", "text"], image_config: { aspect_ratio: "16:9" } });
    expect(r).toMatchObject({ provider: "openrouter", requestId: "gen-1" });
    const none = cap(
      async () =>
        new Response(JSON.stringify({ choices: [{ finish_reason: "content_filter", message: { content: "no" } }] })),
    );
    const e = await new OpenRouterImageProvider(opts(none.f, "https://openrouter.ai/api/v1", "m"))
      .generate({ prompt: "x", aspectRatio: 1, references: [] })
      .catch((x) => x);
    expect(e.code).toBe("content_policy");
    const meta = cap(
      async () =>
        new Response(
          JSON.stringify({
            error: { message: "The response was filtered due to the prompt triggering our content management policy." },
          }),
          { status: 400 },
        ),
    );
    const me = await new MetaImageProvider(opts(meta.f, "https://api.meta.ai/v1", "muse-image-1.0"), sizes)
      .generate({ prompt: "x", aspectRatio: 1, references: [] })
      .catch((x) => x);
    expect([me.code, me.retryable]).toEqual(["content_policy", false]);
  });
});
