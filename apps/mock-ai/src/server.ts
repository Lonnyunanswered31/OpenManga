/**
 * Mock DeepSeek + OpenAI Images HTTP service for zero-cost testing of the REAL provider code paths.
 * Point DEEPSEEK_BASE_URL=http://mock-ai:4010 and OPENAI_BASE_URL=http://mock-ai:4010/v1.
 *
 * Failure scenarios: put [[mock:<scenario>]] in any prompt/story, or queue one via
 *   POST /__mock/scenario {"target":"text"|"image"|"any","scenario":"429","times":1}
 * Scenarios: 429 500 502 503 timeout reset auth quota policy invalid-json fenced-json schema-invalid repairable bad-image slow
 */
import { createLogger } from "@openmanga/logger";
import {
  MOCK_SCENARIOS,
  type MockScenario,
  mockImagePng,
  mockTextCompletion,
  scenarioFromText,
} from "@openmanga/testing";

const log = createLogger({ service: "mock-ai" });
const port = Number(process.env.MOCK_AI_PORT ?? 4010);
const queued: { target: "text" | "image" | "any"; scenario: MockScenario; times: number }[] = [];
const stats = { text: 0, image: 0, edits: 0, failures: 0, lastImageRequest: null as null | Record<string, unknown> };
/** Remember the last good answer per template so a json-repair call can "fix" it. */
let lastRepairable: unknown = null;

function takeQueued(target: "text" | "image"): MockScenario | null {
  const i = queued.findIndex((q) => q.target === target || q.target === "any");
  if (i < 0) return null;
  const q = queued[i]!;
  q.times--;
  if (q.times <= 0) queued.splice(i, 1);
  return q.scenario;
}

const reqId = () => `mock_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "x-request-id": reqId(), ...headers } });

async function failure(scenario: MockScenario | null, kind: "text" | "image"): Promise<Response | "reset" | null> {
  switch (scenario) {
    case "429":
      return json(
        { error: { message: "Rate limit reached (mock)", type: "rate_limit_error", code: "rate_limit_exceeded" } },
        429,
        { "retry-after": "1" },
      );
    case "500":
    case "502":
    case "503":
      return json({ error: { message: `Mock upstream error ${scenario}`, type: "server_error" } }, Number(scenario));
    case "auth":
      return json(
        {
          error: {
            message: "Incorrect API key provided (mock)",
            type: "invalid_request_error",
            code: "invalid_api_key",
          },
        },
        401,
      );
    case "quota":
      return json({ error: { message: "Insufficient Balance (mock)", type: "insufficient_quota" } }, 402);
    case "policy":
      return kind === "image"
        ? json(
            {
              error: {
                message: "Your request was rejected as a result of our safety system (mock).",
                type: "image_generation_user_error",
                code: "moderation_blocked",
              },
            },
            400,
          )
        : null;
    case "timeout":
      await Bun.sleep(Number(process.env.MOCK_TIMEOUT_MS ?? 400_000));
      return json({ error: { message: "late" } }, 504);
    case "reset":
      return "reset";
    case "slow":
      await Bun.sleep(4000);
      return null;
    default:
      return null;
  }
}

function checkAuth(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") && auth.length > 10;
}

async function chat(req: Request): Promise<Response | "reset"> {
  if (!checkAuth(req)) return json({ error: { message: "Missing bearer token" } }, 401);
  const body = (await req.json()) as {
    model?: string;
    messages?: { role: string; content: string }[];
    response_format?: { type: string };
  };
  const messages = body.messages ?? [];
  const all = messages.map((m) => m.content).join("\n");
  const isRepair = all.includes("[template:json-repair-v1]");
  const scenario = takeQueued("text") ?? scenarioFromText(isRepair ? "" : all);
  stats.text++;
  const fail = await failure(scenario, "text");
  if (fail) {
    stats.failures++;
    return fail;
  }
  let content: string;
  if (isRepair) {
    content = JSON.stringify(lastRepairable ?? {});
  } else {
    const result = mockTextCompletion(messages);
    if (scenario === "invalid-json") content = '{"summary": "unterminated';
    else if (scenario === "fenced-json")
      content = `Sure! Here is the JSON:\n\`\`\`json\n${JSON.stringify(result)}\n\`\`\``;
    else if (scenario === "schema-invalid") {
      content = JSON.stringify({ wrong: true });
      lastRepairable = { wrong: true };
    } else if (scenario === "repairable") {
      content = JSON.stringify({ partial: true });
      lastRepairable = result;
    } else content = JSON.stringify(result);
  }
  const prompt = Math.ceil(all.length / 4);
  const completion = Math.ceil(content.length / 4);
  return json({
    id: reqId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? "deepseek-v4-flash",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
      prompt_cache_hit_tokens: Math.floor(prompt * 0.3),
      prompt_cache_miss_tokens: prompt - Math.floor(prompt * 0.3),
    },
  });
}

