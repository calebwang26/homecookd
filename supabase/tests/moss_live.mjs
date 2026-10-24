// Live check of our Moss setup, read-only: the project credentials list the project's indexes (control
// plane), Moss Inference accepts the same credentials the way POST /moss/ask sends them (api/moss.ts),
// and a wrong key is refused. Dependency-free (Node 20+). Prints PASS / FAIL lines; exits 1 on any FAIL.
// Never prints the key.
//
//   node supabase/tests/moss_live.mjs     # MOSS_PROJECT_ID / MOSS_PROJECT_KEY from the env or the repo's gitignored .env

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MANAGE = "https://service.usemoss.dev/v1/manage"; // keep in step with api/moss.ts
const INFERENCE = "https://inference.moss.dev/v1";

const envFile = join(dirname(fileURLToPath(import.meta.url)), "../../.env");
const envLines = existsSync(envFile) ? readFileSync(envFile, "utf8").split("\n") : [];
const fromEnv = (name) => {
  if (process.env[name]) return process.env[name];
  const line = envLines.find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : "";
};
const PROJECT = fromEnv("MOSS_PROJECT_ID");
const KEY = fromEnv("MOSS_PROJECT_KEY");
if (!PROJECT || !KEY) {
  console.error("No MOSS_PROJECT_ID / MOSS_PROJECT_KEY in the environment or .env");
  process.exit(1);
}

let failed = 0;
const check = (ok, name, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};
const manage = (key, body) =>
  fetch(MANAGE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-service-version": "v1", "x-project-key": key },
    body: JSON.stringify({ projectId: PROJECT, ...body }),
  });

// 1. Control plane: list indexes (read-only)
const listRes = await manage(KEY, { action: "listIndexes" });
const list = await listRes.json().catch(() => null);
check(listRes.ok && Array.isArray(list), "listIndexes with project key", `${listRes.status}, ${Array.isArray(list) ? list.length : "?"} indexes`);
if (Array.isArray(list) && list.length) console.log(`     indexes: ${list.map((i) => `${i.name} (${i.status}, ${i.docCount} docs)`).join(", ")}`);

// 2. Inference: same credentials as POST /moss/ask, retrieval off so it needs no index
const chatRes = await fetch(`${INFERENCE}/chat/completions`, {
  method: "POST",
  headers: { Authorization: `Bearer ${PROJECT}:${KEY}`, "Content-Type": "application/json", "X-Moss-Retrieve": "off" },
  body: JSON.stringify({ model: "moss", max_tokens: 10, messages: [{ role: "user", content: "Say ok." }] }),
});
const chat = await chatRes.json().catch(() => ({}));
const reply = chat.choices?.[0]?.message?.content;
check(chatRes.ok && typeof reply === "string", "inference chat with project credentials", `${chatRes.status}${chat.error ? ` ${chat.error.type}` : ""}`);

// 3. A wrong key is refused
const badRes = await manage("moss_not_a_real_key", { action: "listIndexes" });
check(badRes.status === 401 || badRes.status === 403, "wrong key refused", String(badRes.status));

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
