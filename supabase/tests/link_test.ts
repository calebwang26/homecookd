// Offline checks for supabase/functions/api/link.ts: POST /auth/link and its join ticket
// (docs/build/V2-LINKING.md §2.4). The two ticket vectors were made by Convex's signTicket()
// (convex/lib/joinTicket.ts), so both sides prove they agree. No database and no network: linkJoin()
// gets a tiny in-memory stand-in for the Supabase client and fakes of index.ts's helpers.
//
// Run: npx --yes deno@2 test --node-modules-dir=none --allow-env supabase/tests/link_test.ts

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.13";
import { type JoinPayload, type LinkDeps, linkJoin, LINK_USED, roleFor, shareTokenFor, verifyTicket } from "../functions/api/link.ts";

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

// --- a fake Supabase client: select, insert().select().single(), delete, eq, is, order, limit,
// single, maybeSingle. Rows get an id and an increasing created_at.

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

function fakeDb(tables: Tables, afterInsert?: (table: string, row: Row) => void, uniqueLink = false) {
  let seq = 0;
  class Query {
    private filters: ((r: Row) => boolean)[] = [];
    private orders: string[] = [];
    private max = Infinity;
    private mode: "select" | "insert" | "delete" = "select";
    private row: Row | null = null;
    private one: "single" | "maybe" | null = null;
    constructor(private table: string) {}
    select(_cols?: string) { return this; }
    insert(row: Row) { this.mode = "insert"; this.row = row; return this; }
    delete() { this.mode = "delete"; return this; }
    eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
    is(c: string, v: unknown) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
    order(c: string) { this.orders.push(c); return this; }
    limit(n: number) { this.max = n; return this; }
    single() { this.one = "single"; return this; }
    maybeSingle() { this.one = "maybe"; return this; }
    // deno-lint-ignore no-explicit-any
    then(ok: (v: any) => unknown, bad?: (e: unknown) => unknown) {
      return Promise.resolve().then(() => this.run()).then(ok, bad);
    }
    private run() {
      const rows = (tables[this.table] ??= []);
      if (this.mode === "insert") {
        // migration 20261029090000: a unique index on signups.share_token where it starts with 'link:'
        const tok = this.row?.share_token;
        if (uniqueLink && this.table === "signups" && typeof tok === "string" && tok.startsWith("link:") && rows.some((r) => r.share_token === tok)) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
        seq++;
        const row = { id: `${this.table}-${seq}`, created_at: new Date(Date.UTC(2026, 9, 29, 12, 0, seq)).toISOString(), ...this.row };
        rows.push(row);
        afterInsert?.(this.table, row);
        return { data: this.one ? row : [row], error: null };
      }
      const found = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.mode === "delete") {
        for (const r of found) rows.splice(rows.indexOf(r), 1);
        return { data: null, error: null };
      }
      const sorted = [...found].sort((a, b) => {
        for (const c of this.orders) if (a[c] !== b[c]) return a[c] < b[c] ? -1 : 1;
        return 0;
      }).slice(0, this.max);
      if (this.one === "maybe") return { data: sorted[0] ?? null, error: null };
      if (this.one === "single") {
        return sorted.length === 1 ? { data: sorted[0], error: null } : { data: null, error: { code: "PGRST116", message: "not one row" } };
      }
      return { data: sorted, error: null };
    }
  }
  return { from: (table: string) => new Query(table) } as unknown as LinkDeps["db"];
}

// --- fakes of index.ts's helpers

class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

