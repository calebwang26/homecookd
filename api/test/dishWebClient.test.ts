// The site's own client against this api, over a real local port: web/src/lib/dish/api.ts as it is today, read from its file with only its import
// of the old base URL replaced, so this says what a URL change alone gets you. What it can't do yet is pinned here too: `uploadFile` and `sendAnswer`
// send raw bytes, and those are the two web/ changes DISH-MIGRATION.md lists. Skipped where web/ isn't there. Models and S3 are fakes.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { db } from "../src/db.js";
import { askedCard, hasDatabase, newBackend, seedSpend, settle, store } from "./dishHelpers.js";

const source = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "src", "lib", "dish", "api.ts");
const skip = !hasDatabase || !existsSync(source);
const scratch = mkdtempSync(join(tmpdir(), "dish-web-client-"));

async function siteClient(base: string) {
  const code = readFileSync(source, "utf8")
    .replace(/import \{ CONVEX_SITE_URL \} from '[^']+';/, `const CONVEX_SITE_URL = ${JSON.stringify(base)};`)
    .replace(/import type \{[^}]+\} from '\.\/types';/, "type Ask = any; type AskItem = any; type Card = any; type Edit = any; type FileKind = any; type QuestionId = any; type Relation = any; type SendVia = any;");
  const file = join(scratch, `client-${Date.now()}.ts`);
  writeFileSync(file, code);
  return await import(file);
}

test("the site's client, unchanged but for its base URL", { skip }, async (t) => {
  const app = await newBackend();
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  const site = await siteClient(base);
  try {
    let kidToken = "";
    let askToken = "";

    await t.test("a card, its guess and the Ask Mom message", async () => {
      const made = await site.createCard({ dish: "mom's tomato egg", relation: "mom", kidName: "Caleb" });
      kidToken = made.kidToken;
      assert.equal(made.card.status, "draft");
      assert.equal(made.card.message, "Mom, how do you make your tomato egg? I'm trying to make it here.");
      askToken = new URL(made.card.askUrl).searchParams.get("t")!;
      assert.ok(site.isPlausibleToken(kidToken) && site.isPlausibleToken(askToken));
    });

    await t.test("get, update, ask, sent: text/plain JSON, no preflight", async () => {
      assert.equal((await site.getCard(kidToken)).dish, "mom's tomato egg");
      assert.equal((await site.updateCard(kidToken, { kidName: "Cal", edits: [{ kind: "ingredient", index: 0, amount: "3" }] })).guess.ingredients[0].amount, "3");
      assert.deepEqual((await site.askQuestions(kidToken, [{ id: "q1", text: "How much ketchup?" }])).asked, [{ id: "q1", text: "How much ketchup?" }]);
      assert.equal((await site.markSent(kidToken, "sms")).status, "asked");
    });

    await t.test("Mom's page: peek, her language, Send with nothing answered", async () => {
      const ask = await site.peekAsk(askToken);
      assert.deepEqual(ask.questions, [{ id: "q1", text: "How much ketchup?" }]);
      assert.equal((await site.peekAsk(askToken, "hi")).inLang.lang, "hi");
      assert.equal((await site.finishAsk(askToken)).finished, false);
    });

    await t.test("errors come back as the kinds its pages switch on", async () => {
      const kind = (p: Promise<unknown>) => p.then(() => "no error", (e: { kind: string }) => e.kind);
      assert.equal(await kind(site.getCard("Z".repeat(22))), "not-found");
      assert.equal(await kind(site.createCard({ dish: "asdf qwerty", relation: "mom" })), "not-a-dish");
      assert.equal(await kind(site.updateCard(kidToken, { message: "fuck this" })), "words");
      await seedSpend(10);
      assert.equal(await kind(site.createCard({ dish: "dal", relation: "mom" })), "budget");
      await seedSpend(0);
      for (let i = 0; i < 5; i++) await site.createCard({ dish: "dal", relation: "mom" }).catch(() => {});
      assert.equal(await kind(site.createCard({ dish: "dal", relation: "mom" })), "rate");
    });

    await t.test("what needs web/ changed: raw bytes are refused until uploadFile and sendAnswer use a link", async () => {
      const kind = (p: Promise<unknown>) => p.then(() => "no error", (e: { kind: string }) => e.kind);
      const blob = new Blob([new Uint8Array(1000)], { type: "image/jpeg" });
      assert.equal(await kind(site.uploadFile("photo", blob, "image/jpeg")), "bad");
      assert.equal(await kind(site.sendAnswer(askToken, "q1", "en", 3, new Blob([new Uint8Array(1000)]), "audio/mp4")), "bad");
      assert.equal(store.objects.size, 0);
    });

    await t.test("Her answer as it would run once they do: link, PUT, answer, then the kid's page", async () => {
      const fresh = await askedCard(app, "192.0.2.90");
      const link = await fetch(`${base}/dish/ask/answer/upload?q=q1&durationS=3`, {
        method: "POST",
        headers: { "Content-Type": "text/plain", "X-Dish-Token": fresh.askToken },
        body: JSON.stringify({ contentType: "audio/mp4", size: 400 }),
      }).then((r) => r.json());
      store.put(link.uploadUrl, new Uint8Array(400).fill(1), "audio/mp4");
      const answered = await fetch(`${base}/dish/ask/answer?q=q1&durationS=3`, {
        method: "POST",
        headers: { "Content-Type": "text/plain", "X-Dish-Token": fresh.askToken },
        body: JSON.stringify({ fileId: link.fileId }),
      }).then((r) => r.json());
      assert.deepEqual(answered.ask.answered, ["q1"]);
      assert.equal((await site.finishAsk(fresh.askToken)).merging, true);
      await settle();
      const card = await site.getCard(fresh.kidToken);
      assert.equal(card.status, "answered");
      assert.equal(card.version.ingredients[2].amount, "two big spoons");
    });
  } finally {
    await app.close();
  }
});

after(async () => {
  rmSync(scratch, { recursive: true, force: true });
  if (hasDatabase) await db().end();
});
