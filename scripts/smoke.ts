/**
 * Deployment smoke test through nginx (same host routing as production).
 * Usage: bun scripts/smoke.ts [baseUrl]   e.g. http://nginx or https://comics.example.com
 * AI steps need a provider key, because this build has no server-held keys. Either point it at an existing
 * account that already has keys (SMOKE_USER + SMOKE_PASSWORD), or give it a key to save (SMOKE_API_KEY, with
 * SMOKE_PROVIDER defaulting to openai), or run against a server in AI_MOCK_MODE. Without any of those the AI
 * steps and everything downstream of them are skipped, and routing, auth, SSE and usage still run.
 * Exercises register/login, story analysis, reference generation + approval, planning, panel generation,
 * masked edit, lettering, narration + TTS, exports, CDN authorization and SSE.
 */
const BASE = (process.argv[2] ?? process.env.SMOKE_BASE_URL ?? "http://localhost:3480").replace(/\/$/, "");
const jar = new Map<string, string>();
let failures = 0;

async function req(method: string, path: string, body?: unknown, opts: { expect?: number; jarless?: boolean } = {}) {
  if (method !== "GET" && !opts.jarless && !jar.has("om_csrf")) await req("GET", "/api/auth/me");
  const headers: Record<string, string> = {};
  if (!opts.jarless && jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  if (method !== "GET" && jar.get("om_csrf")) headers["x-csrf-token"] = jar.get("om_csrf")!;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload, redirect: "manual" });
  if (!opts.jarless)
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(";");
      const i = pair!.indexOf("=");
      const k = pair!.slice(0, i).trim();
      const v = pair!.slice(i + 1);
      if (!v || /max-age=0/i.test(sc)) jar.delete(k);
      else jar.set(k, v);
    }
  if (opts.expect !== undefined && res.status !== opts.expect)
    throw new Error(
      `${method} ${path} -> ${res.status} (expected ${opts.expect}): ${(await res.text()).slice(0, 300)}`,
    );
  if (opts.expect === undefined && res.status >= 400)
    throw new Error(`${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}
const json = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, expect?: number) =>
  (await (await req(method, path, body, { expect })).json()) as T;

async function step(name: string, fn: () => Promise<void>) {
  const t = performance.now();
  try {
    await fn();
    console.log(`✔ ${name} (${Math.round(performance.now() - t)} ms)`);
  } catch (e) {
    failures++;
    console.log(`✘ ${name}: ${e instanceof Error ? e.message : e}`);
  }
}

async function waitJob(id: string, timeoutMs = 120_000) {
  const start = Date.now();
  for (;;) {
    const r = await json<{
      job: { status: string; failureReason: string | null };
      inputs: { role: string; sentAs: string; width: number; height: number }[];
    }>("GET", `/api/generations/${id}`);
    if (["completed", "failed", "cancelled"].includes(r.job.status)) {
      if (r.job.status !== "completed") throw new Error(`job ${id} ${r.job.status}: ${r.job.failureReason}`);
      return r;
    }
    if (Date.now() - start > timeoutMs) throw new Error(`job ${id} timed out`);
    await Bun.sleep(700);
  }
}
async function until<T>(fn: () => Promise<T | null | false | undefined>, label: string, timeoutMs = 180_000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out: ${label}`);
    await Bun.sleep(1000);
  }
}

const suffix = Date.now().toString(36);
const ctx: Record<string, string> = {};

await step("routing: / redirects to /app/, SPA fallback, health", async () => {
  const root = await req("GET", "/", undefined, { expect: 302, jarless: true });
  if (!root.headers.get("location")?.endsWith("/app/")) throw new Error("root redirect missing");
  const app = await (
    await req("GET", "/app/projects/anything/pages/x", undefined, { expect: 200, jarless: true })
  ).text();
  if (!app.includes('<div id="root">')) throw new Error("SPA fallback not served");
  await req("GET", "/healthz", undefined, { expect: 200, jarless: true });
  const ready = await (await req("GET", "/readyz", undefined, { expect: 200, jarless: true })).json();
  console.log(`  readyz: ${JSON.stringify(ready.checks)} kokoro=${ready.optional.kokoro.state}`);
});

const USER = process.env.SMOKE_USER;
const PASSWORD = process.env.SMOKE_PASSWORD;

