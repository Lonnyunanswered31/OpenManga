import { expect, test } from "bun:test";
import { effectiveCredential } from "./AiPicker.tsx";

const cred = (id: string, kind: string) => ({
  id,
  kind,
  label: id,
  baseUrl: null,
  keyHint: "…1234",
  lastUsedAt: null,
  createdAt: "",
});
// biome-ignore lint/suspicious/noExplicitAny: test doubles for the API payload
const opts = (creds: unknown[], defaults: unknown) => ({ credentials: creds, defaults, mockMode: false }) as any;
const choice = { credentialId: null, model: "" };
const noDefaults = { text: null, image: null, tts: { provider: "kokoro" } };

test("falls back to the first capable key when the server has no default", () => {
  // biome-ignore lint/suspicious/noExplicitAny: see above
  const o = opts([cred("a", "deepseek"), cred("b", "openai")] as any, noDefaults);
  expect(effectiveCredential("image", choice, o)?.id).toBe("b");
  expect(effectiveCredential("text", choice, o)?.id).toBe("a");
});

test("keeps the remembered key, and picks nothing when a server default exists", () => {
  // biome-ignore lint/suspicious/noExplicitAny: see above
  const creds = [cred("a", "deepseek"), cred("b", "openai")] as any;
  expect(effectiveCredential("image", { credentialId: "b", model: "" }, opts(creds, noDefaults))?.id).toBe("b");
  const demo = { ...noDefaults, image: { provider: "openai", model: "gpt-image-2", quality: "low" } };
  expect(effectiveCredential("image", choice, opts(creds, demo))).toBeNull();
  expect(effectiveCredential("image", choice, undefined)).toBeNull();
});
