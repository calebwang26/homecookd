// The site's own client against this api, over a real local port: web/src/lib/dish/api.ts as it is, read from its file with only its import of the
// base URL replaced. Uploads and an answer run end to end, with PUTs routed to the fake store. Skipped where web/ isn't there. Models and S3 are fakes.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { db } from "../src/db.js";
import { FAKE_WORDS } from "../src/modules/dish/model.js";
import { askedCard, clearWindow, hasDatabase, model, newBackend, seedSpend, settle, store } from "./dishHelpers.js";

const source = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "src", "lib", "dish", "api.ts");
const skip = !hasDatabase || !existsSync(source);
const scratch = mkdtempSync(join(tmpdir(), "dish-web-client-"));

// The site's switch for this api's links (web/next.config.ts compiles it in; here its code reads it at each call).
process.env.NEXT_PUBLIC_DISH_UPLOADS = "links";

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
  // S3 is the fake store: PUTs to its links land there, and everything else goes to the real local port.
  const puts: { contentType: string; size: number }[] = [];
  const calls: { url: string; contentType: string; hasDishHeader: boolean }[] = [];
  let putAnswer: null | (() => Response) = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url.startsWith("https://fake-s3.test/")) {
      assert.equal(init?.method, "PUT");
      if (putAnswer) return putAnswer();
      const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer());
      const contentType = headers.get("content-type") ?? "";
      puts.push({ contentType, size: bytes.length });
      store.put(url, bytes, contentType);
      return new Response("", { status: 200 });
    }
    calls.push({ url, contentType: headers.get("content-type") ?? "", hasDishHeader: headers.has("x-dish-token") });
    return realFetch(input, init);
  }) as typeof fetch;
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
      const said = (p: Promise<unknown>) => p.then(() => "no error", (e: Error) => e.message);
      assert.equal(await said(site.getCard("Z".repeat(22))), "This link doesn't work anymore.", "the sentence, read from `message`");
      assert.equal(await kind(site.createCard({ dish: "asdf qwerty", relation: "mom" })), "not-a-dish");
      assert.equal(await kind(site.updateCard(kidToken, { message: "fuck this" })), "words");
      await seedSpend(10);
      assert.equal(await kind(site.createCard({ dish: "dal", relation: "mom" })), "budget");
      await seedSpend(0);
      for (let i = 0; i < 5; i++) await site.createCard({ dish: "dal", relation: "mom" }).catch(() => {});
      assert.equal(await kind(site.createCard({ dish: "dal", relation: "mom" })), "rate");
    });

    await t.test("a card from a photo and a voice note: link, PUT, confirm, each through the site's own uploadFile", async () => {
      await clearWindow("dish-cards"); // the test above used this IP's limit
      const photo = await site.uploadFile("photo", new Blob([new Uint8Array(1000).fill(7)], { type: "image/jpeg" }), "image/jpeg");
      const voice = await site.uploadFile("voice", new Blob([new Uint8Array(800).fill(7)], { type: "audio/webm;codecs=opus" }), "audio/webm;codecs=opus");
      assert.ok(site.isPlausibleToken(photo) && site.isPlausibleToken(voice));
      assert.equal(puts.length, 2);
      assert.equal(puts[1].contentType, "audio/webm", "the type the link was signed for, not the recorder's");
      const made = await site.createCard({ dish: "a made-up blue lentil stew", relation: "mom", photos: [photo], voiceNote: voice });
      assert.equal(made.card.photoUrls.length, 1);
      assert.equal(model.calls.transcribe, 1);
    });

    await t.test("Mom's answer, end to end: sendAnswer, Send, the merge, then the kid's page", async () => {
      const fresh = await askedCard(app, "192.0.2.90");
      const ask = await site.sendAnswer(fresh.askToken, "q1", "en", 3, new Blob([new Uint8Array(400).fill(1)], { type: "audio/webm;codecs=opus" }), "audio/webm;codecs=opus");
      assert.deepEqual(ask.answered, ["q1"]);
      assert.equal(ask.clips[0].durationS, 3);
      assert.equal((await site.finishAsk(fresh.askToken)).merging, true);
      await settle();
      const card = await site.getCard(fresh.kidToken);
      assert.equal(card.status, "answered");
      assert.equal(card.version.ingredients[2].amount, "two big spoons");
      assert.equal(card.answers[0].words, FAKE_WORDS);
    });

    await t.test("none of it needs a preflight but the PUT: JSON goes as text/plain, the token in the body, never the query", async () => {
      assert.ok(calls.length > 0);
      for (const c of calls) {
        assert.match(c.contentType, /^text\/plain/, c.url);
        assert.ok(!/Token|token/.test(c.url), c.url);
        assert.equal(c.hasDishHeader, false, c.url);
      }
    });

    await t.test("a failed PUT reads as busy, a network failure too, and a refused type as bad", async () => {
      const kind = (p: Promise<unknown>) => p.then(() => "no error", (e: { kind: string }) => e.kind);
      const blob = new Blob([new Uint8Array(1000)], { type: "image/jpeg" });
      putAnswer = () => new Response("<Error/>", { status: 403 });
      assert.equal(await kind(site.uploadFile("photo", blob, "image/jpeg")), "busy");
      putAnswer = () => {
        throw new TypeError("fetch failed");
      };
      assert.equal(await kind(site.uploadFile("photo", blob, "image/jpeg")), "busy");
      putAnswer = null;
      assert.equal(await kind(site.uploadFile("photo", blob, "image/gif")), "bad");
      const fresh = await askedCard(app, "192.0.2.91");
      putAnswer = () => new Response("", { status: 500 });
      assert.equal(await kind(site.sendAnswer(fresh.askToken, "q1", "en", 3, new Blob([new Uint8Array(400)]), "audio/mp4")), "busy");
      putAnswer = null;
    });

    await t.test("a file S3 never got isn't taken: a PUT that said fine but stored nothing can't be confirmed", async () => {
      const kind = (p: Promise<unknown>) => p.then(() => "no error", (e: { kind: string }) => e.kind);
      putAnswer = () => new Response("", { status: 200 });
      assert.equal(await kind(site.uploadFile("photo", new Blob([new Uint8Array(1000)], { type: "image/jpeg" }), "image/jpeg")), "not-found");
      putAnswer = null;
    });
  } finally {
    globalThis.fetch = realFetch;
    await app.close();
  }
});

after(async () => {
  rmSync(scratch, { recursive: true, force: true });
  if (hasDatabase) await db().end();
});
