// SYSTEM-DESIGN: logs and Sentry carry no message text, tokens or names. Runs the real work with a capturing logger and looks for each.
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { after, test } from "node:test";
import { buildApp, pathOnly } from "../src/app.js";
import { db } from "../src/db.js";
import { sendDue } from "../src/outbox.js";
import { handleMessage } from "../src/scheduled.js";
import { closeAll, fakeModels, ok, person, phone, recipe, skip, uploaded, world } from "./messagesHelpers.js";

const WORDS = "SECRET-WORDS-IN-A-MESSAGE";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk));
      done();
    },
  });
  const log = {
    info: (o: object, m: string) => void lines.push(JSON.stringify([o, m])),
    warn: (o: object, m: string) => void lines.push(JSON.stringify([o, m])),
    error: (o: object, m: string) => void lines.push(JSON.stringify([o, m])),
  };
  return { lines, stream, log };
}

test("sending, a failed send, the push and the failed models log no words, tokens, names or file keys", { skip }, async () => {
  const w = await world();
  const seen = capture();
  const app = buildApp({
    logger: { level: "info", stream: seen.stream, serializers: { req: (req: { method: string; url: string }) => ({ method: req.method, path: pathOnly(req.url) }), res: (res: { statusCode: number }) => ({ status: res.statusCode }) } },
  });
  await app.ready();
  const aai = await person(w.family, "UniqueCookName", "cook", { language: "mr" });
  await phone(w, aai, "secret-push-token");
  const voice = await uploaded(w, w.leo);
  const pair = (await app.inject({ method: "POST", url: "/v1/threads", headers: { authorization: `Bearer ${w.leo.token}`, "content-type": "application/json" }, payload: JSON.stringify({ otherId: aai.id }) })).json().id;
  const post = (url: string, body: unknown) =>
    app.inject({ method: "POST", url, headers: { authorization: `Bearer ${w.leo.token}`, "content-type": "application/json", "idempotency-key": `k${Math.random().toString(36).slice(2, 14)}` }, payload: JSON.stringify(body) });
  ok({ status: (await post(`/v1/threads/${pair}/messages`, { kind: "text", body: WORDS })).statusCode, data: null, body: "" });
  ok({ status: (await post(`/v1/threads/${pair}/messages`, { kind: "voice", audioKey: voice, durationS: 3 })).statusCode, data: null, body: "" });

  // A server error while sending: its body and its row's values stay out of the log.
  await db().query(`alter table messages add constraint test_refuse check (body is distinct from '${WORDS}-2')`);
  try {
    assert.equal((await post(`/v1/threads/${pair}/messages`, { kind: "text", body: `${WORDS}-2` })).statusCode, 500);
  } finally {
    await db().query(`alter table messages drop constraint test_refuse`);
  }

  // Models failing, with the words in their error messages.
  fakeModels.translate = () => Promise.reject(new Error(`could not translate ${WORDS}`));
  fakeModels.transcript = () => Promise.reject(new Error(`could not hear ${WORDS}`));
  fakeModels.yesNo = () => Promise.reject(new Error(`could not read ${WORDS}`));
  const chili = await recipe(w.family, aai.id);
  const asked = (await post("/v1/questions", { recipeId: chili, text: WORDS })).json();
  const clip = await uploaded(w, aai);
  await db().query(`update questions set kind = 'share' where id = $1`, [asked.questionId]);
  await app.inject({
    method: "POST",
    url: `/v1/questions/${asked.questionId}/answer`,
    headers: { authorization: `Bearer ${aai.token}`, "content-type": "application/json", "idempotency-key": "log-test-answer-1" },
    payload: JSON.stringify({ audioKey: clip }),
  });

  // Everything on the queue, through the real consumer, with the capturing log.
  for (let i = 0; i < 20; i += 1) {
    const bodies: string[] = [];
    const sent = await sendDue(db(), async (_q, body) => void bodies.push(body), seen.log, 200);
    for (const body of bodies) await handleMessage(body, seen.log);
    if (sent === 0) break;
  }
  assert.ok(w.expo.sent.flat().length > 0, "the push really went");
  assert.ok(seen.lines.length > 0);
  const all = seen.lines.join("\n");
  assert.ok(all.includes("a voice answer wasn't written out"), "the failure was logged");
  for (const secret of [WORDS, "UniqueCookName", "secret-push-token", "ExponentPushToken", w.leo.token, aai.token, voice, clip]) {
    assert.ok(!all.includes(secret), `the log holds ${secret}`);
  }
  await app.close();
});

test("outbox payloads hold ids only", { skip }, async () => {
  const w = await world();
  const pair = (await w.app.inject({ method: "POST", url: "/v1/threads", headers: { authorization: `Bearer ${w.mom.token}`, "content-type": "application/json" }, payload: JSON.stringify({ otherId: w.dad.id }) })).json().id;
  await w.app.inject({
    method: "POST",
    url: `/v1/threads/${pair}/messages`,
    headers: { authorization: `Bearer ${w.mom.token}`, "content-type": "application/json", "idempotency-key": "outbox-ids-only-1" },
    payload: JSON.stringify({ kind: "text", body: WORDS }),
  });
  const { rows } = await db().query(`select payload from outbox`);
  assert.ok(rows.length > 0);
  assert.ok(!JSON.stringify(rows).includes(WORDS));
  assert.deepEqual(Object.keys(rows[0].payload).sort(), ["messageId", "task"]);
});

after(closeAll);
