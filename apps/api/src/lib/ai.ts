import { PROVIDER_CATALOG, ProviderError, type ProviderKind } from "@openmanga/domain";
import { projectBudget } from "@openmanga/services";
import type { Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.ts";
import { ApiError, badRequest, user } from "./http.ts";

/** Per-run provider/model choice sent with generation requests. No credentialId = the mock providers, or a 422. */
export const AiChoiceInput = z
  .object({
    credentialId: z.string().uuid().nullable().default(null),
    /** Recorded next to the run for reporting; a real run's provider comes from the credential it names. */
    provider: z
      .enum(PROVIDER_CATALOG.map((p) => p.kind) as [ProviderKind, ...ProviderKind[]])
      .nullable()
      .optional(),
    model: z.string().trim().max(200).nullable().optional(),
  })
  .nullable()
  .optional();
export type AiChoiceInput = z.infer<typeof AiChoiceInput>;

const isDefault = (ai: AiChoiceInput) => !ai || (!ai.credentialId && !ai.provider && !ai.model?.trim());

/** This build has no shared provider keys: a run needs one of the caller's own, except in the mock demo mode. */
export const credentialsRequired = () =>
  new ApiError(
    422,
    "credentials_required",
    "This server has no shared API keys. Add your own provider key in Account → AI providers and pick it for this run.",
  );

/** Resolves (and validates) a text choice into the provider/model columns and job parameters. */
export async function textRun(c: Context<AppEnv>, ai: AiChoiceInput) {
  const deps = c.get("deps");
  if (isDefault(ai)) {
    if (!deps.providers.text) throw credentialsRequired();
    return { provider: deps.providers.text.provider, model: deps.providers.text.model, parameters: {} };
  }
  try {
    const p = await deps.resolver.text(ai!, user(c).id);
    return {
      provider: p.provider,
      model: p.model,
      parameters: {
        ai: {
          credentialId: ai!.credentialId ?? null,
          provider: ai!.credentialId ? null : (ai!.provider ?? null),
          model: ai!.model?.trim() || p.model,
        },
      },
    };
  } catch (e) {
    if (e instanceof ProviderError) throw badRequest(e.message);
    throw e;
  }
}

/** Validates an image choice up front so a bad key fails the request instead of the queued job. */
export async function checkImageChoice(c: Context<AppEnv>, ai: AiChoiceInput) {
  const mock = c.get("deps").providers.image;
  if (isDefault(ai)) {
    if (!mock) throw credentialsRequired();
    return { provider: mock.provider, model: mock.model };
  }
  try {
    const p = await c.get("deps").resolver.image(ai!, user(c).id);
    return { provider: p.provider, model: p.model };
  } catch (e) {
    if (e instanceof ProviderError) throw badRequest(e.message);
    throw e;
  }
}

/**
 * Resolves a narration voice provider. Default = server Kokoro (503 if disabled). A BYOK provider needs one of its
 * own voices: the requested one, or its first voice.
 */
export async function ttsRun(c: Context<AppEnv>, ai: AiChoiceInput, voice?: string) {
  const deps = c.get("deps");
  let tts: Awaited<ReturnType<typeof deps.resolver.tts>>;
  try {
    tts = await deps.resolver.tts(ai ?? null, user(c).id);
  } catch (e) {
    if (e instanceof ProviderError) throw badRequest(e.message);
    throw e;
  }
  if (!tts) throw new ApiError(503, "tts_disabled", "Narration synthesis is disabled");
  if (!ai?.credentialId) return { provider: tts.provider, voice: null as string | null, options: {} };
  let chosen = voice?.trim() || null;
  if (!chosen) {
    try {
      chosen = (await tts.voices())[0]?.id ?? null;
    } catch (e) {
      if (e instanceof ProviderError) throw badRequest(`Could not load voices: ${e.message}`);
      throw e;
    }
  }
  if (!chosen) throw badRequest("Pick a voice for this provider");
  return {
    provider: tts.provider,
    voice: chosen,
    options: { ai: { credentialId: ai.credentialId, model: ai.model?.trim() || null } },
  };
}

/**
 * Refuses new AI work once a project's budget cap is reached, unless the caller explicitly confirmed going over
 * (header `x-allow-over-budget: 1`, sent by the web client after asking the user).
 */
export async function assertBudget(c: Context<AppEnv>, projectId: string, extraUsd = 0) {
  const b = await projectBudget(c.get("deps").db, projectId);
  if (b.limitUsd === null || c.req.header("x-allow-over-budget") === "1") return b;
  if (b.spentUsd + extraUsd >= b.limitUsd)
    throw new ApiError(
      402,
      "budget_exceeded",
      `This project's AI budget of $${b.limitUsd.toFixed(2)} ${b.exceeded ? "is used up" : "would be exceeded"} ($${b.spentUsd.toFixed(2)} spent${extraUsd ? `, ~$${extraUsd.toFixed(2)} more requested` : ""}${b.unpricedCalls ? `, ${b.unpricedCalls} call${b.unpricedCalls === 1 ? "" : "s"} could not be priced` : ""}). Raise it in Project settings or confirm to go over.`,
      b,
    );
  return b;
}
