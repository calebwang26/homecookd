// Offline checks for supabase/functions/api/joinLinks.ts (docs/build/JOIN-SIMPLE.md §3, §4, §6): the family's
// join link (POST /join-links, revoke, peek), 1.0's accept of one (426), and signing in with a link: a family
// join link, a 1.0 one-use invite or a dish card's ticket, the known account, the move and its receipt, and
// "Are you Leo?" (peek's claimable, and claim_profile_id becoming a phone-less person). No
// database and no network: a tiny in-memory stand-in for the Supabase client and fakes of index.ts's helpers
// (the routes themselves, through the real index.ts, are in api_test.ts).
//
// Run: npx --yes deno@2 test --node-modules-dir=none --allow-env supabase/tests/joinLinks_test.ts

import { assert, assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert@1.0.13";
import {
  ALREADY_ON,
  claimableIn,
  familyJoinLink,
  INVITE_GONE,
  JOIN_LINK_DAYS,
  type JoinDeps,
  LINK_GONE,
  NOT_IN_FAMILY,
  peekJoinLink,
  refuseJoinLinkAccept,
  revokeJoinLinks,
  signInByLink,
  UPDATE_TO_JOIN,
  type Who,
} from "../functions/api/joinLinks.ts";
import { type JoinPayload, LINK_USED } from "../functions/api/link.ts";

const t = (name: string, fn: () => void | Promise<void>) =>
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });

// --- tickets (link_test.ts has the shared vectors)

const SECRET = "test-link-secret-0123456789abcdef";
const FAM = "11111111-2222-4333-8444-555555555555"; // family B: the link's (the tickets name it)
const OLD = "99999999-9999-4999-8999-999999999999"; // family A: where a mover comes from
const CARD = "f25009a97fe921e7818ce826";
const EXP = 1893456000000;
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const DAY = 86_400_000;
const PAYLOAD_A: JoinPayload = { v: 1, fam: FAM, card: CARD, side: "cook", name: "Mom", exp: EXP, jti: "AbCdEfGhIjKlMnOp" };

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hmac = async (secret: string, data: string) => {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
};
/** Signs any object the way Convex does. */
async function sign(secret: string, payload: unknown): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}
const TICKET_A = await sign(SECRET, PAYLOAD_A);
const TICKET_B = await sign(SECRET, { ...PAYLOAD_A, side: "kid", name: "आजी", jti: "QrStUvWxYz012345" });

/** A receipt's payload, once its signature checks out. */
async function openReceipt(receipt: string) {
  const [body, sig] = receipt.split(".");
  assertEquals(sig, await hmac(SECRET, body), "signed with LINK_JOIN_SECRET");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
}

const sha = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const iso = (ms: number) => new Date(ms).toISOString();

// --- a fake Supabase client: select / insert / update / delete with eq, neq, is, not(is), gt, in, order,
// limit, single and maybeSingle. Rows get an id and an increasing created_at.

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

function fakeDb(tables: Tables, opts: { uniqueLink?: boolean; before?: (table: string, mode: string) => void } = {}) {
  let seq = 0;
  class Query {
    private filters: ((r: Row) => boolean)[] = [];
    private orders: [string, boolean][] = [];
    private max = Infinity;
    private mode: "select" | "insert" | "update" | "delete" = "select";
    private row: Row | null = null;
    private one: "single" | "maybe" | null = null;
    private returning = false;
    constructor(private table: string) {}
    select(_cols?: string) { this.returning = true; return this; }
    insert(row: Row) { this.mode = "insert"; this.row = row; return this; }
    update(patch: Row) { this.mode = "update"; this.row = patch; return this; }
    delete() { this.mode = "delete"; return this; }
    eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
    neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
    is(c: string, v: unknown) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
    not(c: string, op: string, v: unknown) {
      if (op !== "is") throw new Error(`fake: not.${op}`);
      this.filters.push((r) => (r[c] ?? null) !== v);
      return this;
    }
    gt(c: string, v: string) { this.filters.push((r) => r[c] != null && Date.parse(r[c]) > Date.parse(v)); return this; }
    in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
    order(c: string, o?: { ascending?: boolean }) { this.orders.push([c, o?.ascending !== false]); return this; }
    limit(n: number) { this.max = n; return this; }
    single() { this.one = "single"; return this; }
    maybeSingle() { this.one = "maybe"; return this; }
    // deno-lint-ignore no-explicit-any
    then(ok: (v: any) => unknown, bad?: (e: unknown) => unknown) {
      return Promise.resolve().then(() => this.run()).then(ok, bad);
    }
    private shape(rows: Row[]) {
      if (this.one === "maybe") return { data: rows[0] ?? null, error: null };
      if (this.one === "single") {
        return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116", message: "not one row" } };
      }
      return { data: rows, error: null };
    }
    private run() {
      opts.before?.(this.table, this.mode);
      const rows = (tables[this.table] ??= []);
      const dup = { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      if (this.mode === "insert") {
        const r = this.row!;
        if (this.table === "join_links" && rows.some((x) => x.token_hash === r.token_hash)) return dup;
        // migration 20261029090000: one signups row per 'link:' share token
        if (opts.uniqueLink && this.table === "signups" && String(r.share_token).startsWith("link:") && rows.some((x) => x.share_token === r.share_token)) return dup;
        seq++;
        const row = { id: `${this.table}-${seq}`, created_at: iso(NOW + seq * 1000), ...r };
        rows.push(row);
        return this.returning ? this.shape([row]) : { data: null, error: null };
      }
      const found = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.mode === "delete") {
        for (const r of found) rows.splice(rows.indexOf(r), 1);
        return { data: null, error: null };
      }
      if (this.mode === "update") {
        for (const r of found) Object.assign(r, this.row);
        return this.returning ? this.shape(found) : { data: null, error: null };
      }
      const sorted = [...found].sort((a, b) => {
        for (const [c, asc] of this.orders) if (a[c] !== b[c]) return (a[c] < b[c] ? -1 : 1) * (asc ? 1 : -1);
        return 0;
      }).slice(0, this.max);
      return this.shape(sorted);
    }
  }
  return { from: (table: string) => new Query(table) } as unknown as JoinDeps["db"];
}

