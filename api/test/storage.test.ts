// The real S3 adapter, with a client that never reaches AWS: signing happens on this machine, and `send` is replaced for the rest.
import assert from "node:assert/strict";
import { test } from "node:test";
import { S3Client } from "@aws-sdk/client-s3";
import { READ_LINK_S, readWindowStart, s3Store, UPLOAD_LINK_S } from "../src/storage.js";

function client(send?: (command: unknown) => Promise<unknown>) {
  const c = new S3Client({
    region: "us-west-2",
    credentials: { accessKeyId: "AKIAFAKE", secretAccessKey: "fake" },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  if (send) (c as unknown as { send: unknown }).send = send;
  return c;
}

const HOUR = 3_600_000;

test("an upload link: short-lived, and S3 itself refuses another type or size", async () => {
  const store = s3Store({ bucket: "hc-private-test", client: client() });
  const link = await store.presignPut("private/dish/abc", "audio/webm", 1234);
  const url = new URL(link.url);
  assert.equal(url.pathname, "/private/dish/abc");
  assert.ok(url.hostname.startsWith("hc-private-test.s3."), url.hostname);
  assert.equal(url.searchParams.get("X-Amz-Expires"), String(UPLOAD_LINK_S));
  assert.equal(UPLOAD_LINK_S, 900);
  const signed = url.searchParams.get("X-Amz-SignedHeaders")!.split(";");
  for (const header of ["content-length", "content-type", "host"]) assert.ok(signed.includes(header), signed.join());
  // A browser's plain PUT can't send checksum headers, and a signed link that expects them would fail.
  assert.ok(![...url.searchParams.keys()].some((k) => /checksum/i.test(k)), link.url);
  assert.deepEqual(link.headers, { "Content-Type": "audio/webm" });
});

test("a read link stays the same for its hour, so polling doesn't restart her audio, and is good for at least an hour", async () => {
  let now = 40 * HOUR + 60_000;
  const store = s3Store({ bucket: "b", client: client(), now: () => now });
  const first = await store.presignGet("private/dish/abc");
  now += 30 * 60_000;
  assert.equal(await store.presignGet("private/dish/abc"), first);
  now += 30 * 60_000; // the next hour
  const next = await store.presignGet("private/dish/abc");
  assert.notEqual(next, first);
  const url = new URL(first);
  assert.equal(url.searchParams.get("X-Amz-Expires"), String(READ_LINK_S));
  // Signed at the top of the hour, for two hours: at the very end of the hour it still has one left.
  assert.equal(READ_LINK_S, 2 * 3600);
  assert.equal(readWindowStart(now).getTime() % HOUR, 0);
});

test("head and read: a missing object is null, S3 being down throws", async () => {
  const notFound = Object.assign(new Error("x"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
  const missing = s3Store({ bucket: "b", client: client(async () => { throw notFound; }) });
  assert.equal(await missing.head("k"), null);
  assert.equal(await missing.read("k"), null);
  // Without s3:ListBucket, S3 answers 403 for a missing object. That throws rather than pretending: infra needs that permission.
  const forbidden = Object.assign(new Error("x"), { name: "Forbidden", $metadata: { httpStatusCode: 403 } });
  const refused = s3Store({ bucket: "b", client: client(async () => { throw forbidden; }) });
  await assert.rejects(refused.head("k"));
  await assert.rejects(refused.read("k"));
  const present = s3Store({
    bucket: "b",
    client: client(async () => ({ ContentLength: 5, ContentType: "image/jpeg", Body: { transformToByteArray: async () => new Uint8Array(5) } })),
  });
  assert.deepEqual(await present.head("k"), { size: 5, contentType: "image/jpeg" });
  assert.equal((await present.read("k"))?.bytes.length, 5);
  await present.remove("k");
});
