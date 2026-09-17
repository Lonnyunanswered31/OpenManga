import { expect, test } from "bun:test";
import { redact } from "./index.ts";

test("redacts secrets by key and value", () => {
  const r = redact({
    headers: { Authorization: "Bearer abc.def", "x-ok": "fine" },
    note: "key sk-proj-ABCDEFGHIJK used",
    password: "hunter2",
  }) as Record<string, Record<string, string> | string>;
  expect(JSON.stringify(r)).not.toContain("abc.def");
  expect(JSON.stringify(r)).not.toContain("hunter2");
  expect(JSON.stringify(r)).not.toContain("ABCDEFGHIJK");
  expect((r.headers as Record<string, string>)["x-ok"]).toBe("fine");
});