// --- the world: family B (the link's) and family A (a mover's)

class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

const person = (id: string, family_id: string, name: string, role: string, sort: number) =>
  ({ id, family_id, name, role, relation: null, avatar_key: null, sort, removed_at: null, email: null });

const LIVE = "LiveLink".padEnd(22, "0"); // 22 characters: family join links
const EXPIRED = "ExpiredLink".padEnd(22, "0");
const REVOKED = "RevokedLink".padEnd(22, "0");
const UNKNOWN = "UnknownLink".padEnd(22, "0");
const INVITE = "OldInvite1".padEnd(16, "0"); // 16: a 1.0 one-use invite
const USED_INVITE = "OldInvite2".padEnd(16, "0");

async function world(opts: { soloA?: boolean } = {}): Promise<Tables> {
  return {
    families: [{ id: FAM, name: "Pawar" }, { id: OLD, name: "Wang" }],
    profiles: [
      person("p-caleb", FAM, "Caleb", "learner", 1),
      person("p-dad", FAM, "Dad", "cook", 2), // phone-less
      { ...person("p-asha", OLD, "Asha", "cook", 1), email: "asha@old.example" },
      person("p-grandma", OLD, "Grandma", "cook", 2), // phone-less
      person("p-olddad", OLD, "Dad", "cook", 3), // phone-less; B has a Dad already
      person("p-leo", OLD, "Leo", "learner", 4), // signs in unless soloA
    ],
    identities: [
      { provider: "apple", subject: "caleb-sub", profile_id: "p-caleb", email: null },
      { provider: "apple", subject: "asha-sub", profile_id: "p-asha", email: null },
    ],
    devices: [
      { id: "d-caleb", family_id: FAM, profile_id: "p-caleb", via: "apple", revoked_at: null },
      { id: "d-asha", family_id: OLD, profile_id: "p-asha", via: "apple", revoked_at: null },
      ...(opts.soloA ? [] : [{ id: "d-leo", family_id: OLD, profile_id: "p-leo", via: "invite", revoked_at: null }]),
    ],
    join_links: [
      { id: "jl-live", family_id: FAM, inviter_id: "p-caleb", token_hash: await sha(LIVE), token_enc: `sealed:jl-live:${LIVE}`, expires_at: iso(NOW + 5 * DAY), revoked_at: null },
      { id: "jl-expired", family_id: FAM, inviter_id: "p-caleb", token_hash: await sha(EXPIRED), token_enc: null, expires_at: iso(NOW - 1000), revoked_at: null },
      { id: "jl-revoked", family_id: FAM, inviter_id: "p-caleb", token_hash: await sha(REVOKED), token_enc: null, expires_at: iso(NOW + 5 * DAY), revoked_at: iso(NOW - DAY) },
    ],
    invites: [
      // A named invite (Caleb invited Dad on 1.0): joining by it still makes someone new.
      { id: "inv-1", family_id: FAM, inviter_id: "p-caleb", profile_id: "p-dad", token_hash: await sha(INVITE), status: "pending", expires_at: iso(NOW + DAY), used_at: null, used_device_id: null },
      { id: "inv-2", family_id: FAM, inviter_id: "p-caleb", profile_id: null, token_hash: await sha(USED_INVITE), status: "used", expires_at: iso(NOW + DAY), used_at: iso(NOW - DAY), used_device_id: "d-x" },
      // One Asha sent in her old family: it stops working when she leaves.
      { id: "inv-3", family_id: OLD, inviter_id: "p-asha", profile_id: null, token_hash: "x", status: "pending", expires_at: iso(NOW + DAY), used_at: null, used_device_id: null },
    ],
    signups: [],
    messages: [],
    move_requests: [],
  };
}