await step(USER ? "auth: login as an existing account" : "auth: register + login by email", async () => {
  if (USER) {
    await json("POST", "/api/auth/login", { identifier: USER, password: PASSWORD });
    return;
  }
  await json(
    "POST",
    "/api/auth/register",
    { username: `smoke_${suffix}`, email: `smoke_${suffix}@example.com`, password: "smoke-test-password" },
    201,
  );
  await json("POST", "/api/auth/logout");
  await json("POST", "/api/auth/login", { identifier: `smoke_${suffix}@example.com`, password: "smoke-test-password" });
});

/** Per-run provider choice for text and image work; undefined means "whatever the server can run itself" (mock). */
type Choice = { credentialId: string } | undefined;
let textAi: Choice;
let imageAi: Choice;
let skipAi = "";

await step("AI credentials for this run", async () => {
  type Cred = { id: string; kind: string; label: string };
  type Options = {
    mockMode: boolean;
    catalog: { kind: string; textModels: string[]; imageModels: string[] }[];
    credentials: Cred[];
  };
  let o = await json<Options>("GET", "/api/ai/options");
  if (process.env.SMOKE_API_KEY) {
    await json(
      "POST",
      "/api/ai/credentials",
      {
        kind: process.env.SMOKE_PROVIDER ?? "openai",
        label: `smoke ${suffix}`,
        apiKey: process.env.SMOKE_API_KEY,
        baseUrl: process.env.SMOKE_PROVIDER_BASE_URL ?? null,
      },
      201,
    );
    o = await json<Options>("GET", "/api/ai/options");
  }
  const supports = (c: Cred, cap: "text" | "image") =>
    (o.catalog.find((e) => e.kind === c.kind)?.[cap === "text" ? "textModels" : "imageModels"] ?? []).length > 0 ||
    c.kind === "openai_compatible";
  const pick = (cap: "text" | "image"): Choice => {
    const c = o.credentials.find((x) => supports(x, cap));
    return c ? { credentialId: c.id } : undefined;
  };
  textAi = pick("text");
  imageAi = pick("image");
  if (o.mockMode) console.log("  server is in AI_MOCK_MODE: fake providers, no key needed");
  else if (textAi && imageAi) console.log(`  using saved keys (${o.credentials.length} on this account)`);
  else skipAi = "no provider key for text and images on this account, and the server is not in AI_MOCK_MODE";
});

/** A step that cannot run without AI: skipped (not failed) when this deployment has no usable key. */
const aiStep = async (name: string, fn: () => Promise<void>) => {
  if (!skipAi) return step(name, fn);
  console.log(`↷ ${name} (skipped: ${skipAi})`);
};

await step("project + story (no AI calls)", async () => {
  const p = await json<{ project: { id: string } }>(
    "POST",
    "/api/projects",
    {
      title: `Smoke ${suffix}`,
      story: {
        content:
          'Chapter 1\n\nMina ran across the bridge in the rain. Mina saw Jun waiting. "You came," Jun said. Jun handed Mina the old key. The storm roared behind them.',
        inputKind: "story",
      },
    },
    201,
  );
  ctx.projectId = p.project.id;
  const s = await json<{ latest: { id: string } }>("GET", `/api/projects/${ctx.projectId}/story`);
  ctx.revisionId = s.latest.id;
});

await aiStep("story analysis", async () => {
  const a = await json<{ job: { id: string }; analysis: { id: string } }>(
    "POST",
    `/api/story-revisions/${ctx.revisionId}/analyze`,
    { ai: textAi },
    202,
  );
  await waitJob(a.job.id);
  await json("POST", `/api/story-analyses/${a.analysis.id}/apply`, {});
});

