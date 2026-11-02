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
  assert.equal(UPLOAD_LINK_S, 120);
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

test("listing a folder follows S3's pages up to the most asked for, and a delete S3 refuses throws without naming the key", async () => {
  const pages = [{ Contents: [{ Key: "f/1" }, { Key: "f/2" }], IsTruncated: true, NextContinuationToken: "t" }, { Contents: [{ Key: "f/3" }], IsTruncated: false }];
  const asked: Record<string, unknown>[] = [];
  const store = s3Store({
    bucket: "b",
    client: client(async (command) => {
      const input = (command as { input: Record<string, unknown> }).input;
      asked.push(input);
      if ("Delete" in input) {
        const objects = (input.Delete as { Objects: { Key: string }[] }).Objects;
        return objects.some((o) => o.Key === "secret-dish/1") ? { Errors: [{ Key: "secret-dish/1", Code: "AccessDenied" }] } : {};
      }
      return input.ContinuationToken === "t" ? pages[1] : pages[0];
    }),
  });
  assert.deepEqual(await store.list("f/", 10), ["f/1", "f/2", "f/3"]);
  assert.deepEqual([asked[0].Prefix, asked[0].MaxKeys, asked[1].ContinuationToken], ["f/", 10, "t"]);
  asked.length = 0;
  assert.deepEqual(await store.list("f/", 2), ["f/1", "f/2"], "stops once it has enough");
  assert.equal(asked.length, 1);

  asked.length = 0;
  await store.removeMany(Array.from({ length: 1500 }, (_, i) => `f/${i}`));
  assert.deepEqual(asked.map((a) => (a.Delete as { Objects: unknown[] }).Objects.length), [1000, 500], "S3 takes 1,000 at a time");
  await assert.rejects(store.removeMany(["secret-dish/1"]), (e: Error) => !e.message.includes("secret") && /refused 1 deletes \(AccessDenied\)/.test(e.message));
});
