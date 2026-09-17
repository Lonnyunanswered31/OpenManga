import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InvalidStorageKeyError,
  LocalAssetStorage,
  newStorageKey,
  sha256File,
  sha256Hex,
  withTempDir,
} from "./index.ts";

const root = await mkdtemp(join(tmpdir(), "mf-storage-"));
afterAll(() => rm(root, { recursive: true, force: true }));

describe("LocalAssetStorage", () => {
  const s = new LocalAssetStorage(root);

  test("put/read/exists/metadata/delete", async () => {
    const key = newStorageKey("panel_art", "png");
    const data = new TextEncoder().encode("hello");
    await s.put(key, data);
    expect(await s.exists(key)).toBe(true);
    expect(new TextDecoder().decode(await s.read(key))).toBe("hello");
    expect((await s.getMetadata(key))?.byteSize).toBe(5);
    await s.delete(key);
    expect(await s.exists(key)).toBe(false);
    await s.delete(key); // idempotent
  });

  test("putFile copies from disk and sha256File matches the in-memory hash", async () => {
    const src = join(root, "src.bin");
    const data = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);
    await Bun.write(src, data);
    const key = newStorageKey("export", "mp4");
    expect((await s.putFile(key, src)).byteSize).toBe(data.byteLength);
    expect(sha256Hex(await s.read(key))).toBe(sha256Hex(data));
    expect(await sha256File(src)).toBe(sha256Hex(data));
  });

  test("rejects traversal and odd keys", async () => {
    for (const bad of ["../etc/passwd", "a/../../b", "/abs", "A/B", "x//y", "", "dir/"]) {
      await expect(s.put(bad, new Uint8Array())).rejects.toBeInstanceOf(InvalidStorageKeyError);
    }
  });

  test("keys are opaque and unique", () => {
    const a = newStorageKey("../evil", "p/n/g");
    expect(a).toMatch(/^evil\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{32}\.png$/);
    expect(newStorageKey("x", "png")).not.toBe(newStorageKey("x", "png"));
  });

  test("sha256", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("temp dir is cleaned up even on failure", async () => {
    let seen = "";
    await expect(
      withTempDir(root, async (d) => {
        seen = d;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await Bun.file(join(seen, "x")).exists()).toBe(false);
  });
});
