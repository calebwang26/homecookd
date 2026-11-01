// Share links, recordings on their way, hearts, and which recipes someone opened, cooked or listened to.
//
// SQL, with its index:
//   A share link                       shares primary key, shares_family_library
//   Recordings on their way            pending_sends primary key
//   My hearts                          favorites primary key
//   Hearts on a dish                   favorites_library
//   Recent hearts on my dishes         favorites_library, filtered by time
//   An event, once per window          recipe_events_person_dedupe
//   My stats                           recipe_events_person_recent, favorites primary key, messages_thread_kind
//   One dish's activity                recipe_events_family_library, messages_family_library
import { randomBytes } from "node:crypto";
import type { Signed } from "../../auth.js";
import { db, tx } from "../../db.js";
import { ApiError, notFound } from "../../errors.js";
import { once, requestHash } from "../../idempotency.js";
import { hit, subjectKey, type Limit } from "../../rateLimit.js";
import { familyNameOf, joinsViaShare, memberById, membersByIds } from "../people/family.js";
import { iso } from "./data.js";
import { dishesOf, library } from "./library.js";
import { actorOf, type Write } from "./actor.js";
import { deliverRecipe } from "./service.js";
import { attachFile, markForDeletion } from "./uploads.js";
import { bad, decodeCursor, encodeCursor, isRowId, libraryId, LIBRARY_ID, MAX_RECIPIENTS, MAX_VOICE_S, number, pageSize } from "./values.js";
import { mediaUrl, personView } from "./views.js";

type Body = Record<string, unknown>;

async function checkDish(id: string): Promise<void> {
  if ((await library().exists(id)) === false) throw new ApiError(404, "no_such_recipe");
}

// ---------------------------------------------------------------------------------------------
// Share links

const TOKEN = /^[0-9A-Za-z]{10}$/;
/** A leaked link stops working after this many joins; a new share hands out a fresh one. */
export const MAX_JOINS_PER_LINK = 5;
const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function newToken(): string {
  const out: string[] = [];
  while (out.length < 10) {
    for (const b of randomBytes(16)) if (b < 248 && out.length < 10) out.push(BASE62[b % 62]);
  }
  return out.join("");
}

const webUrl = () => (process.env.DISH_WEB_ORIGIN?.trim() || "https://homecookd.app").replace(/\/+$/, "");

/** One stable link per family, dish and sender, so re-opening the share sheet reuses it, until it's full. */
export async function makeShare(signed: Signed, body: Body) {
  const actor = await actorOf(signed);
  const dish = libraryId(body.libraryId, true)!;
  await checkDish(dish);
  const { rows } = await db().query(
    `select token from shares where family_id = $1 and library_id = $2 and sender_id = $3 order by created_at desc limit 1`,
    [actor.familyId, dish, actor.me.id],
  );
  let token: string | undefined = rows[0]?.token;
  if (token && (await joinsViaShare(db(), token, actor.familyId)) >= MAX_JOINS_PER_LINK) token = undefined;
  for (let i = 0; !token && i < 5; i += 1) {
    const candidate = newToken();
    const made = await db().query(
      `insert into shares (token, family_id, library_id, sender_id) values ($1, $2, $3, $4) on conflict (token) do nothing`,
      [candidate, actor.familyId, dish, actor.me.id],
    );
    if (made.rowCount) token = candidate;
  }
  if (!token) throw new Error("No free share token after 5 tries");
  return { token, url: `${webUrl()}/r?s=${token}` };
}

export const OPEN_LIMITS: Limit[] = [{ bucket: "share-open", max: 120, windowS: 600 }];

/**
 * A public link, with no session. The token comes in the body, not the path as on Supabase, because logs keep paths and a token is a capability. Rate limited by
 * IP, which Supabase's wasn't. Every failure reads the same.
 */
