import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { assets, eq, generationJobs, generationOutputs, sql } from "@openmanga/db";
import { runGenerationJob } from "../../apps/worker/src/lib/runner.ts";
import { startHarness, type TestClient } from "./harness.ts";

let h: Awaited<ReturnType<typeof startHarness>>;
let alice: TestClient;
let projectId: string;

beforeAll(async () => {
  h = await startHarness();
  alice = h.client();
  await alice.post(
    "/api/auth/register",
    { username: "rec", email: "rec@example.com", password: "recovery-pass-1" },
    201,
  );
  const p = await alice.post<{ project: { id: string } }>("/api/projects", { title: "Recovery" }, 201);
  projectId = p.project.id;
});
afterAll(() => h?.stop());

describe("job redelivery", () => {
  test("a job that already produced its output is finished from it, not run again", async () => {
    // What a worker killed between the provider call and the completion write leaves behind: the job still reads
    // as processing, and the asset it paid for is stored with an output row pointing at it.
    const asset = await h.deps.assets.store({
      projectId,
      ownerUserId: null,
      type: "panel_art",
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      mimeType: "image/png",
    });
    const [job] = await h.deps.db
      .insert(generationJobs)
      .values({
        projectId,
        kind: "panel_generation",
        queue: "image-generation",
        status: "processing",
        priority: 5,
        templateName: "panel-generation",
        templateVersion: 6,
        compiledPrompt: "x",
        provider: "fake",
        model: "fake",
      })
      .returning();
    await h.deps.db.insert(generationOutputs).values({ jobId: job!.id, assetId: asset.id, activated: false });

    let handlerCalls = 0;
    const result = await runGenerationJob(
      h.workerDeps,
      { data: { jobId: job!.id }, queueName: "image-generation", attemptsMade: 1, opts: { attempts: 3 } } as never,
      async () => {
        handlerCalls++;
        return {};
      },
    );

    // The provider is never called again, and the job ends completed rather than failed or stuck.
    expect(handlerCalls).toBe(0);
    expect((result as { recoveredAfterRestart?: boolean })?.recoveredAfterRestart).toBe(true);
    const [after] = await h.deps.db.select().from(generationJobs).where(eq(generationJobs.id, job!.id));
    expect(after!.status).toBe("completed");
    const [stored] = await h.deps.db.select().from(assets).where(eq(assets.id, asset.id));
    expect(stored).toBeTruthy();
  });

  test("a job with no output still runs its handler", async () => {
    const [job] = await h.deps.db
      .insert(generationJobs)
      .values({
        projectId,
        kind: "panel_generation",
        queue: "image-generation",
        status: "processing",
        priority: 5,
        templateName: "panel-generation",
        templateVersion: 6,
        compiledPrompt: "x",
        provider: "fake",
        model: "fake",
      })
      .returning();
    let handlerCalls = 0;
    await runGenerationJob(
      h.workerDeps,
      { data: { jobId: job!.id }, queueName: "image-generation", attemptsMade: 1, opts: { attempts: 3 } } as never,
      async () => {
        handlerCalls++;
        return { ok: true };
      },
    );
    expect(handlerCalls).toBe(1);
    const [after] = await h.deps.db.select().from(generationJobs).where(eq(generationJobs.id, job!.id));
    expect(after!.status).toBe("completed");
    expect(await h.deps.db.execute(sql`select 1`)).toBeTruthy();
  });
});