/** index.ts's str(). */
function str(v: unknown, field: string, opts: { max: number; required?: boolean }): string | null {
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
    if (opts.required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  if (typeof v !== "string") throw new HttpError(400, `${field} must be a string`);
  const s = v.trim();
  if (s.length > opts.max) throw new HttpError(400, `${field} must be at most ${opts.max} characters`);
  return s;
}

const OTHER_FAM = "99999999-9999-4999-8999-999999999999";

function world(extraPeople: Row[] = []): Tables {
  return {
    families: [{ id: FAM, name: "Caleb's family" }, { id: OTHER_FAM, name: "Someone else's family" }],
    profiles: [
      { id: "p-caleb", family_id: FAM, name: "Caleb", role: "learner", relation: null, avatar_key: null, sort: 1, removed_at: null },
      ...extraPeople,
    ],
    devices: [],
    signups: [],
    messages: [],
  };
}

function setup(
  tables: Tables,
  opts: { secret?: string | null; now?: number; failDevice?: boolean; afterInsert?: (table: string, row: Row) => void; uniqueLink?: boolean } = {},
) {
  const db = fakeDb(tables, opts.afterInsert, opts.uniqueLink);
  const rate: unknown[][] = [];
  const deps: LinkDeps = {
    db,
    HttpError,
    dbFail: (context) => {
      throw new HttpError(500, `db error (${context})`);
    },
    rateLimit: (...args) => {
      rate.push(args);
      return Promise.resolve();
    },
    str,
    deviceLabel: (b) => str(b.device_label ?? b.label, "device_label", { max: 40 }),
    // index.ts's addProfile(): names are unique per family, ignoring case.
    addProfile: async (familyId, existing, p) => {
      const same = existing.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
      if (same) throw new HttpError(409, `${same.name} is already in this family`);
      const sort = existing.reduce((m, x) => Math.max(m, x.sort), 0) + 1;
      const { data } = await db.from("profiles")
        .insert({ family_id: familyId, name: p.name, role: p.role, relation: null, avatar_key: null, sort, removed_at: null })
        .select("*").single();
      return data;
    },
    createDevice: (familyId, profileId, via, label) => {
      if (opts.failDevice) return Promise.reject(new HttpError(500, "device insert failed"));
      const id = `device-${tables.devices.length + 1}`;
      tables.devices.push({ id, family_id: familyId, profile_id: profileId, via, label });
      return Promise.resolve({ id, key: `key-${id}` });
    },
    quietNote: (familyId, profileId, body) => {
      tables.messages.push({ family_id: familyId, sender_id: profileId, kind: "system", body });
      return Promise.resolve();
    },
    secret: () => (opts.secret === undefined ? SECRET : opts.secret ?? undefined),
    now: () => opts.now ?? NOW,
  };
  return { deps, rate, join: (body: Record<string, unknown>) => linkJoin(deps, body, "203.0.113.7") };
}

async function refused(p: Promise<unknown>, status: number, includes?: string) {
  const e = await assertRejects(() => p, HttpError);
  assertEquals(e.status, status, e.message);
  if (includes) assert(e.message.includes(includes), e.message);
}

const counts = (tables: Tables) => ({
  profiles: tables.profiles.length,
  devices: tables.devices.length,
  signups: tables.signups.length,
  messages: tables.messages.length,
});

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

// --- POST /auth/link

t("a join makes a new profile, a device (via invite), a signups row and the quiet note", async () => {
  const tables = world();
  const { join, rate } = setup(tables);
  const res = await join({ ticket: TICKET_A, device_label: "iPhone" });
  const mom = tables.profiles.find((p) => p.name === "Mom")!;
  assertEquals(res, {
    existing: false,
    needs_name: false,
    joined: true,
    device_key: "key-device-1",
    family_name: "Caleb's family",
    profile_id: mom.id,
  });
  assertEquals([mom.family_id, mom.role, mom.sort], [FAM, "cook", 2]);
  assertEquals(tables.devices, [{ id: "device-1", family_id: FAM, profile_id: mom.id, via: "invite", label: "iPhone" }]);
  assertEquals(tables.signups.map(({ name, email, share_token, family_id }) => ({ name, email, share_token, family_id })), [
    { name: "Mom", email: "", share_token: `link:${CARD}:cook`, family_id: FAM },
  ]);
  assertEquals(tables.messages, [{ family_id: FAM, sender_id: mom.id, kind: "system", body: "Mom joined from a link" }]);
  assertEquals(rate, [["linkjoin-ip", "203.0.113.7", 20, 10]]);
});

t("a reused ticket, or a second join on the same card side, gets 409 and makes nothing", async () => {
  const tables = world();
  const { join } = setup(tables);
  await join({ ticket: TICKET_A });
  const before = counts(tables);
  await refused(join({ ticket: TICKET_A }), 409, LINK_USED);
  await refused(join({ ticket: TICKET_A, name: "Dad" }), 409, LINK_USED); // a new name doesn't reopen it
  const again = await sign(SECRET, { ...PAYLOAD_A, jti: "ZZZZZZZZZZZZZZZZ", name: "Auntie" }); // a fresh ticket, same side
  await refused(join({ ticket: again }), 409, LINK_USED);
  assertEquals(counts(tables), before);
});

t("the card's other side still joins, once, as a learner", async () => {
  const tables = world();
  const { join } = setup(tables);
  await join({ ticket: TICKET_A });
  const res = await join({ ticket: TICKET_B, role: "cook" }); // a role in the body is ignored
  const aaji = tables.profiles.find((p) => p.id === res.profile_id)!;
  assertEquals([aaji.name, aaji.role, aaji.family_id], ["आजी", "learner", FAM]);
  assertEquals(tables.signups.map((s) => s.share_token), [`link:${CARD}:cook`, `link:${CARD}:kid`]);
  await refused(join({ ticket: TICKET_B, name: "Someone" }), 409, LINK_USED);
});

t("a missing family gets 404 and leaves no trace", async () => {
  const tables = world();
  tables.families = tables.families.filter((f) => f.id !== FAM);
  const { join } = setup(tables);
  const before = counts(tables);
  await refused(join({ ticket: TICKET_A }), 404);
  assertEquals(counts(tables), before);
});

t("a family_id in the body is ignored: the family comes only from the ticket", async () => {
  const tables = world();
  const { join } = setup(tables);
  const res = await join({ ticket: TICKET_A, family_id: OTHER_FAM, fam: OTHER_FAM });
  assertEquals(res.family_name, "Caleb's family");
  assertEquals(tables.profiles.find((p) => p.id === res.profile_id)!.family_id, FAM);
  assertEquals(tables.profiles.filter((p) => p.family_id === OTHER_FAM), []);
});

t("a name already in the family gets 409, claims nobody, and the side stays open", async () => {
  // An invited "Mom" who hasn't joined yet: a link join must never become her.
  const invited = { id: "p-mom", family_id: FAM, name: "mom", role: "cook", relation: "Mom", avatar_key: null, sort: 2, removed_at: null };
  const tables = world([invited]);
  const { join } = setup(tables);
  const before = counts(tables);
  await refused(join({ ticket: TICKET_A }), 409, "is already in this family");
  assertEquals(counts(tables), before);
  assertEquals(tables.profiles.find((p) => p.id === "p-mom"), invited); // untouched
  const res = await join({ ticket: TICKET_A, name: "Mummy" }); // another name works
  assert(res.profile_id !== "p-mom");
  assertEquals(tables.profiles.find((p) => p.id === res.profile_id)!.name, "Mummy");
});

t("the body's name wins over the ticket's; with neither, 400", async () => {
  const tables = world();
  const { join } = setup(tables);
  const res = await join({ ticket: TICKET_A, name: "  Ma  " });
  assertEquals(tables.profiles.find((p) => p.id === res.profile_id)!.name, "Ma");
  const noName = await sign(SECRET, { ...PAYLOAD_A, side: "kid", name: null });
  await refused(join({ ticket: noName }), 400, "name is required");
  await refused(join({ ticket: noName, name: "x".repeat(41) }), 400);
});

t("bad, forged and expired tickets get 403 from the route; no ticket gets 400", async () => {
  const tables = world();
  const before = counts(tables);
  await refused(setup(tables).join({ ticket: TICKET_A.slice(0, -2) + "xx" }), 403);
  await refused(setup(tables, { now: EXP }).join({ ticket: TICKET_A }), 403);
  await refused(setup(tables).join({ ticket: await sign(SECRET, { ...PAYLOAD_A, v: 2 }) }), 403);
  await refused(setup(tables).join({}), 400, "ticket is required");
  await refused(setup(tables).join({ ticket: 42 }), 400);
  assertEquals(counts(tables), before);
});

t("503 without LINK_JOIN_SECRET (and the env is read by default)", async () => {
  await refused(setup(world(), { secret: null }).join({ ticket: TICKET_A }), 503, "Links aren't set up yet.");
  const tables = world();
  const { deps } = setup(tables);
  const fromEnv = { ...deps, secret: undefined };
  const had = Deno.env.get("LINK_JOIN_SECRET");
  try {
    Deno.env.delete("LINK_JOIN_SECRET");
    await refused(linkJoin(fromEnv, { ticket: TICKET_A }, "ip"), 503);
    Deno.env.set("LINK_JOIN_SECRET", SECRET);
    assertEquals((await linkJoin(fromEnv, { ticket: TICKET_A }, "ip")).family_name, "Caleb's family");
  } finally {
    if (had === undefined) Deno.env.delete("LINK_JOIN_SECRET");
    else Deno.env.set("LINK_JOIN_SECRET", had);
  }
});

t("two joins at once: the earlier signups row wins, the later one backs out with 409", async () => {
  const tables = world();
  let raced = false;
  const { join } = setup(tables, {
    afterInsert: (table, row) => {
      if (table !== "signups" || raced) return;
      raced = true; // another phone's claim for the same side landed first
      tables.signups.push({ id: "rival", name: "Other", email: "", share_token: row.share_token, family_id: FAM, created_at: "2026-10-29T11:59:59.000Z" });
    },
  });
  await refused(join({ ticket: TICKET_A }), 409, LINK_USED);
  assertEquals(tables.signups.map((s) => s.id), ["rival"]);
  assertEquals([tables.profiles.length, tables.devices.length], [1, 0]);
});

t("with the migration's unique index, a claim that lands second is a 409 too and makes nothing", async () => {
  const tables = world();
  // Another phone's claim for the same side commits between this join's check and its insert.
  const { join, deps } = setup(tables, { uniqueLink: true });
  const realFrom = deps.db.from.bind(deps.db);
  let signupsCalls = 0;
  let dupInsert = false;
  deps.db.from = ((table: string) => {
    // 1st signups call: the "already used?" check finds nothing. 2nd: the claim's insert; the rival lands first.
    if (table === "signups" && ++signupsCalls === 2) {
      tables.signups.push({ id: "rival", name: "Other", email: "", share_token: `link:${CARD}:cook`, family_id: FAM });
      dupInsert = true;
    }
    return realFrom(table);
  }) as typeof deps.db.from;
  await refused(join({ ticket: TICKET_A }), 409, LINK_USED);
  assert(dupInsert, "the rival landed between the check and the insert");
  assertEquals(signupsCalls, 2); // refused at the insert (23505), before the earliest-row check
  assertEquals(tables.signups.map((s) => s.id), ["rival"]);
  assertEquals([tables.profiles.length, tables.devices.length], [1, 0]);
});

t("a device that can't be made undoes the profile and the claim", async () => {
  const tables = world();
  const before = counts(tables);
  await refused(setup(tables, { failDevice: true }).join({ ticket: TICKET_A }), 500);
  assertEquals(counts(tables), before);
  assertEquals((await setup(tables).join({ ticket: TICKET_A })).joined, true); // and the side is still open
});