export async function openShare(token: unknown, ip: string) {
  await hit(subjectKey(ip), OPEN_LIMITS);
  if (typeof token !== "string" || !TOKEN.test(token)) throw notFound();
  const { rows } = await db().query(
    `update shares set open_count = open_count + 1, last_opened_at = now() where token = $1 returning token, library_id, sender_id, family_id`,
    [token],
  );
  const share = rows[0];
  if (!share) throw notFound();
  const sender = share.sender_id ? await memberById(db(), share.sender_id) : null;
  return {
    token: share.token,
    libraryId: share.library_id,
    recipeUrl: mediaUrl(`${share.library_id}/recipe.json`),
    sender: sender && !sender.deleted_at ? { name: sender.name, relation: sender.relation, avatarKey: sender.avatar_key } : null,
    familyName: await familyNameOf(db(), share.family_id),
  };
}

// ---------------------------------------------------------------------------------------------
// Recordings on their way: the app registers who gets them, the worker says when it's published

const UPLOAD_ID = LIBRARY_ID;

export async function registerPendingSend(signed: Signed, body: Body, w: Write) {
  const actor = await actorOf(signed);
  const uploadId = body.uploadId;
  if (typeof uploadId !== "string" || !UPLOAD_ID.test(uploadId)) throw bad("bad_upload_id");
  const list = body.recipientIds;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_RECIPIENTS) throw bad("bad_recipients");
  const here = new Set(actor.here.map((p) => p.id));
  for (const id of list) {
    if (!isRowId(id)) throw bad("bad_person_id");
    if (!here.has(id)) throw notFound();
  }
  const recipients = [...new Set(list as string[])].filter((id) => id !== actor.me.id);
  if (recipients.length === 0) throw bad("pick_someone_else");
  const helloKey = typeof body.helloKey === "string" && body.helloKey ? body.helloKey : null;
  const helloDuration = number(body.helloDurationS, { min: 0, max: MAX_VOICE_S });

  await once(
    { scope: actor.me.id, key: w.key, route: "POST /v1/pending-sends", hash: requestHash([uploadId, recipients, helloKey, helloDuration]) },
    async (c) => {
      // A first register makes the row, so two at once have one row to wait on and the second sees the first's hello. A later one holds its lock until it's done.
      const made = await c.query(
        `insert into pending_sends (upload_id, family_id, sender_id, recipient_ids, hello_key, hello_duration_s) values ($1, $2, $3, $4, $5, $6)
         on conflict (upload_id) do nothing returning upload_id`,
        [uploadId, actor.familyId, actor.me.id, recipients, helloKey, helloDuration],
      );
      if (made.rowCount) {
        if (helloKey) await attachFile(c, actor, helloKey, ["voice"]);
        return uploadId;
      }
      const before = await c.query(`select family_id, sender_id, delivered_at, hello_key from pending_sends where upload_id = $1 for update`, [uploadId]);
      const existing = before.rows[0];
      // Only its sender. Someone else in the family with the upload id can't redirect it, or send it as them.
      if (existing.family_id !== actor.familyId || existing.sender_id !== actor.me.id) throw new ApiError(409, "upload_is_someone_elses");
      if (existing.delivered_at) throw new ApiError(409, "already_delivered");
      if (helloKey !== existing.hello_key) {
        if (helloKey) await attachFile(c, actor, helloKey, ["voice"]);
        await markForDeletion(c, [existing.hello_key]); // nothing else holds it: a private voice note mustn't outlive its owner
      }
      await c.query(`update pending_sends set recipient_ids = $2, hello_key = $3, hello_duration_s = $4 where upload_id = $1`, [uploadId, recipients, helloKey, helloDuration]);
      return uploadId;
    },
  );
  // If the recording was already published (fast pipeline, slow phone), deliver right away. The old host's job file: the worker's own call covers the rest.
  const dish = await library().publishedDish(uploadId);
  if (dish) {
    const out = await deliverPending(actor.familyId, uploadId, dish, w.requestId, actor.me.id);
    return { ok: true, delivered: out.delivered };
  }
  return { ok: true };
}

/**
 * The recipe, and the hello when there is one, to each recipient still in the family. The claim and every message are one transaction, so a worker's retry
 * delivers nothing twice and a failure leaves nothing half-sent, where Supabase had to release its claim by hand.
 */
