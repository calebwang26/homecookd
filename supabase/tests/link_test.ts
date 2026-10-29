// Offline checks for supabase/functions/api/link.ts: Phase 4's join ticket (docs/build/V2-LINKING.md §2.4) and
// the "moved" receipt (docs/build/JOIN-SIMPLE.md §4). The two ticket vectors were made by Convex's signTicket()
// and the receipt vector by its signMoved() (convex/lib/joinTicket.ts), so both sides prove they agree. The
// join itself (POST /auth/apple|google with link_ticket) is tested in joinLinks_test.ts.
//
// Run: npx --yes deno@2 test --node-modules-dir=none --allow-env supabase/tests/link_test.ts

import { assertEquals } from "jsr:@std/assert@1.0.13";
import { type JoinPayload, type MovedReceipt, roleFor, shareTokenFor, signMoved, verifyTicket } from "../functions/api/link.ts";

const t = (name: string, fn: () => void | Promise<void>) =>
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });

// --- the shared vectors

const SECRET = "test-link-secret-0123456789abcdef";
const FAM = "11111111-2222-4333-8444-555555555555";
const CARD = "f25009a97fe921e7818ce826";
const EXP = 1893456000000;
const NOW = EXP - 60_000;
const PAYLOAD_A: JoinPayload = { v: 1, fam: FAM, card: CARD, side: "cook", name: "Mom", exp: EXP, jti: "AbCdEfGhIjKlMnOp" };
const TICKET_A =
  "eyJ2IjoxLCJmYW0iOiIxMTExMTExMS0yMjIyLTQzMzMtODQ0NC01NTU1NTU1NTU1NTUiLCJjYXJkIjoiZjI1MDA5YTk3ZmU5MjFlNzgxOGNlODI2Iiwic2lkZSI6ImNvb2siLCJuYW1lIjoiTW9tIiwiZXhwIjoxODkzNDU2MDAwMDAwLCJqdGkiOiJBYkNkRWZHaElqS2xNbk9wIn0.cRuUbmammgS1hFfFT9rg5mTjQMx9lThGlK0qCoOk_X8";
