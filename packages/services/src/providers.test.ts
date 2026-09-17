import { expect, test } from "bun:test";
import { FakeImageAIProvider } from "@openmanga/ai-image";
import { FakeTextAIProvider } from "@openmanga/ai-text";
import type { AppConfig } from "@openmanga/config";
import type { CredentialService } from "./credentials.ts";
import { MISSING_CREDENTIAL, ProviderResolver } from "./providers.ts";

const cfg = {
  AI_MOCK_MODE: false,
  AI_TEXT_TIMEOUT_MS: 900_000,
  AI_TEXT_MAX_CONCURRENCY: 4,
  AI_IMAGE_TIMEOUT_MS: 300_000,
  AI_IMAGE_MAX_CONCURRENCY: 8,
  IMAGE_QUALITY: "low",
  imageSizes: [{ width: 1024, height: 1024 }],
} as unknown as AppConfig;

test("without a key there is no server provider to fall back to", async () => {
  const r = new ProviderResolver(cfg, {} as CredentialService, undefined, {
    text: null,
    image: null,
    tts: null,
  });
  await expect(r.image({ credentialId: null }, "u1")).rejects.toThrow(MISSING_CREDENTIAL);
  await expect(r.text({ credentialId: null }, "u1")).rejects.toThrow(MISSING_CREDENTIAL);
  // A stored choice from before server keys were removed names a provider; it is still refused.
  await expect(r.image({ credentialId: null, provider: "meta" }, "u1")).rejects.toThrow(MISSING_CREDENTIAL);
  expect(r.defaultImage).toBeNull();
});

test("mock mode still runs with zero keys (the demo path)", async () => {
  const mockCfg = { ...cfg, AI_MOCK_MODE: true } as AppConfig;
  const r = new ProviderResolver(mockCfg, {} as CredentialService, undefined, {
    text: new FakeTextAIProvider(),
    image: new FakeImageAIProvider(),
    tts: null,
  });
  expect((await r.image({ credentialId: null }, "u1"))?.provider).toBe("mock");
  expect((await r.text({ credentialId: null }, "u1"))?.provider).toBe("mock");
});