await step("SSE stream delivers events through nginx", async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/api/projects/${ctx.projectId}/events`, {
    headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
    signal: ctrl.signal,
  });
  const reader = res.body!.getReader();
  const { value } = await Promise.race([reader.read(), Bun.sleep(5000).then(() => ({ value: undefined }))]);
  ctrl.abort();
  if (!value || !new TextDecoder().decode(value).includes("event: ready")) throw new Error("no SSE ready event");
});

await aiStep("character reference (full-res) + approve -> small derivative", async () => {
  const cast = await json<{ characters: { id: string; name: string; currentVersionId: string }[] }>(
    "GET",
    `/api/projects/${ctx.projectId}/characters`,
  );
  const mina = cast.characters.find((c) => c.name === "Mina") ?? cast.characters[0]!;
  ctx.versionId = mina.currentVersionId;
  const g = await json<{ job: { id: string } }>(
    "POST",
    `/api/character-versions/${ctx.versionId}/references/generate`,
    { kind: "portrait", ai: imageAi },
    202,
  );
  await waitJob(g.job.id);
  const d = await json<{ references: { id: string; asset: { id: string; width: number } }[] }>(
    "GET",
    `/api/characters/${mina.id}`,
  );
  const ref = d.references[0]!;
  const ap = await json<{ derivative: { width: number; height: number } }>("POST", `/api/references/${ref.id}/status`, {
    status: "approved",
  });
  console.log(
    `  canonical ${ref.asset.width}px wide; prompt derivative ${ap.derivative.width}x${ap.derivative.height}`,
  );
  if (ap.derivative.width > 192 || ap.derivative.height > 288) throw new Error("derivative too large");
  ctx.refAssetId = ref.asset.id;
});

await aiStep("chapter planning", async () => {
  const chs = await json<{ chapters: { id: string }[] }>("GET", `/api/projects/${ctx.projectId}/chapters`);
  ctx.chapterId = chs.chapters[0]!.id;
  const j = await json<{ job: { id: string } }>("POST", `/api/chapters/${ctx.chapterId}/plan`, { ai: textAi }, 202);
  await waitJob(j.job.id);
  const ch = await json<{ pages: { id: string }[] }>("GET", `/api/chapters/${ctx.chapterId}`);
  ctx.pageId = ch.pages[0]!.id;
});

await aiStep("panel generation sends small derivatives", async () => {
  const page = await json<{ panels: { id: string }[] }>("GET", `/api/pages/${ctx.pageId}`);
  ctx.panelId = page.panels[0]!.id;
  await json("PATCH", `/api/panels/${ctx.panelId}`, { characterVersionIds: [ctx.versionId] });
  const g = await json<{ job: { id: string } }>("POST", `/api/panels/${ctx.panelId}/generate`, { ai: imageAi }, 202);
  const done = await waitJob(g.job.id);
  const ref = done.inputs.find((i) => i.role === "character_ref");
  // The cap is whatever this server is configured for, not a fixed number.
  const { referenceDefaults: max } = await json<{ referenceDefaults: { maxWidth: number; maxHeight: number } }>(
    "GET",
    "/api/meta",
  );
  if (ref?.sentAs !== "prompt_ref_derivative" || ref.width > max.maxWidth || ref.height > max.maxHeight)
    throw new Error(`unexpected reference input (cap ${max.maxWidth}x${max.maxHeight}): ${JSON.stringify(ref)}`);
});

await aiStep("masked edit (full-res target + mask)", async () => {
  const v = await json<{ activeAssetId: string }>("GET", `/api/panels/${ctx.panelId}/versions`);
  const art = await req("GET", `/cdn/a/${v.activeAssetId}`, undefined, { expect: 200 });
  const bytes = new Uint8Array(await art.arrayBuffer());
  const dv = new DataView(bytes.buffer);
  const w = dv.getUint32(16);
  const h = dv.getUint32(20);
  // Minimal mask: tiny PNG scaled server-side to the target size.
  const { default: sharp } = await import("sharp").catch(() => ({ default: null }));
  let mask: Uint8Array;
  if (sharp)
    mask = new Uint8Array(
      await sharp({ create: { width: w, height: h, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
        .png()
        .toBuffer(),
    );
  else mask = bytes;
  const form = new FormData();
  form.set("file", new File([mask.slice()], "mask.png", { type: "image/png" }));
  const m = (await (await req("POST", `/api/panels/${ctx.panelId}/mask`, form, { expect: 201 })).json()) as {
    asset: { id: string };
  };
  const e = await json<{ job: { id: string } }>(
    "POST",
    `/api/panels/${ctx.panelId}/edit`,
    { maskAssetId: m.asset.id, instruction: "add rain streaks", ai: imageAi },
    202,
  );
  const done = await waitJob(e.job.id);
  if (done.inputs.find((i) => i.role === "target")?.sentAs !== "full_resolution")
    throw new Error("target was not full resolution");
});

await aiStep("lettering (zero image calls)", async () => {
  await json("POST", `/api/pages/${ctx.pageId}/dialogue`, { panelId: ctx.panelId, text: "You came." }, 201);
  await json("POST", `/api/pages/${ctx.pageId}/sfx`, { panelId: ctx.panelId, text: "BOOM" }, 201);
});

await aiStep("narration text + local Kokoro synthesis", async () => {
  const g = await json<{ job: { id: string } }>(
    "POST",
    `/api/chapters/${ctx.chapterId}/narration/generate`,
    { ai: textAi },
    202,
  );
  await waitJob(g.job.id);
  await json("POST", `/api/chapters/${ctx.chapterId}/narration/synthesize`, { onlyMissing: true }, 202);
  const doc = await until(
    async () => {
      const n = await json<{
        lines: {
          segments: {
            audio: { durationMs: number; assetId: string } | null;
            job: { status: string; failureReason: string | null } | null;
          }[];
        }[];
      }>("GET", `/api/chapters/${ctx.chapterId}/narration`);
      const segs = n.lines.flatMap((l) => l.segments);
      const failed = segs.find((s) => s.job?.status === "failed");
      if (failed) throw new Error(`tts failed: ${failed.job?.failureReason}`);
      return segs.length && segs.every((s) => s.audio) ? segs : null;
    },
    "narration audio",
    600_000,
  );
  const audio = await req("GET", `/cdn/a/${doc[0]!.audio!.assetId}`, undefined, { expect: 200 });
  console.log(`  ${doc.length} segments, first ${doc[0]!.audio!.durationMs} ms, ${audio.headers.get("content-type")}`);
});

await aiStep("exports: page PNG, webtoon, PDF, narration, project package", async () => {
  for (const kind of ["png_pages", "webtoon", "pdf", "narration_audio", "zip_package"]) {
    const r = await json<{ job: { id: string } }>(
      "POST",
      `/api/projects/${ctx.projectId}/exports`,
      // Only one panel was generated above, so readiness blocks; a smoke run checks that exports render, not that
      // the project is finished.
      { kind, chapterId: kind === "zip_package" ? null : ctx.chapterId, acknowledgeIssues: true },
      202,
    );
    const job = await until(async () => {
      const l = await json<{
        jobs: {
          id: string;
          status: string;
          failureReason: string | null;
          files: { assetId: string; fileName: string; byteSize: number }[];
        }[];
      }>("GET", `/api/projects/${ctx.projectId}/exports`);
      const j = l.jobs.find((x) => x.id === r.job.id);
      if (j?.status === "failed") throw new Error(`${kind} failed: ${j.failureReason}`);
      return j?.status === "completed" ? j : null;
    }, `export ${kind}`);
    await req("GET", `/cdn/a/${job.files[0]!.assetId}`, undefined, { expect: 200 });
    console.log(`  ${kind}: ${job.files.map((f) => `${f.fileName} (${Math.round(f.byteSize / 1024)} KB)`).join(", ")}`);
  }
});

await aiStep("asset authorization via X-Accel-Redirect", async () => {
  await req("GET", `/cdn/a/${ctx.refAssetId}`, undefined, { expect: 401, jarless: true });
  const ok = await req("GET", `/cdn/a/${ctx.refAssetId}?v=thumbnail`, undefined, { expect: 200 });
  if (!ok.headers.get("content-type")?.startsWith("image/")) throw new Error("thumbnail not an image");
  await req("GET", "/_protected_assets/character_reference/aa/bb/x.png", undefined, { expect: 404, jarless: true });
});

await aiStep("usage & cost recorded", async () => {
  const u = await json<{ operations: { operation: string }[] }>("GET", `/api/projects/${ctx.projectId}/usage`);
  console.log(`  operations: ${u.operations.map((o) => o.operation).join(", ")}`);
});

// ---- Failure scenarios: only when the mock provider service is reachable (e.g. run on the internal network).
const MOCK = process.env.SMOKE_MOCK_AI_URL;
type FinalJob = {
  job: { status: string; failureCode: string | null; failureReason: string | null; attempts: number };
  usage: { metadata: { purpose?: string } }[];
};
async function finalJob(id: string, timeoutMs = 240_000) {
  return until(
    async () => {
      const r = await json<FinalJob>("GET", `/api/generations/${id}`);
      return ["completed", "failed", "cancelled"].includes(r.job.status) ? r : null;
    },
    `job ${id}`,
    timeoutMs,
  );
}
async function analyzeStory(text: string) {
  const rev = await json<{ revision: { id: string } }>(
    "POST",
    `/api/projects/${ctx.projectId}/story/revisions`,
    { content: text },
    201,
  );
  const a = await json<{ job: { id: string } }>("POST", `/api/story-revisions/${rev.revision.id}/analyze`, {}, 202);
  return finalJob(a.job.id);
}

if (MOCK) {
  await step("transient DeepSeek 429 + 503 are retried and the job completes", async () => {
    await fetch(`${MOCK}/__mock/scenario`, {
      method: "POST",
      body: JSON.stringify({ target: "text", scenario: "429", times: 1 }),
    });
    await fetch(`${MOCK}/__mock/scenario`, {
      method: "POST",
      body: JSON.stringify({ target: "text", scenario: "503", times: 1 }),
    });
    const r = await analyzeStory("Mina ran across the bridge. Mina waited for Jun. Jun arrived late.");
    if (r.job.status !== "completed")
      throw new Error(`expected completed, got ${r.job.status}: ${r.job.failureReason}`);
  });

  await step("DeepSeek auth failure fails fast with a safe message", async () => {
    const r = await analyzeStory("Mina hid. Mina waited. [[mock:auth]]");
    if (r.job.status !== "failed" || r.job.failureCode !== "auth" || r.job.attempts !== 1)
      throw new Error(JSON.stringify(r.job));
    if (/at \w+ \(|\.ts:\d+/.test(r.job.failureReason ?? "")) throw new Error("stack trace leaked");
    console.log(`  ${r.job.failureReason}`);
  });

  await step("malformed JSON fails clearly; repairable JSON succeeds after one repair call", async () => {
    const bad = await analyzeStory("Mina hid. Mina waited. [[mock:invalid-json]]");
    if (bad.job.failureCode !== "invalid_json") throw new Error(JSON.stringify(bad.job));
    const fenced = await analyzeStory("Mina hid. Mina waited. [[mock:fenced-json]]");
    if (fenced.job.status !== "completed") throw new Error("fenced JSON not extracted");
    const ok = await analyzeStory("Mina hid. Mina waited. [[mock:repairable]]");
    const purposes = ok.usage.map((u) => u.metadata.purpose);
    if (ok.job.status !== "completed" || purposes.join(",") !== "primary,repair")
      throw new Error(`${ok.job.status} ${purposes}`);
  });

  await step("OpenAI content-policy rejection is not retried", async () => {
    const c = await json<{ character: { currentVersionId: string } }>(
      "POST",
      `/api/projects/${ctx.projectId}/characters`,
      { name: `Policy ${suffix}`, description: { hair: "red [[mock:policy]]" } },
      201,
    );
    const g = await json<{ job: { id: string } }>(
      "POST",
      `/api/character-versions/${c.character.currentVersionId}/references/generate`,
      { kind: "portrait" },
      202,
    );
    const r = await finalJob(g.job.id);
    if (r.job.status !== "failed" || r.job.failureCode !== "content_policy" || r.job.attempts !== 1)
      throw new Error(JSON.stringify(r.job));
    console.log(`  ${r.job.failureReason}`);
  });

  await step("OpenAI transient 502 then success; invalid image response retried then failed", async () => {
    await fetch(`${MOCK}/__mock/scenario`, {
      method: "POST",
      body: JSON.stringify({ target: "image", scenario: "502", times: 1 }),
    });
    const g = await json<{ job: { id: string } }>("POST", `/api/panels/${ctx.panelId}/generate`, {}, 202);
    const ok = await finalJob(g.job.id);
    if (ok.job.status !== "completed") throw new Error(`expected completed: ${ok.job.failureReason}`);
    const c = await json<{ character: { currentVersionId: string } }>(
      "POST",
      `/api/projects/${ctx.projectId}/characters`,
      { name: `Broken ${suffix}`, description: { hair: "blue [[mock:bad-image]]" } },
      201,
    );
    const b = await json<{ job: { id: string } }>(
      "POST",
      `/api/character-versions/${c.character.currentVersionId}/references/generate`,
      { kind: "portrait" },
      202,
    );
    const bad = await finalJob(b.job.id);
    if (bad.job.status !== "failed" || bad.job.failureCode !== "invalid_response")
      throw new Error(JSON.stringify(bad.job));
    console.log(`  after ${bad.job.attempts} attempts: ${bad.job.failureReason}`);
  });

  await step("cancel a queued job", async () => {
    const g = await json<{ job: { id: string } }>("POST", `/api/panels/${ctx.panelId}/generate`, {}, 202);
    const res = await req("POST", `/api/generations/${g.job.id}/cancel`, {});
    const body = (await res.json()) as { result: string };
    const r = await finalJob(g.job.id);
    console.log(`  cancel result=${body.result}, final status=${r.job.status}`);
    if (!["cancelled", "completed"].includes(r.job.status)) throw new Error(r.job.status);
  });

  await step("Kokoro rejects an unknown voice with a clear error", async () => {
    const res = await req("POST", "/api/tts/preview", { voice: "zz_nobody", speed: 1, text: "hello" }, { expect: 422 });
    console.log(`  status ${res.status}: ${(await res.text()).slice(0, 140)}`);
  });
}

console.log(failures ? `\n${failures} step(s) failed` : "\nAll smoke steps passed");
process.exit(failures ? 1 : 0);
