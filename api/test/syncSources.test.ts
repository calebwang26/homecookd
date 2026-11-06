// The real clients for Convex and Supabase, against a local server that plays each: timeouts, retries, and what an error holds. Nothing leaves this machine.
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { convexSource, CursorExpired, isSupabaseId, SourceFailed, supabaseSource } from "../src/modules/sync/sources.js";

const UUID_A = "11111111-aaaa-4bbb-8ccc-111111111111";
const UUID_B = "22222222-aaaa-4bbb-8ccc-222222222222";
const SECRET = "sync-secret-for-tests";
const KEY = "supabase-key-for-tests";
const fast = { timeoutMs: 100, tries: 3, backoffMs: 1 };

type Seen = { method?: string; url?: string; headers: IncomingMessage["headers"]; body: string };

async function serve(handler: (req: IncomingMessage, res: ServerResponse, seen: Seen[]) => void, run: (url: string, seen: Seen[]) => Promise<void>) {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, seen);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const convexEnv = (url: string) => ({ CONVEX_SITE_URL: `${url}/`, SYNC_READ_SECRET: SECRET });
const supabaseEnv = (url: string) => ({ SUPABASE_URL: url, SUPABASE_SYNC_KEY: KEY });

test("the Convex client", async (t) => {
  await t.test("posts to the read routes with its secret", async () => {
    await serve(
      (req, res) => json(res, 200, req.url === "/sync/page" ? { rows: [{ _id: "x" }], next: "abc" } : { rows: [{ id: "d" }] }),
      async (url, seen) => {
        const convex = convexSource(convexEnv(url), fast);
        assert.deepEqual(await convex.page("people", null, 10), { rows: [{ _id: "x" }], next: "abc" });
        assert.deepEqual(await convex.deletions(5, 7), [{ id: "d" }]);
        assert.equal(seen[0].method, "POST");
        assert.equal(seen[0].url, "/sync/page");
        assert.equal(seen[0].headers["x-sync-secret"], SECRET);
        assert.deepEqual(JSON.parse(seen[0].body), { table: "people", cursor: null, limit: 10 });
        assert.deepEqual(JSON.parse(seen[1].body), { after: 5, limit: 7 });
      },
    );
  });

  await t.test("a 500 is retried, then succeeds", async () => {
    await serve(
      (_req, res, seen) => (seen.length < 3 ? json(res, 500, { error: "busy" }) : json(res, 200, { rows: [], next: null })),
      async (url, seen) => {
        assert.deepEqual(await convexSource(convexEnv(url), fast).page("people", null, 1), { rows: [], next: null });
        assert.equal(seen.length, 3);
      },
    );
  });

  await t.test("a wrong secret isn't retried, and the error names no secret or address", async () => {
    await serve(
      (_req, res) => json(res, 401, { error: "wrong secret" }),
      async (url, seen) => {
        await assert.rejects(convexSource(convexEnv(url), fast).page("people", null, 1), (error: unknown) => {
          assert.ok(error instanceof SourceFailed);
          assert.equal(error.name, "ConvexReadFailed");
          assert.equal(error.status, 401);
          const text = `${error.message} ${JSON.stringify(error)}`;
          assert.ok(!text.includes(SECRET) && !text.includes(url));
          return true;
        });
        assert.equal(seen.length, 1);
      },
    );
  });

  await t.test("a hung server is cut off by the timeout, tries a limited number of times, and then fails", async () => {
    await serve(
      () => {
        // never answers
      },
      async (url, seen) => {
        const started = Date.now();
        await assert.rejects(convexSource(convexEnv(url), fast).deletions(0, 1), { name: "ConvexReadFailed" });
        assert.equal(seen.length, 3);
        assert.ok(Date.now() - started < 2000);
      },
    );
  });

  await t.test("a body that isn't what we asked for fails rather than reading as empty", async () => {
    await serve(
      (_req, res) => json(res, 200, { nope: true }),
      async (url) => {
        await assert.rejects(convexSource(convexEnv(url), fast).page("people", null, 1), { name: "ConvexReadFailed" });
        await assert.rejects(convexSource(convexEnv(url), fast).deletions(0, 1), { name: "ConvexReadFailed" });
      },
    );
  });

  await t.test("a cursor Convex doesn't know is its own error", async () => {
    await serve(
      (_req, res) => json(res, 400, { error: "bad_cursor" }),
      async (url, seen) => {
        await assert.rejects(convexSource(convexEnv(url), fast).page("people", "old", 1), CursorExpired);
        assert.equal(seen.length, 1);
      },
    );
  });

  await t.test("missing settings fail by name", () => {
    assert.throws(() => convexSource({}), /The sync needs CONVEX_SITE_URL/);
    assert.throws(() => convexSource({ CONVEX_SITE_URL: "http://x" }), /The sync needs SYNC_READ_SECRET/);
  });
});