function setup(
  tables: Tables,
  opts: { secret?: string | null; uniqueLink?: boolean; before?: (table: string, mode: string) => void; lostLink?: boolean } = {},
) {
  const db = fakeDb(tables, { uniqueLink: opts.uniqueLink, before: opts.before });
  const rate: string[] = [];
  let tokens = 0;
  const profileOf = (id: string) => tables.profiles.find((p) => p.id === id);
  const familyName = (id: string) => tables.families.find((f) => f.id === id)?.name ?? "";
  let devices = 0;
  const deps: JoinDeps = {
    db,
    HttpError,
    dbFail: (context) => {
      throw new HttpError(500, `db error (${context})`);
    },
    rateLimit: (kind) => {
      rate.push(kind);
      return Promise.resolve();
    },
    sha256Hex: sha,
    newToken: () => `NewToken${String(++tokens).padStart(14, "0")}`,
    seal: (aad, text) => Promise.resolve(`sealed:${aad}:${text}`),
    open: (aad, sealed) => Promise.resolve(sealed?.startsWith(`sealed:${aad}:`) ? sealed.slice(`sealed:${aad}:`.length) : null),
    webUrl: "https://homecookd.app",
    // index.ts's addProfile(): names are unique per family, ignoring case.
    addProfile: (familyId, existing, p) => {
      const same = existing.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
      if (same) return Promise.reject(new HttpError(409, `${same.name} is already in this family`));
      const sort = existing.reduce((m, x) => Math.max(m, x.sort), 0) + 1;
      const row = { ...person(`p-new-${tables.profiles.length + 1}`, familyId, p.name, p.role, sort) };
      tables.profiles.push(row);
      return Promise.resolve(row);
    },
    createDevice: (familyId, profileId, via, label) => {
      const id = `d-new-${++devices}`;
      tables.devices.push({ id, family_id: familyId, profile_id: profileId, via, label, revoked_at: null });
      return Promise.resolve({ id, key: `key-${id}` });
    },
    quietNote: (familyId, profileId, body) => {
      tables.messages.push({ family_id: familyId, sender_id: profileId, body });
      return Promise.resolve();
    },
    knownIdentity: (who) => {
      const i = tables.identities.find((x) => x.provider === who.provider && x.subject === who.sub);
      if (!i) return Promise.resolve(null);
      const p = profileOf(i.profile_id);
      if (!p || p.removed_at) {
        tables.identities.splice(tables.identities.indexOf(i), 1);
        return Promise.resolve(null);
      }
      return Promise.resolve({ profile: p as Row & { id: string; family_id: string; name: string; role: string; sort: number }, familyName: familyName(p.family_id) });
    },
    linkIdentity: (who, profileId) => {
      if (opts.lostLink) {
        // Another tap linked this account to Caleb's profile a moment ago.
        tables.identities.push({ provider: who.provider, subject: who.sub, profile_id: "p-caleb", email: null });
      }
      if (tables.identities.some((x) => x.provider === who.provider && x.subject === who.sub)) return Promise.resolve(false);
      tables.identities.push({ provider: who.provider, subject: who.sub, profile_id: profileId, email: who.email });
      return Promise.resolve(true);
    },
    signInKnown: async (who, known, label) => {
      const dev = await deps.createDevice(known.profile.family_id, known.profile.id, who.provider, label);
      return { existing: true, needs_name: false, joined: false, device_key: dev.key, family_name: known.familyName, profile_id: known.profile.id };
    },
    afterLostLink: async (who, made, label) => {
      if (made.profileId) tables.profiles.splice(tables.profiles.findIndex((p) => p.id === made.profileId), 1);
      const known = await deps.knownIdentity(who);
      if (!known) throw new HttpError(409, "Please try again.");
      return deps.signInKnown(who, known, label);
    },
    // index.ts's removeProfile().
    removeProfile: (familyId, profileId) => {
      for (const d of tables.devices) if (d.profile_id === profileId && !d.revoked_at) d.revoked_at = iso(NOW);
      for (const i of tables.invites) {
        if (i.status === "pending" && (i.profile_id === profileId || (i.inviter_id === profileId && !i.profile_id))) i.status = "revoked";
      }
      tables.identities = tables.identities.filter((i) => i.profile_id !== profileId);
      const p = tables.profiles.find((x) => x.id === profileId && x.family_id === familyId && !x.removed_at);
      if (p) Object.assign(p, { removed_at: iso(NOW), email: null });
      return Promise.resolve();
    },
    secret: () => (opts.secret === undefined ? SECRET : opts.secret ?? undefined),
    now: () => NOW,
  };
  const signIn = (who: Who, b: Record<string, unknown>) =>
    signInByLink(deps, who, b, {
      name: typeof b.name === "string" ? b.name.trim() || null : null,
      role: (b.role as "cook" | "learner" | undefined) ?? null,
      label: (b.device_label as string | undefined) ?? null,
      ip: "203.0.113.7",
    });
  return { deps, rate, signIn };
}

const apple = (sub: string, givenName: string | null = null): Who => ({ provider: "apple", sub, email: `${sub}@example.com`, givenName });

async function refused(p: Promise<unknown>, status: number, includes?: string) {
  const e = await assertRejects(() => p, HttpError);
  assertEquals(e.status, status, e.message);
  if (includes) assert(e.message.includes(includes), e.message);
  return e;
}

const snapshot = (tables: Tables) => structuredClone(tables);

// --- a family join link

t("a new account joins by a live link: a new profile, the account, a phone key, signups join:<id>, the note", async () => {
  const tables = await world();
  const { signIn, rate } = setup(tables);
  const res = await signIn(apple("asha2"), { join_token: LIVE, name: "Priya", role: "cook", device_label: "iPhone" });
  const priya = tables.profiles.find((p) => p.name === "Priya")!;
  assertEquals(res, { existing: false, needs_name: false, joined: true, device_key: "key-d-new-1", family_name: "Pawar", profile_id: priya.id });
  assertEquals([priya.family_id, priya.role, priya.sort], [FAM, "cook", 3]);
  assertEquals(tables.identities.at(-1), { provider: "apple", subject: "asha2", profile_id: priya.id, email: "asha2@example.com" });
  assertEquals(tables.devices.at(-1), { id: "d-new-1", family_id: FAM, profile_id: priya.id, via: "apple", label: "iPhone", revoked_at: null });
  assertEquals(tables.signups.map((s) => [s.name, s.email, s.share_token, s.family_id]), [["Priya", "asha2@example.com", "join:jl-live", FAM]]);
  assertEquals(tables.messages, [{ family_id: FAM, sender_id: priya.id, body: "Priya joined" }]);
  assertEquals(rate, ["linkjoin-ip"]);
  // The link isn't used up: anyone else may join by it too, as a learner by default.
  const next = await signIn(apple("someone"), { join_token: ` ${LIVE} `, name: "Kai" }) as Row;
  assertEquals(tables.profiles.find((p) => p.id === next.profile_id)!.role, "learner");
});

t("a new account without a name gets needs_name and nothing is made; a card suggests its name", async () => {
  const tables = await world();
  const before = snapshot(tables);
  const { signIn } = setup(tables);
  assertEquals(await signIn(apple("new", "Asha"), { join_token: LIVE }), { existing: false, needs_name: true, suggested_name: "Asha" });
  assertEquals(await signIn(apple("new", "Asha"), { link_ticket: TICKET_A }), { existing: false, needs_name: true, suggested_name: "Mom" });
  assertEquals(await signIn(apple("new"), { join_token: INVITE, name: "  " }), { existing: false, needs_name: true, suggested_name: null });
  assertEquals(tables, before, "the card side and the invite are still open");
});

t("expired and revoked links get 410 with their sentence and make nothing; unknown tokens 404", async () => {
  const tables = await world();
  const before = snapshot(tables);
  const { signIn, rate } = setup(tables);
  const exp = await refused(signIn(apple("new"), { join_token: EXPIRED, name: "Priya" }), 410, LINK_GONE.expired);
  assertEquals(exp.extra, { status: "expired" });
  const rev = await refused(signIn(apple("new"), { join_token: REVOKED, name: "Priya" }), 410, LINK_GONE.revoked);
  assertEquals(rev.extra, { status: "revoked" });
  // Even someone already in the family needs a live link to come in by it.
  await refused(signIn(apple("caleb-sub"), { join_token: EXPIRED }), 410);
  await refused(signIn(apple("new"), { join_token: UNKNOWN, name: "Priya" }), 404, "doesn't work");
  await refused(signIn(apple("new"), { join_token: "short", name: "Priya" }), 404);
  await refused(signIn(apple("new"), { join_token: 42 }), 400);
  assertEquals(tables, before);
  assertEquals(rate.filter((k) => k === "badinvite").length, 2, "misses count against the IP");
});