export async function deliverPending(familyId: string, uploadId: string, dish: string, requestId?: string, onlySender?: string): Promise<{ delivered: number; already?: boolean }> {
  const out = await tx(async (c) => {
    if (onlySender) {
      const owner = await c.query(`select sender_id from pending_sends where upload_id = $1 and family_id = $2`, [uploadId, familyId]);
      if (owner.rows[0] && owner.rows[0].sender_id !== onlySender) throw new ApiError(403, "not_your_recording");
    }
    const { rows } = await c.query(
      `update pending_sends set delivered_at = now(), library_id = $3 where upload_id = $1 and family_id = $2 and delivered_at is null
       returning sender_id, recipient_ids, hello_key, hello_duration_s`,
      [uploadId, familyId, dish],
    );
    const row = rows[0];
    if (!row) {
      const seen = await c.query(`select 1 from pending_sends where upload_id = $1 and family_id = $2`, [uploadId, familyId]);
      return seen.rowCount ? { delivered: 0, already: true } : { delivered: 0 };
    }
    const people = await membersByIds(c, row.recipient_ids);
    const recipients = people.filter((p) => p.family_id === familyId && !p.removed_at && !p.deleted_at && p.id !== row.sender_id).map((p) => p.id);
    await deliverRecipe(c, familyId, row.sender_id, recipients, dish, { helloKey: row.hello_key, helloDurationS: row.hello_duration_s }, requestId);
    return { delivered: recipients.length };
  });
  return out;
}

export async function publishedFromPhone(signed: Signed, uploadId: string, body: Body, requestId?: string) {
  if (!UPLOAD_ID.test(uploadId)) throw bad("bad_upload_id");
  const actor = await actorOf(signed);
  return await deliverPending(actor.familyId, uploadId, libraryId(body.libraryId, true)!, requestId, actor.me.id);
}

// ---------------------------------------------------------------------------------------------
// Hearts

const HEARTS_PAGE = { default: 200, max: 1000 };

export async function favorites(signed: Signed, query: Record<string, unknown>) {
  await actorOf(signed);
  const limit = pageSize(query.limit, HEARTS_PAGE);
  const cursor = decodeCursor(query.cursor);
  const { rows } = await db().query(
    `select library_id, ${iso("created_at")} as at from favorites
      where person_id = $1 ${cursor ? "and (favorites.created_at, library_id) < ($3::timestamptz, $4)" : ""}
      order by favorites.created_at desc, library_id desc limit $2`,
    cursor ? [signed.personId, limit, cursor.at, cursor.id] : [signed.personId, limit],
  );
  const end = rows.at(-1);
  return { libraryIds: rows.map((r) => r.library_id), nextCursor: rows.length === limit && end ? encodeCursor(end.at, end.library_id) : null };
}

/** Heart or un-heart a dish. The same either way however often it's called. */
export async function setFavorite(signed: Signed, body: Body) {
  await actorOf(signed);
  const dish = libraryId(body.libraryId, true)!;
  if (typeof body.on !== "boolean") throw bad("on_must_be_boolean");
  if (body.on) {
    await checkDish(dish);
    await db().query(`insert into favorites (person_id, library_id) values ($1, $2) on conflict do nothing`, [signed.personId, dish]);
  } else {
    await db().query(`delete from favorites where person_id = $1 and library_id = $2`, [signed.personId, dish]);
  }
  return { ok: true, libraryId: dish, on: body.on };
}

/** The handoff's limit per call. The app splits longer lists. */
export const DISH_STATS_MAX_IDS = 50;
const DAY_MS = 86_400_000;
export const HEARTS_RECENT_DEFAULT_DAYS = 14;
export const HEARTS_RECENT_MAX_DAYS = 30;
export const HEARTS_RECENT_LIMIT = 20;