function parseSize(size: string | null | undefined) {
  const [w, h] = (size ?? "1024x1024").split("x").map(Number);
  return { width: w || 1024, height: h || 1024 };
}

async function images(req: Request, edit: boolean): Promise<Response | "reset"> {
  if (!checkAuth(req)) return json({ error: { message: "Missing bearer token" } }, 401);
  let prompt = "";
  let size = "1024x1024";
  let model = "gpt-image-2";
  let quality = "low";
  const files: { name: string; size: number; type: string }[] = [];
  let hasMask = false;
  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await req.formData();
    prompt = String(form.get("prompt") ?? "");
    size = String(form.get("size") ?? size);
    model = String(form.get("model") ?? model);
    quality = String(form.get("quality") ?? quality);
    for (const f of form.getAll("image[]"))
      if (f instanceof File) files.push({ name: f.name, size: f.size, type: f.type });
    hasMask = form.get("mask") instanceof File;
  } else {
    const b = (await req.json()) as { prompt?: string; size?: string; model?: string; quality?: string };
    prompt = b.prompt ?? "";
    size = b.size ?? size;
    model = b.model ?? model;
    quality = b.quality ?? quality;
  }
  if (edit) stats.edits++;
  else stats.image++;
  stats.lastImageRequest = {
    endpoint: edit ? "edits" : "generations",
    model,
    quality,
    size,
    files,
    hasMask,
    promptChars: prompt.length,
  };
  const scenario = takeQueued("image") ?? scenarioFromText(prompt);
  const fail = await failure(scenario, "image");
  if (fail) {
    stats.failures++;
    return fail;
  }
  if (!prompt) return json({ error: { message: "prompt is required", type: "invalid_request_error" } }, 400);
  const { width, height } = parseSize(size);
  const label = hasMask ? "MOCK EDIT" : `MOCK ${model} ${quality}`;
  const png =
    scenario === "bad-image"
      ? new TextEncoder().encode("this is not a png")
      : await mockImagePng({
          width,
          height,
          prompt,
          label: `${label} refs:${Math.max(0, files.length - (hasMask ? 1 : 0))}`,
          edited: hasMask,
        });
  const refTokens = files.reduce((s, f) => s + Math.max(65, Math.round(f.size / 40)), 0);
  const text = Math.ceil(prompt.length / 4);
  return json({
    created: Math.floor(Date.now() / 1000),
    data: [{ b64_json: Buffer.from(png).toString("base64") }],
    usage: {
      input_tokens: text + refTokens,
      output_tokens: quality === "low" ? 272 : 1056,
      total_tokens: text + refTokens + 272,
      input_tokens_details: { text_tokens: text, image_tokens: refTokens },
    },
  });
}

const server = Bun.serve({
  port,
  hostname: "0.0.0.0",
  idleTimeout: 0,
  async fetch(req, srv) {
    const url = new URL(req.url);
    let res: Response | "reset";
    try {
      if (url.pathname === "/health") res = json({ ok: true, stats, queued });
      else if (url.pathname === "/__mock/scenario" && req.method === "POST") {
        const b = (await req.json()) as { target?: "text" | "image" | "any"; scenario: MockScenario; times?: number };
        if (!MOCK_SCENARIOS.includes(b.scenario))
          res = json({ error: `unknown scenario; use one of ${MOCK_SCENARIOS.join(", ")}` }, 400);
        else {
          queued.push({ target: b.target ?? "any", scenario: b.scenario, times: b.times ?? 1 });
          res = json({ ok: true, queued });
        }
      } else if (url.pathname === "/__mock/reset" && req.method === "POST") {
        queued.length = 0;
        res = json({ ok: true });
      } else if (
        req.method === "POST" &&
        (url.pathname === "/chat/completions" || url.pathname === "/v1/chat/completions")
      )
        res = await chat(req);
      else if (req.method === "POST" && url.pathname === "/v1/images/generations") res = await images(req, false);
      else if (req.method === "POST" && url.pathname === "/v1/images/edits") res = await images(req, true);
      else res = json({ error: { message: "not found" } }, 404);
    } catch (e) {
      log.error("mock error", { error: e instanceof Error ? e.message : String(e) });
      res = json({ error: { message: "mock internal error" } }, 500);
    }
    if (res === "reset") {
      srv.timeout(req, 1);
      await Bun.sleep(1500);
      return new Response(null, { status: 502 });
    }
    return res;
  },
});
log.info("mock-ai listening", { port: server.port });