t("a known account in the link's family just signs in, and nothing is used up", async () => {
  const tables = await world();
  const { signIn } = setup(tables);
  const people = tables.profiles.length;
  for (const b of [{ join_token: LIVE, name: "Someone" }, { link_ticket: TICKET_A }, { join_token: INVITE, move: true }]) {
    const res = await signIn(apple("caleb-sub"), b);
    assertEquals([res.existing, (res as { profile_id: string }).profile_id, (res as { family_name: string }).family_name], [true, "p-caleb", "Pawar"], JSON.stringify(b));
  }
  assertEquals(tables.profiles.length, people);
  assertEquals(tables.signups, [], "the card side wasn't claimed");
  assertEquals(tables.invites.find((i) => i.id === "inv-1")!.status, "pending", "the invite is still open");
  assertEquals(tables.messages, []);
});

// --- moving between families

t("a known account in another family gets needs_move and nothing changes; move:true moves them", async () => {
  const tables = await world(); // Leo signs in to the Wang family: not solo
  const { signIn } = setup(tables);
  const before = snapshot(tables);
  for (const move of [undefined, false]) {
    const ask = await signIn(apple("asha-sub"), { join_token: LIVE, name: "Asha", move });
    assertEquals(ask, { existing: true, needs_move: true, from_family: "Wang", to_family: "Pawar" });
  }
  assertEquals(tables, before, "nothing changed");

  const res = await signIn(apple("asha-sub"), { join_token: LIVE, move: true, role: "cook", device_label: "iPhone" }) as Row;
  const fresh = tables.profiles.find((p) => p.id === res.profile_id)!;
  assertEquals([fresh.family_id, fresh.name, fresh.role], [FAM, "Asha", "cook"], "the old name, in the link's family");
  assertEquals([res.existing, res.needs_name, res.joined, res.family_name, res.device_key], [true, false, true, "Pawar", "key-d-new-1"]);
  // In the Wang family: she left as "Leave the family" does.
  const old = tables.profiles.find((p) => p.id === "p-asha")!;
  assert(old.removed_at, "removed");
  assertEquals(old.email, null);
  assertEquals(tables.devices.find((d) => d.id === "d-asha")!.revoked_at, iso(NOW), "her old phone key is signed out");
  assertEquals(tables.invites.find((i) => i.id === "inv-3")!.status, "revoked", "the family invite she sent stops working");
  // Her account moved; this phone has a new key in the Pawar family.
  assertEquals(tables.identities.filter((i) => i.subject === "asha-sub").map((i) => i.profile_id), [fresh.id]);
  assertEquals(tables.devices.at(-1)!.profile_id, fresh.id);
  assertEquals(tables.messages, [
    { family_id: OLD, sender_id: "p-asha", body: "Asha left" },
    { family_id: FAM, sender_id: fresh.id, body: "Asha joined" },
  ]);
  assertEquals(tables.signups.map((s) => s.share_token), ["join:jl-live"]);
  // Leo still signs in to the Wang family, so nobody else moves and the recipes stay.
  assertEquals(tables.profiles.filter((p) => p.family_id === OLD && !p.removed_at).map((p) => p.name), ["Grandma", "Dad", "Leo"]);
  const r = await openReceipt(res.moved.receipt);
  assertEquals(r, { v: 1, kind: "moved", fromProfile: "p-asha", fromFamily: OLD, toProfile: fresh.id, toFamily: FAM, solo: false, faces: [], exp: NOW + 3_600_000 });
  // Signing in again is just a sign-in to the Pawars.
  const again = await signIn(apple("asha-sub"), { join_token: LIVE }) as Row;
  assertEquals([again.existing, again.profile_id], [true, fresh.id]);
});

t("solo: the old family's phone-less faces come along (not one the new family has a name for), and the receipt says so", async () => {
  const tables = await world({ soloA: true });
  const { signIn } = setup(tables);
  const res = await signIn(apple("asha-sub"), { link_ticket: TICKET_A, name: "Mom", move: true }) as Row;
  const mom = tables.profiles.find((p) => p.id === res.profile_id)!;
  assertEquals([mom.family_id, mom.name, mom.role], [FAM, "Mom", "cook"], "the body's name, the card side's role");
  const at = (id: string) => tables.profiles.find((p) => p.id === id)!;
  assertEquals([at("p-grandma").family_id, at("p-leo").family_id], [FAM, FAM]);
  assertEquals(at("p-olddad").family_id, OLD, "the Pawars have a Dad already: the Wangs' stays");
  assertEquals([mom.sort, at("p-grandma").sort, at("p-leo").sort], [3, 4, 5]);
  const r = await openReceipt(res.moved.receipt);
  assertEquals(r, {
    v: 1, kind: "moved", fromProfile: "p-asha", fromFamily: OLD, toProfile: mom.id, toFamily: FAM,
    solo: true, faces: ["p-grandma", "p-leo"], exp: NOW + 3_600_000,
  });
  assertEquals(tables.signups.map((s) => s.share_token), [`link:${CARD}:cook`], "the card side is used up");
});

t("a move with a name the new family has changes nothing; without LINK_JOIN_SECRET the receipt is null", async () => {
  const tables = await world({ soloA: true });
  const before = snapshot(tables);
  await refused(setup(tables).signIn(apple("asha-sub"), { join_token: LIVE, name: "caleb", move: true }), 409, "already in this family");
  await refused(setup(tables).signIn(apple("asha-sub"), { link_ticket: TICKET_A, name: "Dad", move: true }), 409);
  assertEquals(tables, before, "still in the Wang family; the card side is open");
  const res = await setup(tables, { secret: null }).signIn(apple("asha-sub"), { join_token: LIVE, move: true }) as Row;
  assertEquals(res.moved, { receipt: null });
  assertEquals(tables.profiles.find((p) => p.id === "p-grandma")!.family_id, FAM, "a solo move still brings the faces");
});