/** `?ids=a,b,a` -> ['a', 'b']. Spaces and empty items are ignored. */
export function parseDishIds(raw: unknown): string[] {
  const ids = [...new Set(String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0) throw bad("ids_required");
  if (ids.some((id) => !LIBRARY_ID.test(id))) throw bad("bad_ids");
  if (ids.length > DISH_STATS_MAX_IDS) throw bad("too_many_ids");
  return ids;
}

/** `?since=<iso>`. Missing: 14 days ago. Clamped to 30 days back at most, and to now at most: a phone with a fast clock gets [] rather than an error. */
export function parseSince(raw: unknown, now: Date): Date {
  const floor = now.getTime() - HEARTS_RECENT_MAX_DAYS * DAY_MS;
  const s = String(raw ?? "").trim();
  if (!s) return new Date(now.getTime() - HEARTS_RECENT_DEFAULT_DAYS * DAY_MS);
  const t = s.length <= 40 ? Date.parse(s) : NaN;
  if (!Number.isFinite(t)) throw bad("bad_time");
  return new Date(Math.min(Math.max(t, floor), now.getTime()));
}

type DishStat = { hearts: { count: number; by: { personId: string; at: string }[] }; cooked: { count: number; by: { personId: string; count: number; lastAt: string }[] } };

/** Per dish of mine: hearts and cooks from my family now, me excluded. Counts go only to the dish's cook, so ids that aren't mine are left out. Never a ranking. */
export async function dishStats(signed: Signed, query: Record<string, unknown>) {
  const actor = await actorOf(signed);
  const wanted = parseDishIds(query.ids);
  const mine = new Set(dishesOf(await library().libraryIndex(), actor.me.name));
  const ids = wanted.filter((id) => mine.has(id));
  const out: Record<string, DishStat> = {};
  for (const id of ids) out[id] = { hearts: { count: 0, by: [] }, cooked: { count: 0, by: [] } };
  const others = actor.here.filter((p) => p.id !== actor.me.id).map((p) => p.id);
  if (ids.length === 0 || others.length === 0) return out;
  const [hearts, cooks] = await Promise.all([
    db().query(
      `select library_id, person_id, ${iso("created_at")} as at from favorites
        where library_id = any($1::text[]) and person_id = any($2::text[])
        order by favorites.created_at desc, person_id limit 2000`,
      [ids, others],
    ),
    db().query(
      `select library_id, person_id, count(*)::int as count, ${iso("max(created_at)")} as last_at from recipe_events
        where family_id = $1 and kind = 'cooked' and library_id = any($2::text[]) and person_id = any($3::text[])
        group by library_id, person_id
        order by max(created_at) desc, person_id limit 2000`,
      [actor.familyId, ids, others],
    ),
  ]);
  for (const h of hearts.rows) out[h.library_id].hearts.by.push({ personId: h.person_id, at: h.at });
  for (const c of cooks.rows) {
    out[c.library_id].cooked.by.push({ personId: c.person_id, count: c.count, lastAt: c.last_at });
    out[c.library_id].cooked.count += c.count;
  }
  for (const s of Object.values(out)) s.hearts.count = s.hearts.by.length;
  return out;
}

/** New hearts on my dishes from my family, newest first, at most 20. An un-heart deletes the row, so it disappears here too. */
export async function heartsRecent(signed: Signed, query: Record<string, unknown>) {
  const actor = await actorOf(signed);
  const since = parseSince(query.since, new Date());
  const mine = dishesOf(await library().libraryIndex(), actor.me.name);
  const others = actor.here.filter((p) => p.id !== actor.me.id).map((p) => p.id);
  if (mine.length === 0 || others.length === 0) return [];
  const { rows } = await db().query(
    `select person_id, library_id, ${iso("created_at")} as at from favorites
      where library_id = any($1::text[]) and person_id = any($2::text[]) and favorites.created_at > $3
      order by favorites.created_at desc, person_id, library_id limit $4`,
    [mine, others, since, HEARTS_RECENT_LIMIT],
  );
  return rows.map((r) => ({ personId: r.person_id, libraryId: r.library_id, at: r.at }));
}

// ---------------------------------------------------------------------------------------------
// Which recipes someone opened, cooked or listened to

const EVENT_KINDS = ["viewed", "cooked", "started", "heard"];
/** A 'heard' event is a play of a cook's voice of at least this many seconds. */
export const HEARD_MIN_S = 3;

/**
 * Re-opening within 30 min, a double-tapped "I made it" or a second cook-mode open within a minute counts once; a clip counts again unless it's the same clip
 * within 5 s (a double flush). Two at once are decided one at a time, where Supabase's check could let both in.
 */
export async function recordEvent(signed: Signed, body: Body) {
  const actor = await actorOf(signed);
  const dish = libraryId(body.libraryId, true)!;
  const kind = body.kind;
  if (typeof kind !== "string" || !EVENT_KINDS.includes(kind)) throw bad("bad_kind");
  let cookId: string | null = null;
  if (body.cookId !== undefined && body.cookId !== null) {
    if (!isRowId(body.cookId) || !actor.everyone.some((p) => p.id === body.cookId)) throw bad("cook_not_in_family");
    cookId = body.cookId;
  }
  const duration = number(body.durationS, { min: 0, max: 3600 });
  if (kind === "heard" && (duration === null || duration < HEARD_MIN_S)) throw bad("heard_too_short");
  const start = number(body.startS, { min: 0, max: 86_400 });
  await checkDish(dish);
  const windowS = kind === "viewed" ? 30 * 60 : kind === "heard" ? 5 : 60;
  return await tx(async (c) => {
    await c.query(`select pg_advisory_xact_lock(hashtext($1))`, [`event:${actor.me.id}:${dish}:${kind}`]);
    const same = kind === "heard" ? (start === null ? "and clip_start_s is null" : "and clip_start_s = $5") : "";
    const seen = await c.query(
      `select 1 from recipe_events
        where person_id = $1 and library_id = $2 and kind = $3 and created_at > now() - make_interval(secs => $4) ${same} limit 1`,
      kind === "heard" && start !== null ? [actor.me.id, dish, kind, windowS, start] : [actor.me.id, dish, kind, windowS],
    );
    if (seen.rowCount) return { ok: true, counted: false };
    await c.query(
      `insert into recipe_events (family_id, person_id, library_id, kind, cook_id, duration_s, clip_start_s) values ($1, $2, $3, $4, $5, $6, $7)`,
      [actor.familyId, actor.me.id, dish, kind, cookId, duration, kind === "heard" ? start : null],
    );
    return { ok: true, counted: true };
  });
}

/**
 * One row per dish I have any history with: my views and cooks, my heart, and the newest time someone else sent it to me. Most recent activity first. Counted in
 * SQL, so it can't undercount as Supabase's could past 1000 rows.
 */
export async function myRecipeStats(signed: Signed, query: Record<string, unknown>) {
  const actor = await actorOf(signed);
  const limit = pageSize(query.limit, { default: 200, max: 500 });
  const cursor = decodeCursor(query.cursor);
  const { rows } = await db().query(
    `with events as (
       select library_id,
              count(*) filter (where kind = 'viewed')::int as views,
              max(created_at) filter (where kind = 'viewed') as last_viewed_at,
              count(*) filter (where kind = 'cooked')::int as cooked,
              max(created_at) filter (where kind = 'cooked') as last_cooked_at
         from recipe_events where person_id = $1 and kind in ('viewed', 'cooked') group by library_id
     ), hearts as (
       select library_id, created_at as favorited_at from favorites where person_id = $1
     ), mine as (
       select id from threads where family_id = $2 and (kind = 'circle' or (kind = 'pair' and (a_person_id = $1 or b_person_id = $1)))
     ), sent as (
       select m.library_id, max(m.created_at) as sent_to_me_at
         from mine t join messages m on m.thread_id = t.id
        where m.kind = 'recipe' and m.sender_id <> $1 and m.library_id is not null group by m.library_id
     ), joined as (
       select coalesce(e.library_id, h.library_id, s.library_id) as library_id, coalesce(e.views, 0) as views, e.last_viewed_at, coalesce(e.cooked, 0) as cooked,
              e.last_cooked_at, h.favorited_at, s.sent_to_me_at,
              greatest(e.last_viewed_at, e.last_cooked_at, h.favorited_at, s.sent_to_me_at) as last_at
         from events e full join hearts h on h.library_id = e.library_id full join sent s on s.library_id = coalesce(e.library_id, h.library_id)
     )
     select library_id, views, cooked, ${iso("last_viewed_at")} as last_viewed_at, ${iso("last_cooked_at")} as last_cooked_at, ${iso("favorited_at")} as favorited_at,
            ${iso("sent_to_me_at")} as sent_to_me_at, ${iso("last_at")} as last_at_text
       from joined
      ${cursor ? "where last_at < $4::timestamptz or (last_at = $4::timestamptz and library_id > $5)" : ""}
      order by last_at desc, library_id
      limit $3`,
    cursor ? [actor.me.id, actor.familyId, limit, cursor.at, cursor.id] : [actor.me.id, actor.familyId, limit],
  );
  const end = rows.at(-1);
  return {
    stats: rows.map((r) => ({
      libraryId: r.library_id,
      views: r.views,
      lastViewedAt: r.last_viewed_at,
      cooked: r.cooked,
      lastCookedAt: r.last_cooked_at,
      favorited: r.favorited_at !== null,
      favoritedAt: r.favorited_at,
      sentToMeAt: r.sent_to_me_at,
    })),
    nextCursor: rows.length === limit && end ? encodeCursor(end.last_at_text, end.library_id) : null,
  };
}

/** A message's thread is the circle or a pair of mine. $3 is me. */
const SEEN_BY_ME = `(t.kind = 'circle' or t.a_person_id = $3 or t.b_person_id = $3)`;

/** Who in the family cooked or looked at one dish, and when it was last sent. People who left aren't shown, and notes and times come only from threads I'm in. */
export async function dishActivity(signed: Signed, libraryIdParam: string) {
  const actor = await actorOf(signed);
  if (!LIBRARY_ID.test(libraryIdParam)) throw bad("bad_library_id");
  const here = actor.here.map((p) => p.id);
  const [cooked, viewed, sent, notes] = await Promise.all([
    db().query(
      `select person_id, ${iso("max(created_at)")} as at from recipe_events
        where family_id = $1 and library_id = $2 and kind = 'cooked' and person_id = any($3::text[]) group by person_id order by max(created_at) desc limit 200`,
      [actor.familyId, libraryIdParam, here],
    ),
    db().query(
      `select person_id, count(*)::int as count from recipe_events
        where family_id = $1 and library_id = $2 and kind = 'viewed' and person_id = any($3::text[]) group by person_id order by count(*) desc limit 200`,
      [actor.familyId, libraryIdParam, here],
    ),
    // Only what the caller can see. A pair's words, or that two others traded a dish, aren't a third person's, whatever Supabase did.
    db().query(
      `select ${iso("m.created_at")} as at from messages m join threads t on t.id = m.thread_id
        where m.family_id = $1 and m.library_id = $2 and m.kind = 'recipe' and ${SEEN_BY_ME}
        order by m.created_at desc limit 1`,
      [actor.familyId, libraryIdParam, actor.me.id],
    ),
    db().query(
      `select distinct on (m.sender_id) m.sender_id, m.body from messages m join threads t on t.id = m.thread_id
        where m.family_id = $1 and m.library_id = $2 and m.kind = 'cooked' and m.body is not null and ${SEEN_BY_ME}
        order by m.sender_id, m.created_at desc limit 200`,
      [actor.familyId, libraryIdParam, actor.me.id],
    ),
  ]);
  const byId = new Map(actor.here.map((p) => [p.id, p]));
  const noteOf = new Map(notes.rows.map((m) => [m.sender_id, m.body]));
  return {
    cooked: cooked.rows.map((r) => ({ person: personView(byId.get(r.person_id)!), at: r.at, note: noteOf.get(r.person_id) ?? null })),
    viewed: viewed.rows.map((r) => ({ person: personView(byId.get(r.person_id)!), count: r.count })),
    lastSentAt: sent.rows[0]?.at ?? null,
  };
}
