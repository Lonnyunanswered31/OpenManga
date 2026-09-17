import { describe, expect, test } from "bun:test";
import { hashPassword, hashToken, newOpaqueToken, RegisterInput, safeEqual, verifyPassword } from "./index.ts";

describe("password hashing", () => {
  test("argon2id, verify, reject wrong", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });
});

describe("tokens", () => {
  test("opaque tokens are random and hashed with secret", () => {
    const t = newOpaqueToken();
    expect(t.length).toBeGreaterThanOrEqual(43);
    expect(newOpaqueToken()).not.toBe(t);
    expect(hashToken(t, "s1")).not.toBe(hashToken(t, "s2"));
    expect(hashToken(t, "s1")).toBe(hashToken(t, "s1"));
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });
});

describe("registration validation", () => {
  test("normalizes and validates", () => {
    const r = RegisterInput.parse({ username: "  WooJin ", email: "W@Example.com", password: "longenough1" });
    expect(r.username).toBe("woojin");
    expect(r.email).toBe("w@example.com");
    expect(RegisterInput.safeParse({ username: "a", email: "x@y.z", password: "longenough1" }).success).toBe(false);
    expect(RegisterInput.safeParse({ username: "abc", email: "nope", password: "longenough1" }).success).toBe(false);
    expect(RegisterInput.safeParse({ username: "abc", email: "x@y.zz", password: "short" }).success).toBe(false);
    expect(RegisterInput.safeParse({ username: "../etc", email: "x@y.zz", password: "longenough1" }).success).toBe(
      false,
    );
  });
});