// --- a dish card's ticket

t("a ticket joins once per card side, with the side's role; the family comes only from the ticket", async () => {
  const tables = await world();
  const { signIn } = setup(tables);
  const res = await signIn(apple("ma"), { link_ticket: TICKET_A, name: "Ma", role: "learner", family_id: OLD }) as Row;
  const ma = tables.profiles.find((p) => p.id === res.profile_id)!;
  assertEquals([ma.family_id, ma.role, res.family_name, res.joined], [FAM, "cook", "Pawar", true]);
  assertEquals(tables.signups.map((s) => [s.name, s.share_token, s.family_id]), [["Ma", `link:${CARD}:cook`, FAM]]);
  assertEquals(tables.messages.at(-1), { family_id: FAM, sender_id: ma.id, body: "Ma joined" });
  const before = snapshot(tables);
  await refused(signIn(apple("other"), { link_ticket: TICKET_A, name: "Auntie" }), 409, LINK_USED);
  const fresh = await sign(SECRET, { ...PAYLOAD_A, jti: "ZZZZZZZZZZZZZZZZ", name: "Auntie" }); // a new ticket, same side
  await refused(signIn(apple("other"), { link_ticket: fresh, name: "Auntie" }), 409, LINK_USED);
  await refused(signIn(apple("asha-sub"), { link_ticket: TICKET_A, move: true }), 409, LINK_USED);
  assertEquals(tables, before);
  // The other side joins, once, as a learner.
  const kid = await signIn(apple("aaji"), { link_ticket: TICKET_B, name: "आजी", role: "cook" }) as Row;
  assertEquals(tables.profiles.find((p) => p.id === kid.profile_id)!.role, "learner");
});

t("two joins on one side at once: the claim that lands second gets 409 (unique index or earliest row)", async () => {
  // With the unique index: another phone's claim commits between this join's check and its insert.
  const tables = await world();
  let inserts = 0;
  const { signIn } = setup(tables, {
    uniqueLink: true,
    before: (table, mode) => {
      if (table === "signups" && mode === "insert" && ++inserts === 1) {
        tables.signups.push({ id: "rival", share_token: `link:${CARD}:cook`, family_id: FAM, created_at: iso(NOW - 1) });
      }
    },
  });
  await refused(signIn(apple("ma"), { link_ticket: TICKET_A, name: "Ma" }), 409, LINK_USED);
  assertEquals(tables.signups.map((s) => s.id), ["rival"]);
  assertEquals(tables.profiles.length, 6, "nobody was made");

  // Before the index: the rival's row lands just after this one, but is earlier; this join backs out.
  const t2 = await world();
  let raced = false;
  const late = setup(t2, {
    before: (table, mode) => {
      if (table === "signups" && mode === "select" && t2.signups.length === 1 && !raced) {
        raced = true;
        t2.signups.push({ id: "rival", share_token: `link:${CARD}:cook`, family_id: FAM, created_at: iso(NOW - 1) });
      }
    },
  });
  await refused(late.signIn(apple("ma"), { link_ticket: TICKET_A, name: "Ma" }), 409, LINK_USED);
  assertEquals(t2.signups.map((s) => s.id), ["rival"]);
  assertEquals(t2.profiles.length, 6);
});

t("a name already in the family claims nobody, makes nothing, and the side stays open", async () => {
  const tables = await world();
  const before = snapshot(tables);
  const { signIn } = setup(tables);
  // Dad is in the family (and invited on 1.0): a link join never becomes him.
  await refused(signIn(apple("x"), { link_ticket: TICKET_A, name: "dad" }), 409, "is already in this family");
  assertEquals(tables, before);
  const res = await signIn(apple("x"), { link_ticket: TICKET_A, name: "Papa" }) as Row;
  assertNotEquals(res.profile_id, "p-dad");
});

t("another tap linked the account first: this join backs out (the side reopens) and signs in as that one", async () => {
  const tables = await world();
  const res = await setup(tables, { lostLink: true }).signIn(apple("x"), { link_ticket: TICKET_A, name: "Ma" }) as Row;
  assertEquals([res.existing, res.profile_id], [true, "p-caleb"]);
  assert(!tables.profiles.some((p) => p.name === "Ma"), "the profile it made is gone");
  assertEquals(tables.signups, [], "the side is open again");
});

t("bad, forged and expired tickets get 403; no secret 503; both kinds of link, or a move that isn't true/false, 400", async () => {
  const tables = await world();
  const before = snapshot(tables);
  const { signIn } = setup(tables);
  await refused(signIn(apple("x"), { link_ticket: TICKET_A.slice(0, -2) + "xx", name: "Ma" }), 403);
  await refused(signIn(apple("x"), { link_ticket: await sign(SECRET, { ...PAYLOAD_A, exp: NOW }), name: "Ma" }), 403);
  await refused(signIn(apple("x"), { link_ticket: await sign("other-secret", PAYLOAD_A), name: "Ma" }), 403);
  await refused(signIn(apple("x"), { link_ticket: 5, name: "Ma" }), 400);
  await refused(setup(tables, { secret: null }).signIn(apple("x"), { link_ticket: TICKET_A, name: "Ma" }), 503, "Links aren't set up yet.");
  await refused(signIn(apple("x"), { link_ticket: TICKET_A, join_token: LIVE, name: "Ma" }), 400, "not both");
  await refused(signIn(apple("x"), { join_token: LIVE, name: "Ma", move: "yes" }), 400, "move");
  const gone = await sign(SECRET, { ...PAYLOAD_A, fam: "12345678-1234-4234-8234-123456789012" });
  await refused(signIn(apple("x"), { link_ticket: gone, name: "Ma" }), 404, "isn't on homecookd");
  assertEquals(tables, before);
});

// --- a 1.0 phone's one-use invite