const TICKET_B =
  "eyJ2IjoxLCJmYW0iOiIxMTExMTExMS0yMjIyLTQzMzMtODQ0NC01NTU1NTU1NTU1NTUiLCJjYXJkIjoiZjI1MDA5YTk3ZmU5MjFlNzgxOGNlODI2Iiwic2lkZSI6ImtpZCIsIm5hbWUiOiLgpIbgpJzgpYAiLCJleHAiOjE4OTM0NTYwMDAwMDAsImp0aSI6IlFyU3RVdld4WXowMTIzNDUifQ.m_o_MYGVrGVCzT86G9Fc6EjmlsGYIozj_6EYIZIy-Eg";

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Signs any object the way Convex does, so the tests can make tickets Convex never would. */
async function sign(secret: string, payload: unknown): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${body}.${b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body))))}`;
}

const OTHER_FAM = "99999999-9999-4999-8999-999999999999";

// --- the ticket

t("both shared vectors verify; B's name decodes as आजी", async () => {
  assertEquals(await verifyTicket(SECRET, TICKET_A, NOW), PAYLOAD_A);
  const b = await verifyTicket(SECRET, TICKET_B, NOW);
  assertEquals(b, { ...PAYLOAD_A, side: "kid", name: "आजी", jti: "QrStUvWxYz012345" });
  assertEquals(await sign(SECRET, PAYLOAD_A), TICKET_A); // the test signer is Convex's
});

t("a forged signature, a wrong secret or a broken shape is refused", async () => {
  const [body, sig] = TICKET_A.split(".");
  const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
  assertEquals(await verifyTicket(SECRET, `${body}.${flipped}`, NOW), null);
  assertEquals(await verifyTicket("another-secret", TICKET_A, NOW), null);
  assertEquals(await verifyTicket(SECRET, body, NOW), null);
  assertEquals(await verifyTicket(SECRET, `${TICKET_A}.x`, NOW), null);
  assertEquals(await verifyTicket(SECRET, `${body}.${sig}=`, NOW), null);
  assertEquals(await verifyTicket(SECRET, "x".repeat(1001), NOW), null);
});

t("a tampered payload is refused, even with the original signature", async () => {
  const sig = TICKET_A.split(".")[1];
  for (const change of [{ side: "kid" }, { fam: OTHER_FAM }, { name: "Stranger" }, { exp: EXP * 2 }]) {
    const body = b64url(enc.encode(JSON.stringify({ ...PAYLOAD_A, ...change })));
    assertEquals(await verifyTicket(SECRET, `${body}.${sig}`, NOW), null, JSON.stringify(change));
  }
});

t("an expired ticket is refused (now >= exp)", async () => {
  assertEquals(await verifyTicket(SECRET, TICKET_A, EXP), null);
  assertEquals(await verifyTicket(SECRET, TICKET_A, EXP + 1), null);
  assertEquals((await verifyTicket(SECRET, TICKET_A, EXP - 1))?.jti, "AbCdEfGhIjKlMnOp");
});

t("a signed ticket with an unknown v or a bad field is still refused", async () => {
  const bad = [
    { ...PAYLOAD_A, v: 2 },
    { ...PAYLOAD_A, side: "admin" },
    { ...PAYLOAD_A, fam: "not-a-uuid" },
    { ...PAYLOAD_A, card: "short" },
    { ...PAYLOAD_A, jti: "short" },
    { ...PAYLOAD_A, exp: "1893456000000" },
    { ...PAYLOAD_A, name: 5 },
    null,
    [1, 2],
  ];
  for (const p of bad) assertEquals(await verifyTicket(SECRET, await sign(SECRET, p), NOW), null, JSON.stringify(p));
  assertEquals((await verifyTicket(SECRET, await sign(SECRET, { ...PAYLOAD_A, name: null }), NOW))?.name, null);
});

t("the role comes from the side; the share token names the card side", () => {
  assertEquals(roleFor("kid"), "learner");
  assertEquals(roleFor("cook"), "cook");
  assertEquals(shareTokenFor(CARD, "cook"), `link:${CARD}:cook`);
});

// --- the receipt

const RECEIPT: MovedReceipt = {
  v: 1,
  kind: "moved",
  fromProfile: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  fromFamily: OTHER_FAM,
  toProfile: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  toFamily: FAM,
  solo: true,
  faces: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
  exp: EXP,
};
const RECEIPT_SIGNED =
  "eyJ2IjoxLCJraW5kIjoibW92ZWQiLCJmcm9tUHJvZmlsZSI6ImFhYWFhYWFhLWFhYWEtNGFhYS04YWFhLWFhYWFhYWFhYWFhYSIsImZyb21GYW1pbHkiOiI5OTk5OTk5OS05OTk5LTQ5OTktODk5OS05OTk5OTk5OTk5OTkiLCJ0b1Byb2ZpbGUiOiJiYmJiYmJiYi1iYmJiLTRiYmItOGJiYi1iYmJiYmJiYmJiYmIiLCJ0b0ZhbWlseSI6IjExMTExMTExLTIyMjItNDMzMy04NDQ0LTU1NTU1NTU1NTU1NSIsInNvbG8iOnRydWUsImZhY2VzIjpbImNjY2NjY2NjLWNjY2MtNGNjYy04Y2NjLWNjY2NjY2NjY2NjYyJdLCJleHAiOjE4OTM0NTYwMDAwMDB9.GD7FOJfSHUKuMHDp9N8C-40xYdOQ7VQb7Vw0KNKMsmQ";

t("the moved receipt matches Convex's signMoved byte for byte, in its field order", async () => {
  assertEquals(await signMoved(SECRET, RECEIPT), RECEIPT_SIGNED);
  // Extra fields or another order never change what's signed.
  const shuffled = { exp: EXP, faces: RECEIPT.faces, solo: true, toFamily: FAM, toProfile: RECEIPT.toProfile, fromFamily: OTHER_FAM, fromProfile: RECEIPT.fromProfile, kind: "moved", v: 1, extra: 1 };
  assertEquals(await signMoved(SECRET, shuffled as unknown as MovedReceipt), RECEIPT_SIGNED);
  assertEquals(await sign(SECRET, RECEIPT), RECEIPT_SIGNED); // the test signer agrees too
});
