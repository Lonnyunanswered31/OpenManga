/** bun admin:create — interactive admin account creation (or pass --username --email --password). */
import { AuthError, AuthService } from "@openmanga/auth";
import { getConfig } from "@openmanga/config";
import { createDb } from "@openmanga/db";
import { z } from "zod";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function ask(q: string, hidden = false): Promise<string> {
  process.stdout.write(q);
  if (hidden && process.stdin.isTTY) process.stdin.setRawMode?.(true);
  let buf = "";
  for await (const chunk of process.stdin) {
    const s = new TextDecoder().decode(chunk as Uint8Array);
    for (const ch of s) {
      if (ch === "\r" || ch === "\n") {
        if (hidden && process.stdin.isTTY) process.stdin.setRawMode?.(false);
        process.stdout.write("\n");
        return buf;
      }
      if (ch === "") process.exit(1);
      if (ch === "") buf = buf.slice(0, -1);
      else buf += ch;
    }
  }
  return buf;
}

const config = getConfig();
const username = arg("username") ?? (await ask("Username: "));
const email = arg("email") ?? (await ask("Email: "));
const password = arg("password") ?? (await ask("Password (min 10 chars): ", true));

const { db, client } = createDb(config.DATABASE_URL, { max: 1 });
try {
  const auth = new AuthService(db, { secret: config.SESSION_SECRET, sessionTtlDays: config.SESSION_TTL_DAYS });
  const u = await auth.createUser({ username, email, password }, "admin");
  console.log(`Admin created: ${u.username} <${u.email}> (${u.id})`);
} catch (e) {
  if (e instanceof AuthError || e instanceof z.ZodError) {
    console.error(
      `Could not create admin: ${e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : e.message}`,
    );
    process.exitCode = 1;
  } else throw e;
} finally {
  await client.end();
  process.exit();
}