t("an old one-use invite joins a NEW person (never the invited face) and is used up; a used one gets 410", async () => {
  const tables = await world();
  const { signIn } = setup(tables);
  const res = await signIn(apple("papa"), { join_token: INVITE, name: "Papa", role: "cook" }) as Row;
  const papa = tables.profiles.find((p) => p.id === res.profile_id)!;
  assertNotEquals(papa.id, "p-dad");
  assertEquals([papa.family_id, papa.name, papa.role, res.joined], [FAM, "Papa", "cook", true]);
  const inv = tables.invites.find((i) => i.id === "inv-1")!;
  assertEquals([inv.status, inv.used_at, inv.used_device_id], ["used", iso(NOW), "d-new-1"]);
  assertEquals(tables.signups.map((s) => s.share_token), ["invite:inv-1"]);
  assertEquals(tables.profiles.find((p) => p.id === "p-dad")!.family_id, FAM, "Dad untouched");
  const again = await refused(signIn(apple("other"), { join_token: INVITE, name: "Uncle" }), 410, INVITE_GONE.used);
  assertEquals(again.extra, { status: "used" });
  await refused(signIn(apple("other"), { join_token: USED_INVITE, name: "Uncle" }), 410, "This invite was already used.");
  tables.invites.find((i) => i.id === "inv-1")!.status = "pending";
  tables.invites.find((i) => i.id === "inv-1")!.expires_at = iso(NOW - 1);
  await refused(signIn(apple("other"), { join_token: INVITE, name: "Uncle" }), 410, INVITE_GONE.expired);
});