test("the Supabase client", async (t) => {
  await t.test("asks for chosen columns only, by uuid, with its key, and never for a family code", async () => {
    await serve(
      (_req, res) => json(res, 200, [{ id: UUID_A }]),
      async (url, seen) => {
        const supabase = supabaseSource(supabaseEnv(url), fast);
        await supabase.profiles([UUID_A, "seed:abc", UUID_B, UUID_A]);
        await supabase.families([UUID_A]);
        assert.equal(seen[0].method, "GET");
        assert.equal(seen[0].headers.apikey, KEY);
        assert.equal(seen[0].headers.authorization, `Bearer ${KEY}`);
        assert.match(seen[0].url!, /^\/rest\/v1\/profiles\?select=[a-z_,]+&id=in\./);
        assert.ok(seen[0].url!.includes(`id=in.(${UUID_A},${UUID_B})`), "a seed's id isn't sent, and each once");
        assert.ok(seen[1].url!.startsWith("/rest/v1/families?select=id,name&"));
        assert.ok(!seen.some((call) => call.url!.includes("code")));
      },
    );
  });

  await t.test("no uuids, no call", async () => {
    await serve(
      (_req, res) => json(res, 200, []),
      async (url, seen) => {
        assert.deepEqual(await supabaseSource(supabaseEnv(url), fast).profiles(["seed:a"]), []);
        assert.equal(seen.length, 0);
      },
    );
  });

  await t.test("a long list splits across calls", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `${String(i).padStart(8, "0")}-aaaa-4bbb-8ccc-000000000000`);
    await serve(
      (req, res) => json(res, 200, (req.url!.match(/[0-9]{8}-aaaa/g) ?? []).map((m) => ({ id: m }))),
      async (url, seen) => {
        const rows = await supabaseSource(supabaseEnv(url), fast).profiles(ids);
        assert.equal(rows.length, 250);
        assert.equal(seen.length, 3);
      },
    );
  });

  await t.test("the id walk pages by id", async () => {
    await serve(
      (_req, res) => json(res, 200, [{ id: UUID_B }]),
      async (url, seen) => {
        assert.deepEqual(await supabaseSource(supabaseEnv(url), fast).profileIds(UUID_A, 500), [UUID_B]);
        assert.equal(seen[0].url, `/rest/v1/profiles?select=id&order=id.asc&limit=500&id=gt.${UUID_A}`);
      },
    );
  });

  await t.test("a timeout fails after limited tries, with no key in the error", async () => {
    await serve(
      () => {},
      async (url, seen) => {
        await assert.rejects(supabaseSource(supabaseEnv(url), fast).familyIds(null, 1), (error: Error) => {
          assert.equal(error.name, "SupabaseReadFailed");
          assert.ok(!error.message.includes(KEY));
          return true;
        });
        assert.equal(seen.length, 3);
      },
    );
  });

  await t.test("only a real uuid reaches a filter", () => {
    assert.ok(isSupabaseId(UUID_A));
    for (const bad of ["seed:x", `${UUID_A})`, `${UUID_A},or(`, "", "not-a-uuid"]) assert.equal(isSupabaseId(bad), false, bad);
  });

  await t.test("missing settings fail by name", () => {
    assert.throws(() => supabaseSource({}), /The sync needs SUPABASE_URL/);
    assert.throws(() => supabaseSource({ SUPABASE_URL: "http://x" }), /The sync needs SUPABASE_SYNC_KEY/);
  });
});
