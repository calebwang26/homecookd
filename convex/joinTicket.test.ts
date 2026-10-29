// The join ticket's shared vectors: supabase/tests/link_test.ts checks the same two tickets, so both sides agree.
import { expect, test } from "vitest";
import { cardRef, newJti, signTicket, verifyTicket, type JoinPayload } from "./lib/joinTicket";

const SECRET = "test-link-secret-0123456789abcdef";
const A: JoinPayload = {
  v: 1,
  fam: "11111111-2222-4333-8444-555555555555",
  card: "f25009a97fe921e7818ce826",
  side: "cook",
  name: "Mom",
  exp: 1893456000000,
  jti: "AbCdEfGhIjKlMnOp",
};
const TICKET_A =
  "eyJ2IjoxLCJmYW0iOiIxMTExMTExMS0yMjIyLTQzMzMtODQ0NC01NTU1NTU1NTU1NTUiLCJjYXJkIjoiZjI1MDA5YTk3ZmU5MjFlNzgxOGNlODI2Iiwic2lkZSI6ImNvb2siLCJuYW1lIjoiTW9tIiwiZXhwIjoxODkzNDU2MDAwMDAwLCJqdGkiOiJBYkNkRWZHaElqS2xNbk9wIn0.cRuUbmammgS1hFfFT9rg5mTjQMx9lThGlK0qCoOk_X8";
const TICKET_B =
  "eyJ2IjoxLCJmYW0iOiIxMTExMTExMS0yMjIyLTQzMzMtODQ0NC01NTU1NTU1NTU1NTUiLCJjYXJkIjoiZjI1MDA5YTk3ZmU5MjFlNzgxOGNlODI2Iiwic2lkZSI6ImtpZCIsIm5hbWUiOiLgpIbgpJzgpYAiLCJleHAiOjE4OTM0NTYwMDAwMDAsImp0aSI6IlFyU3RVdld4WXowMTIzNDUifQ.m_o_MYGVrGVCzT86G9Fc6EjmlsGYIozj_6EYIZIy-Eg";

test("the shared vectors sign and verify", async () => {
  expect(await cardRef("j57abc123")).toBe(A.card);
  expect(await signTicket(SECRET, A)).toBe(TICKET_A);
  expect(await verifyTicket(SECRET, TICKET_A, A.exp - 1)).toEqual(A);
  expect(await verifyTicket(SECRET, TICKET_B, 0)).toMatchObject({ side: "kid", name: "आजी", jti: "QrStUvWxYz012345" });
});

test("a forged, tampered, expired or malformed ticket is refused", async () => {
  const [body, sig] = TICKET_A.split(".");
  expect(await verifyTicket("another-secret", TICKET_A, 0)).toBeNull();
  const forged = btoa(JSON.stringify({ ...A, side: "kid" })).replace(/=+$/, "");
  expect(await verifyTicket(SECRET, `${forged}.${sig}`, 0)).toBeNull();
  expect(await verifyTicket(SECRET, `${body}.${sig.slice(0, -1)}A`, 0)).toBeNull();
  expect(await verifyTicket(SECRET, TICKET_A, A.exp)).toBeNull(); // expires at exp
  expect(await verifyTicket(SECRET, `${TICKET_A}.x`, 0)).toBeNull();
  expect(await verifyTicket(SECRET, "nope", 0)).toBeNull();
  const v2 = await signTicket(SECRET, { ...A, v: 2 as 1 });
  expect(await verifyTicket(SECRET, v2, 0)).toBeNull();
});

test("jti is 16 base62 characters and differs each time", () => {
  const a = newJti();
  expect(a).toMatch(/^[0-9A-Za-z]{16}$/);
  expect(newJti()).not.toBe(a);
});