t("an old invite whose join fails is put back; of two joins at once exactly one gets it", async () => {
  const tables = await world();
  const { signIn } = setup(tables);
  await refused(signIn(apple("x"), { join_token: INVITE, name: "Caleb" }), 409, "already in this family");
  assertEquals(tables.invites.find((i) => i.id === "inv-1")!.status, "pending", "put back");
  const both = await Promise.allSettled([
    signIn(apple("one"), { join_token: INVITE, name: "One" }),
    signIn(apple("two"), { join_token: INVITE, name: "Two" }),
  ]);
  assertEquals(both.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  const lost = both.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assertEquals([lost.reason.status, lost.reason.message], [410, INVITE_GONE.used]);
  assertEquals(tables.signups.length, 1);
  assertEquals(tables.profiles.filter((p) => p.name === "One" || p.name === "Two").length, 1);
});

// --- POST /join-links, revoke, peek, and 1.0's accept

t("the family's link is the same all week, new in its last day or after revoke; the operator's never shows", async () => {
  const tables = await world();
  tables.join_links.push({ id: "jl-test", family_id: FAM, inviter_id: null, token_hash: "f".repeat(64), token_enc: null, expires_at: null, revoked_at: null });
  const { deps } = setup(tables);
  assertEquals(await familyJoinLink(deps, FAM, "p-caleb"), { url: `https://homecookd.app/i?t=${LIVE}`, expires_at: iso(NOW + 5 * DAY) });

  // A family with no link gets a new one: only its hash and the sealed token are stored.
  const made = await familyJoinLink(deps, OLD, "p-asha");
  const token = new URL(made.url).searchParams.get("t")!;
  assert(/^[0-9A-Za-z]{22}$/.test(token), token);
  assertEquals(made.expires_at, iso(NOW + JOIN_LINK_DAYS * DAY));
  const row = tables.join_links.at(-1)!;
  assertEquals([row.family_id, row.inviter_id, row.token_hash, row.token_enc, row.revoked_at ?? null], [OLD, "p-asha", await sha(token), `sealed:${row.id}:${token}`, null]);
  assert(!JSON.stringify(row).includes(`"${token}"`), "the token itself isn't stored in the clear");
  assertEquals(await familyJoinLink(deps, OLD, "p-leo"), made, "the same link for anyone in the family");

  // Inside its last day it's replaced (the old one keeps working until it expires).
  tables.join_links.find((l) => l.id === "jl-live")!.expires_at = iso(NOW + DAY - 1);
  const fresh = await familyJoinLink(deps, FAM, "p-caleb");
  assertNotEquals(fresh.url, `https://homecookd.app/i?t=${LIVE}`);
  // Revoke turns off the live links, not the operator's; the next call makes a new one.
  assertEquals(await revokeJoinLinks(deps, FAM), { ok: true });
  const fam = tables.join_links.filter((l) => l.family_id === FAM);
  assertEquals(fam.filter((l) => !l.revoked_at).map((l) => l.id), ["jl-test"]);
  const after = await familyJoinLink(deps, FAM, "p-caleb");
  assert(![fresh.url, `https://homecookd.app/i?t=${LIVE}`].includes(after.url));
});

t("peek: a join link's family, sender and status, kind link; an unknown one is null", async () => {
  const tables = await world();
  const { deps } = setup(tables);
  const same = (familyId: string) => Promise.resolve(familyId === OLD ? true : undefined);
  assertEquals(await peekJoinLink(deps, LIVE, same), {
    status: "pending", family_name: "Pawar", inviter: { name: "Caleb", relation: null, avatar_key: null }, invitee: null,
    expires_at: iso(NOW + 5 * DAY), same_family: undefined, kind: "link", claimable: null,
  });
  assertEquals((await peekJoinLink(deps, EXPIRED, same))!.status, "expired");
  assertEquals((await peekJoinLink(deps, REVOKED, same))!.status, "revoked");
  tables.profiles.find((p) => p.id === "p-caleb")!.removed_at = iso(NOW);
  assertEquals((await peekJoinLink(deps, LIVE, same))!.inviter, null, "someone who left isn't shown as the sender");
  assertEquals(await peekJoinLink(deps, UNKNOWN, same), null);
  const theirs = await familyJoinLink(deps, OLD, "p-asha");
  assertEquals((await peekJoinLink(deps, new URL(theirs.url).searchParams.get("t")!, same))!.same_family, true);
});

t("1.0's Join tap (POST /invites/accept) on a 22-character join link: 426; old tokens and codes pass through", () => {
  let e: HttpError | null = null;
  try {
    refuseJoinLinkAccept(HttpError, ` ${LIVE} `);
  } catch (err) {
    e = err as HttpError;
  }
  assertEquals([e?.status, e?.message], [426, UPDATE_TO_JOIN]);
  for (const token of [INVITE, "ABCDEF", undefined, null, 5, "x".repeat(23)]) refuseJoinLinkAccept(HttpError, token);
});

// --- "Are you Leo?": a phone-less person someone added before they had the app

const peekAs = async (tables: Tables, name: unknown, token = LIVE) =>
  (await peekJoinLink(setup(tables).deps, token, () => Promise.resolve(undefined), name))!.claimable;
const DAD_FACE = { id: "p-dad", name: "Dad", avatar_key: null };

t("peek: claimable is the one phone-less person of exactly the typed name, ignoring case and spaces", async () => {
  const tables = await world();
  tables.profiles.find((p) => p.id === "p-dad")!.avatar_key = "dad";
  assertEquals(await peekAs(tables, "Dad"), { ...DAD_FACE, avatar_key: "dad" });
  assertEquals(await peekAs(tables, "  dAD  "), { ...DAD_FACE, avatar_key: "dad" });
  tables.profiles.push(person("p-nani", FAM, "Nani  Ma", "cook", 3));
  assertEquals((await peekAs(tables, " nani ma"))?.id, "p-nani", "extra spaces inside the name too");
  // No name, nothing that's only close, and nobody who signs in: never a list.
  for (const name of [undefined, null, "", "   ", 42, "Da", "Dad Jr", "Caleb", "x".repeat(300)]) {
    assertEquals(await peekAs(tables, name), null, JSON.stringify(name));
  }
  assertEquals(await peekAs(tables, "Grandma"), null, "another family's phone-less Grandma");
  // A signed-out phone (revoked) doesn't count; a live one does.
  tables.devices.push({ id: "d-dad-old", family_id: FAM, profile_id: "p-dad", via: "invite", revoked_at: iso(NOW - DAY) });
  assertEquals((await peekAs(tables, "dad"))?.id, "p-dad");
  tables.devices.push({ id: "d-dad", family_id: FAM, profile_id: "p-dad", via: "invite", revoked_at: null });
  assertEquals(await peekAs(tables, "dad"), null, "a live phone");
});

t("peek: null for someone with an account, someone removed, two of that name, or a link that's gone", async () => {
  const withIdentity = await world();
  withIdentity.identities.push({ provider: "google", subject: "dad-sub", profile_id: "p-dad", email: null });
  assertEquals(await peekAs(withIdentity, "Dad"), null, "an account");
  const removed = await world();
  removed.profiles.find((p) => p.id === "p-dad")!.removed_at = iso(NOW - DAY);
  assertEquals(await peekAs(removed, "Dad"), null, "removed");
  const two = await world();
  two.profiles.push(person("p-dad2", FAM, "DAD ", "cook", 3));
  assertEquals(await peekAs(two, "dad"), null, "two of that name");
  const gone = await world();
  assertEquals(await peekAs(gone, "Dad", EXPIRED), null, "an expired link");
  assertEquals(await peekAs(gone, "Dad", REVOKED), null, "a turned-off link");
  // index.ts's peek of an old family invite asks the same question.
  assertEquals(await claimableIn(setup(gone).deps, FAM, " dad"), DAD_FACE);
});

t("a claim attaches the account and this phone to the existing person: no new profile, their name and role, the note", async () => {
  const tables = await world();
  const { signIn } = setup(tables);
  const people = tables.profiles.length;
  // The body's name and role are ignored for a claim; no name is needed at all.
  const res = await signIn(apple("dad-sub"), { join_token: LIVE, claim_profile_id: " p-dad ", name: "Papa", role: "learner", device_label: "iPhone" });
  assertEquals(res, { existing: false, needs_name: false, joined: true, device_key: "key-d-new-1", family_name: "Pawar", profile_id: "p-dad" });
  assertEquals(tables.profiles.length, people, "nobody new");
  const dad = tables.profiles.find((p) => p.id === "p-dad")!;
  assertEquals([dad.name, dad.role, dad.family_id, dad.removed_at], ["Dad", "cook", FAM, null]);
  assertEquals(tables.identities.at(-1), { provider: "apple", subject: "dad-sub", profile_id: "p-dad", email: "dad-sub@example.com" });
  assertEquals(tables.devices.at(-1), { id: "d-new-1", family_id: FAM, profile_id: "p-dad", via: "apple", label: "iPhone", revoked_at: null });
  assertEquals(tables.signups.map((s) => [s.name, s.share_token, s.family_id]), [["Dad", "link:claim:p-dad", FAM]]);
  assertEquals(tables.messages, [{ family_id: FAM, sender_id: "p-dad", body: "Dad joined" }]);
  assertEquals(tables.invites.find((i) => i.id === "inv-1")!.status, "revoked", "the 1.0 invite naming Dad stops working");
  assertEquals(tables.join_links.find((l) => l.id === "jl-live")!.revoked_at, null, "a join link isn't used up");
  // The same account again is just a sign-in as Dad.
  const again = await signIn(apple("dad-sub"), { join_token: LIVE, claim_profile_id: "p-dad" }) as Row;
  assertEquals([again.existing, again.profile_id], [true, "p-dad"]);
});

t("a claim through an old family invite uses the invite up, once", async () => {
  const tables = await world();
  const FAMILY_INVITE = "FamInvite1".padEnd(16, "0");
  tables.invites.push({ id: "inv-4", family_id: FAM, inviter_id: "p-caleb", profile_id: null, token_hash: await sha(FAMILY_INVITE), status: "pending", expires_at: iso(NOW + DAY), used_at: null, used_device_id: null });
  const { signIn } = setup(tables);
  const res = await signIn(apple("dad-sub"), { join_token: FAMILY_INVITE, claim_profile_id: "p-dad" }) as Row;
  assertEquals([res.profile_id, res.joined], ["p-dad", true]);
  const inv = tables.invites.find((i) => i.id === "inv-4")!;
  assertEquals([inv.status, inv.used_device_id], ["used", "d-new-1"]);
  await refused(signIn(apple("other"), { join_token: FAMILY_INVITE, name: "Kai" }), 410, INVITE_GONE.used);
});

t("a claim is refused for someone with a live phone or an account, another family's person, or someone removed", async () => {
  const cases: [string, (tables: Tables) => void, Record<string, unknown>, string][] = [
    ["a live phone", (x) => x.devices.push({ id: "d-dad", family_id: FAM, profile_id: "p-dad", via: "invite", revoked_at: null }), { claim_profile_id: "p-dad" }, ALREADY_ON],
    ["an account", (x) => x.identities.push({ provider: "google", subject: "dad-g", profile_id: "p-dad", email: null }), { claim_profile_id: "p-dad" }, ALREADY_ON],
    ["someone signed in", () => {}, { claim_profile_id: "p-caleb" }, ALREADY_ON],
    ["another family's", () => {}, { claim_profile_id: "p-grandma" }, NOT_IN_FAMILY],
    ["no such person", () => {}, { claim_profile_id: "p-nobody" }, NOT_IN_FAMILY],
    ["removed", (x) => (x.profiles.find((p) => p.id === "p-dad")!.removed_at = iso(NOW - DAY)), { claim_profile_id: "p-dad" }, NOT_IN_FAMILY],
  ];
  for (const [what, arrange, body, sentence] of cases) {
    const tables = await world();
    arrange(tables);
    const before = snapshot(tables);
    const e = await refused(setup(tables).signIn(apple("new"), { join_token: LIVE, name: "Dad", ...body }), 409, sentence);
    assertEquals(e.message, sentence, what);
    assertEquals(tables, before, `${what}: nothing changed`);
  }
});

t("one claim per person: a second claim, a claim row already there, and the 23505 race all get 409", async () => {
  // A second claim after the first: Dad has an account now.
  const tables = await world();
  const { signIn } = setup(tables);
  await signIn(apple("dad-sub"), { join_token: LIVE, claim_profile_id: "p-dad" });
  await refused(signIn(apple("impostor"), { join_token: LIVE, claim_profile_id: "p-dad" }), 409, ALREADY_ON);
  assertEquals(tables.identities.filter((i) => i.profile_id === "p-dad").map((i) => i.subject), ["dad-sub"]);

  // Another claim's row is there (its phone is mid-join): refused before anything is attached.
  const mid = await world();
  mid.signups.push({ id: "rival", share_token: "link:claim:p-dad", family_id: FAM, created_at: iso(NOW - 1) });
  const before = snapshot(mid);
  await refused(setup(mid).signIn(apple("new"), { join_token: LIVE, claim_profile_id: "p-dad" }), 409, ALREADY_ON);
  assertEquals(mid, before);

  // The race: another phone's claim commits between this one's check and its insert (the unique index).
  const race = await world();
  let inserts = 0;
  const raced = setup(race, {
    uniqueLink: true,
    before: (table, mode) => {
      if (table === "signups" && mode === "insert" && ++inserts === 1) {
        race.signups.push({ id: "rival", share_token: "link:claim:p-dad", family_id: FAM, created_at: iso(NOW - 1) });
      }
    },
  });
  await refused(raced.signIn(apple("new"), { join_token: LIVE, claim_profile_id: "p-dad" }), 409, ALREADY_ON);
  assertEquals(race.signups.map((s) => s.id), ["rival"]);
  assert(!race.identities.some((i) => i.profile_id === "p-dad"), "no account attached");
  assertEquals(race.devices.length, 3, "no phone attached");
});

t("a claim whose join fails puts the claim and the old invite back; a lost link signs in as the other tap did", async () => {
  const tables = await world();
  const before = snapshot(tables);
  const { deps } = setup(tables);
  deps.createDevice = () => Promise.reject(new HttpError(500, "db error (device)"));
  const signIn = (b: Record<string, unknown>) => signInByLink(deps, apple("dad-sub"), b, { name: null, role: null, label: null, ip: "203.0.113.7" });
  await refused(signIn({ join_token: INVITE, claim_profile_id: "p-dad" }), 500);
  assertEquals(tables, before, "no claim row, no account, the invite open again");
  // Another tap linked this Apple ID to Caleb a moment ago: Dad stays as he was.
  const lost = await setup(tables, { lostLink: true }).signIn(apple("x"), { join_token: LIVE, claim_profile_id: "p-dad" }) as Row;
  assertEquals([lost.existing, lost.profile_id], [true, "p-caleb"]);
  assert(tables.profiles.some((p) => p.id === "p-dad" && !p.removed_at), "Dad isn't deleted");
  assertEquals(tables.signups, [], "the claim is open again");
});

t("claim_profile_id goes only with a join link (a ticket or no link: 400); a known account's is ignored", async () => {
  const tables = await world();
  const before = snapshot(tables);
  const { signIn } = setup(tables);
  await refused(signIn(apple("new"), { link_ticket: TICKET_A, claim_profile_id: "p-dad", name: "Ma" }), 400, "claim_profile_id");
  await refused(signIn(apple("new"), { claim_profile_id: "p-dad", name: "Ma" }), 400, "claim_profile_id");
  await refused(signIn(apple("new"), { join_token: LIVE, claim_profile_id: 7 }), 400, "claim_profile_id");
  assertEquals(tables, before);
  // Someone already in the family just signs in as themselves.
  const caleb = await signIn(apple("caleb-sub"), { join_token: LIVE, claim_profile_id: "p-dad" }) as Row;
  assertEquals([caleb.existing, caleb.profile_id], [true, "p-caleb"]);
  // Someone in another family is asked to move, and moves as a new person, not Dad.
  assertEquals(await signIn(apple("asha-sub"), { join_token: LIVE, claim_profile_id: "p-dad" }), { existing: true, needs_move: true, from_family: "Wang", to_family: "Pawar" });
  const moved = await signIn(apple("asha-sub"), { join_token: LIVE, claim_profile_id: "p-dad", move: true }) as Row;
  assertNotEquals(moved.profile_id, "p-dad");
  assertEquals(tables.profiles.find((p) => p.id === moved.profile_id)!.name, "Asha");
  assert(!tables.identities.some((i) => i.profile_id === "p-dad"), "Dad is still phone-less");
  assert(!tables.signups.some((s) => s.share_token === "link:claim:p-dad"));
});
