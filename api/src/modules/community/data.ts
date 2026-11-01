// All of Community's own SQL. Every query, and the index behind it (SCHEMA.md section 3, 020_community.sql). Every list has a limit:
//
//   Query                                  Index                                                  Limit
//   what my family reported                reports (reporter_family_id, kind, target_id) unique   500
//   blocks, both ways                      blocks unique, blocks_reverse                          500 each
//   recipes hidden by two families         reports_target                                         the page's ids
//   open dinners ahead                     dinners_open_upcoming                                  the caller's window
//   a dinner, by id or by invite link      dinners primary key, invite_token (unique)             one row
//   dinners I host                         dinners_host                                           the caller's page
//   my asks to join                        dinner_requests_guest                                  the caller's page
//   seats taken, asks on a dinner          dinner_requests (dinner_id, guest_id) unique           200 asks a dinner
//   invite opens                           dinner_invite_opens unique                             300 a dinner, by the ceiling
//   my family's swaps, both ways           swap_requests_asked_by_us, swap_requests_asked_of_us   the caller's page
//   one swap, "asking again"               swap_requests primary key, unique                      one row
//   my family's blocks, the list           blocks unique                                          the caller's page
//   open reports                           reports_open                                           500
//   reports on a thing                     reports_target                                         500
//   a recipe's share asks                  questions_share_recent                                 one a recipe
//   purge steps                            dinners_host, dinners_recipe, dinner_requests_guest, swap_requests_requester,
//                                          swap_requests_their_recipe, swap_requests_my_recipe, reports_reporter_person, blocks_reverse   500 a pass
import type { Queryable } from "../../db.js";
import type { After } from "../../paging.js";

const MAX_SHIELD = 500;

export const REPORT_REASONS = ["not_food", "rude", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportKind = "recipe" | "dinner" | "family";

// ---------------------------------------------------------------------------------------------
// Reports and blocks

export async function reportedByFamily(q: Queryable, familyId: string): Promise<{ kind: string; target_id: string }[]> {
  const { rows } = await q.query(`select kind, target_id from reports where reporter_family_id = $1 limit $2`, [familyId, MAX_SHIELD]);
  return rows;
}

export async function blockedFamilies(q: Queryable, familyId: string): Promise<string[]> {
  const mine = await q.query(`select blocked_family_id as id from blocks where family_id = $1 limit $2`, [familyId, MAX_SHIELD]);
  const theirs = await q.query(`select family_id as id from blocks where blocked_family_id = $1 limit $2`, [familyId, MAX_SHIELD]);
  return [...mine.rows, ...theirs.rows].map((row) => row.id);
}

/** Of these recipes, the ones `threshold` families have open reports on. The unique index means one row is one family. */
export async function recipesOverThreshold(q: Queryable, ids: string[], threshold: number): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { rows } = await q.query(
    `select target_id from reports
      where kind = 'recipe' and target_id = any($1::text[]) and status = 'open'
      group by target_id having count(*) >= $2`,
    [ids, threshold],
  );
  return new Set(rows.map((row) => row.target_id));
}

/** False when this family already reported it: a second report changes nothing. */
export async function insertReport(
  q: Queryable,
  r: { familyId: string; personId: string; kind: ReportKind; targetId: string; targetFamilyId: string; reason: ReportReason | null },
): Promise<boolean> {
  const { rowCount } = await q.query(
    `insert into reports (reporter_family_id, reporter_person_id, kind, target_id, target_family_id, reason, status)
     values ($1, $2, $3, $4, $5, $6, 'open')
     on conflict (reporter_family_id, kind, target_id) do nothing`,
    [r.familyId, r.personId, r.kind, r.targetId, r.targetFamilyId, r.reason],
  );
  return Boolean(rowCount);
}

export async function openReportFamilies(q: Queryable, kind: ReportKind, targetId: string): Promise<number> {
  const { rows } = await q.query(`select count(*)::int as n from reports where kind = $1 and target_id = $2 and status = 'open'`, [kind, targetId]);
  return rows[0].n;
}

export async function hideDinner(q: Queryable, id: string): Promise<void> {
  await q.query(`update dinners set hidden_at = coalesce(hidden_at, now()) where id = $1`, [id]);
}

export async function blockExists(q: Queryable, familyId: string, blocked: string): Promise<boolean> {
  const { rows } = await q.query(`select 1 from blocks where family_id = $1 and blocked_family_id = $2`, [familyId, blocked]);
  return rows.length > 0;
}

export async function insertBlock(q: Queryable, familyId: string, blocked: string, label: string): Promise<void> {
  await q.query(`insert into blocks (family_id, blocked_family_id, label) values ($1, $2, $3) on conflict (family_id, blocked_family_id) do nothing`, [familyId, blocked, label]);
}

/** Only my family's own: their side can't lift it. */
export async function deleteBlock(q: Queryable, id: string, familyId: string): Promise<boolean> {
  const { rowCount } = await q.query(`delete from blocks where id = $1 and family_id = $2`, [id, familyId]);
  return Boolean(rowCount);
}

/** One page, ordered by the unique index. */
export async function blocksOfFamily(q: Queryable, familyId: string, after: string | null, limit: number): Promise<{ id: string; blocked_family_id: string; label: string }[]> {
  const { rows } = await q.query(
    `select id, blocked_family_id, label from blocks
      where family_id = $1 ${after === null ? "" : "and blocked_family_id > $3"}
      order by blocked_family_id limit $2`,
    after === null ? [familyId, limit] : [familyId, limit, after],
  );
  return rows;
}

export type OpenReport = { kind: ReportKind; target_id: string; reporter_family_id: string; reason: ReportReason | null; created_at: Date };

export async function openReports(q: Queryable, limit = 500): Promise<OpenReport[]> {
  const { rows } = await q.query(`select kind, target_id, reporter_family_id, reason, created_at from reports where status = 'open' order by created_at limit $1`, [limit]);
  return rows;
}

/** Bounded: an alert only needs to say "a lot". */
export async function countOpenReports(q: Queryable, before?: Date): Promise<number> {
  const { rows } = await q.query(
    `select count(*)::int as n from (select 1 from reports where status = 'open' ${before ? "and created_at <= $1" : ""} limit 500) r`,
    before ? [before] : [],
  );
  return rows[0].n;
}

export async function resolveReports(q: Queryable, kind: ReportKind, targetId: string): Promise<number> {
  const { rowCount } = await q.query(`update reports set status = 'resolved' where kind = $1 and target_id = $2 and status = 'open'`, [kind, targetId]);
  return rowCount ?? 0;
}

// ---------------------------------------------------------------------------------------------
// Dinners

export const PLACE_KINDS = ["campus_kitchen", "community_center", "cafe", "home"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export type DinnerRow = {
  id: string;
  host_id: string;
  host_family_id: string;
  recipe_id: string | null;
  dish: string;
  starts_at: Date;
  place_kind: PlaceKind;
  place_name: string;
  address: string;
  approx_lat: string;
  approx_lng: string;
  seats: number;
  status: "open" | "full" | "cancelled";
  invite_token: string | null;
  hidden_at: Date | null;
  cursor_at: string; // starts_at, to the microsecond
};

const DINNER = `d.id, d.host_id, d.host_family_id, d.recipe_id, d.dish, d.starts_at, d.place_kind, d.place_name, d.address, d.approx_lat, d.approx_lng,
  d.seats, d.status, d.invite_token, d.hidden_at, d.starts_at::text as cursor_at`;

export async function dinnerById(q: Queryable, id: string, lock = false): Promise<DinnerRow | null> {
  const { rows } = await q.query(`select ${DINNER} from dinners d where d.id = $1${lock ? " for update" : ""}`, [id]);
  return rows[0] ?? null;
}

export async function dinnersByIds(q: Queryable, ids: string[]): Promise<Map<string, DinnerRow>> {
  if (ids.length === 0) return new Map();
  const { rows } = await q.query(`select ${DINNER} from dinners d where d.id = any($1::text[])`, [[...new Set(ids)]]);
  return new Map(rows.map((row) => [row.id, row]));
}

export async function dinnerByInviteToken(q: Queryable, token: string): Promise<DinnerRow | null> {
  const { rows } = await q.query(`select ${DINNER} from dinners d where d.invite_token = $1`, [token]);
  return rows[0] ?? null;
}

/**
 * Open dinners that haven't started, soonest first. The database's clock decides, so past ones can't use up the window (convex/community.ts took the oldest
 * 100 open dinners, past ones included).
 */
export async function openDinnersAhead(q: Queryable, after: After | null, limit: number): Promise<DinnerRow[]> {
  const { rows } = await q.query(
    `select ${DINNER} from dinners d
      where d.status = 'open' and d.starts_at > now() ${after ? "and (d.starts_at, d.id) > ($2::timestamptz, $3)" : ""}
      order by d.starts_at, d.id limit $1`,
    after ? [limit, after.at, after.id] : [limit],
  );
  return rows;
}

export async function dinnersHostedBy(q: Queryable, personId: string, after: After | null, limit: number): Promise<DinnerRow[]> {
  const { rows } = await q.query(
    `select ${DINNER} from dinners d
      where d.host_id = $1 ${after ? "and (d.starts_at, d.id) > ($3::timestamptz, $4)" : ""}
      order by d.starts_at, d.id limit $2`,
    after ? [personId, limit, after.at, after.id] : [personId, limit],
  );
  return rows;
}

/** My asks' dinners, newest ask first. `ask_at` and `ask_id` place the page. The page of asks is taken first, so only its dinners are read. */
export async function dinnersAskedBy(q: Queryable, personId: string, before: After | null, limit: number): Promise<(DinnerRow & { ask_id: string; ask_at: string })[]> {
  const { rows } = await q.query(
    `select ${DINNER}, r.id as ask_id, r.created_at::text as ask_at
       from (select id, dinner_id, created_at from dinner_requests
              where guest_id = $1 ${before ? "and (created_at, id) < ($3::timestamptz, $4)" : ""}
              order by created_at desc, id desc limit $2) r
       join dinners d on d.id = r.dinner_id
      order by r.created_at desc, r.id desc`,
    before ? [personId, limit, before.at, before.id] : [personId, limit],
  );
  return rows;
}

export async function insertDinner(
  q: Queryable,
  d: { hostId: string; familyId: string; recipeId: string; dish: string; startsAt: Date; placeKind: PlaceKind; placeName: string; address: string; lat: number; lng: number; seats: number },
): Promise<string> {
  const { rows } = await q.query(
    `insert into dinners (host_id, host_family_id, recipe_id, dish, starts_at, place_kind, place_name, address, approx_lat, approx_lng, seats, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'open') returning id`,
    [d.hostId, d.familyId, d.recipeId, d.dish, d.startsAt, d.placeKind, d.placeName, d.address, d.lat, d.lng, d.seats],
  );
  return rows[0].id;
}

/** A phone's retry of a new dinner. False when this person already used this key. Waits for a first call still in its transaction. */
export async function claimRetryKey(q: Queryable, personId: string, key: string, hash: string): Promise<boolean> {
  const { rowCount } = await q.query(
    `insert into idempotency_keys (scope, key, route, request_hash) values ($1, $2, 'dinners.create', $3) on conflict (scope, key) do nothing`,
    [personId, key, hash],
  );
  return Boolean(rowCount);
}

export async function retryKeyOf(q: Queryable, personId: string, key: string): Promise<{ request_hash: string | null; resource_id: string | null } | null> {
  const { rows } = await q.query(`select request_hash, resource_id from idempotency_keys where scope = $1 and key = $2`, [personId, key]);
  return rows[0] ?? null;
}

export async function finishRetryKey(q: Queryable, personId: string, key: string, dinnerId: string): Promise<void> {
  await q.query(`update idempotency_keys set resource_id = $3, status_code = 201 where scope = $1 and key = $2`, [personId, key, dinnerId]);
}

export async function setDinnerFull(q: Queryable, id: string): Promise<void> {
  await q.query(`update dinners set status = 'full' where id = $1 and status = 'open'`, [id]);
}

/** A dinner's one invite token: the first ever stored stays. */
export async function keepInviteToken(q: Queryable, id: string, fresh: string): Promise<string> {
  const { rows } = await q.query(`update dinners set invite_token = coalesce(invite_token, $2) where id = $1 returning invite_token`, [id, fresh]);
  return rows[0].invite_token;
}

export async function reviewDinner(q: Queryable, id: string, keep: boolean): Promise<void> {
  if (keep) await q.query(`update dinners set hidden_at = null where id = $1`, [id]);
  else await q.query(`update dinners set status = 'cancelled', hidden_at = coalesce(hidden_at, now()) where id = $1`, [id]);
}

export type RequestRow = { id: string; dinner_id: string; guest_id: string; guest_family_id: string; status: "pending" | "accepted" | "declined" };

const REQUEST = `id, dinner_id, guest_id, guest_family_id, status`;

export async function acceptedCounts(q: Queryable, dinnerIds: string[]): Promise<Map<string, number>> {
  if (dinnerIds.length === 0) return new Map();
  const { rows } = await q.query(
    `select dinner_id, count(*)::int as n from dinner_requests where dinner_id = any($1::text[]) and status = 'accepted' group by dinner_id`,
    [dinnerIds],
  );
  return new Map(rows.map((row) => [row.dinner_id, row.n]));
}

export async function requestOfGuest(q: Queryable, dinnerId: string, guestId: string): Promise<RequestRow | null> {
  const { rows } = await q.query(`select ${REQUEST} from dinner_requests where dinner_id = $1 and guest_id = $2`, [dinnerId, guestId]);
  return rows[0] ?? null;
}

export async function myRequests(q: Queryable, dinnerIds: string[], guestId: string): Promise<Map<string, RequestRow>> {
  if (dinnerIds.length === 0) return new Map();
  const { rows } = await q.query(`select ${REQUEST} from dinner_requests where dinner_id = any($1::text[]) and guest_id = $2`, [dinnerIds, guestId]);
  return new Map(rows.map((row) => [row.dinner_id, row]));
}

/** The asks on dinners someone hosts, oldest first, at most 200 a dinner as on Convex. */
export async function requestsOn(q: Queryable, dinnerIds: string[]): Promise<RequestRow[]> {
  if (dinnerIds.length === 0) return [];
  const { rows } = await q.query(
    `select r.id, r.dinner_id, r.guest_id, r.guest_family_id, r.status
       from unnest($1::text[]) as ids (dinner_id)
       cross join lateral (select * from dinner_requests x where x.dinner_id = ids.dinner_id order by x.created_at, x.id limit 200) r`,
    [dinnerIds],
  );
  return rows;
}

export async function requestById(q: Queryable, id: string): Promise<RequestRow | null> {
  const { rows } = await q.query(`select ${REQUEST} from dinner_requests where id = $1`, [id]);
  return rows[0] ?? null;
}

/** Null when this person already asked: the unique index decides, so two taps at once stay one ask. */
export async function insertRequest(q: Queryable, dinnerId: string, guestId: string, familyId: string): Promise<string | null> {
  const { rows } = await q.query(
    `insert into dinner_requests (dinner_id, guest_id, guest_family_id, status) values ($1, $2, $3, 'pending')
     on conflict (dinner_id, guest_id) do nothing returning id`,
    [dinnerId, guestId, familyId],
  );
  return rows[0]?.id ?? null;
}

export async function setRequestStatus(q: Queryable, id: string, status: "accepted" | "declined"): Promise<void> {
  await q.query(`update dinner_requests set status = $2 where id = $1`, [id, status]);
}

export async function inviteOpenCounts(q: Queryable, dinnerIds: string[]): Promise<Map<string, number>> {
  if (dinnerIds.length === 0) return new Map();
  const { rows } = await q.query(`select dinner_id, count(*)::int as n from dinner_invite_opens where dinner_id = any($1::text[]) group by dinner_id`, [dinnerIds]);
  return new Map(rows.map((row) => [row.dinner_id, row.n]));
}

/** How many phones have opened this link, how many lately, and whether this one has. Reads at most the ceiling's worth of rows. */
export async function inviteOpenState(q: Queryable, dinnerId: string, deviceId: string, burstMs: number) {
  const { rows } = await q.query(
    `select count(*)::int as total,
            (count(*) filter (where created_at > now() - make_interval(secs => $3)))::int as recent,
            coalesce(bool_or(device_id = $2), false) as seen
       from dinner_invite_opens where dinner_id = $1`,
    [dinnerId, deviceId, burstMs / 1000],
  );
  return rows[0] as { total: number; recent: number; seen: boolean };
}

export async function insertInviteOpen(q: Queryable, dinnerId: string, deviceId: string): Promise<void> {
  await q.query(`insert into dinner_invite_opens (dinner_id, device_id) values ($1, $2) on conflict (dinner_id, device_id) do nothing`, [dinnerId, deviceId]);
}

// ---------------------------------------------------------------------------------------------
// Swaps

export type SwapRow = {
  id: string;
  requester_id: string;
  requester_family_id: string;
  their_recipe_id: string;
  my_recipe_id: string | null;
  other_family_id: string;
  kind: "swap" | "cook";
  status: "pending" | "accepted" | "declined";
  cursor_at: string;
};

const SWAP = `id, requester_id, requester_family_id, their_recipe_id, my_recipe_id, other_family_id, kind, status, created_at::text as cursor_at`;

export async function swapById(q: Queryable, id: string, lock = false): Promise<SwapRow | null> {
  const { rows } = await q.query(`select ${SWAP} from swap_requests where id = $1${lock ? " for update" : ""}`, [id]);
  return rows[0] ?? null;
}

export async function ourAsk(q: Queryable, familyId: string, recipeId: string, kind: "swap" | "cook"): Promise<SwapRow | null> {
  const { rows } = await q.query(`select ${SWAP} from swap_requests where requester_family_id = $1 and their_recipe_id = $2 and kind = $3`, [familyId, recipeId, kind]);
  return rows[0] ?? null;
}

/** Null when the family already asked (the unique index): the caller reads that ask. */
export async function insertSwap(
  q: Queryable,
  s: { requesterId: string; familyId: string; recipeId: string; myRecipeId: string | null; otherFamilyId: string; kind: "swap" | "cook" },
): Promise<string | null> {
  const { rows } = await q.query(
    `insert into swap_requests (requester_id, requester_family_id, their_recipe_id, my_recipe_id, other_family_id, kind, status)
     values ($1, $2, $3, $4, $5, $6, 'pending')
     on conflict (requester_family_id, their_recipe_id, kind) do nothing returning id`,
    [s.requesterId, s.familyId, s.recipeId, s.myRecipeId, s.otherFamilyId, s.kind],
  );
  return rows[0]?.id ?? null;
}

export async function setSwapStatus(q: Queryable, id: string, status: "accepted" | "declined"): Promise<void> {
  await q.query(`update swap_requests set status = $2 where id = $1`, [id, status]);
}

/** My family's asks both ways, newest first, leaving out any with a blocked family: each half from its own index, merged. */
export async function swapsOfFamily(q: Queryable, familyId: string, blocked: string[], before: After | null, limit: number): Promise<SwapRow[]> {
  const page = before ? "and (created_at, id) < ($4::timestamptz, $5)" : "";
  const { rows } = await q.query(
    `(select ${SWAP}, created_at as at from swap_requests where requester_family_id = $1 and not (other_family_id = any($2::text[])) ${page} order by created_at desc, id desc limit $3)
     union all
     (select ${SWAP}, created_at as at from swap_requests where other_family_id = $1 and not (requester_family_id = any($2::text[])) ${page} order by created_at desc, id desc limit $3)
     order by at desc, id desc limit $3`,
    before ? [familyId, blocked, limit, before.at, before.id] : [familyId, blocked, limit],
  );
  return rows;
}

// ---------------------------------------------------------------------------------------------
// "Put it on the map": one kind of row in `questions`, which the Messages area owns next, read here only (COMMUNITY-MIGRATION.md).

export type ShareAsk = { recipe_id: string; share_said: "yes" | "no" | "unclear" | null; share_decided_at: Date | null };

export async function latestShareAsks(q: Queryable, recipeIds: string[]): Promise<Map<string, ShareAsk>> {
  if (recipeIds.length === 0) return new Map();
  const { rows } = await q.query(
    `select distinct on (recipe_id) recipe_id, share_said, share_decided_at from questions
      where kind = 'share' and recipe_id = any($1::text[])
      order by recipe_id, created_at desc`,
    [recipeIds],
  );
  return new Map(rows.map((row) => [row.recipe_id, row]));
}

// ---------------------------------------------------------------------------------------------
// Account deletion (account.ts). Each returns how many rows it touched, so a caller can loop.

export async function cancelDinnersOf(q: Queryable, personId: string, recipeIds: string[]): Promise<number> {
  const { rowCount } = await q.query(`update dinners set status = 'cancelled' where status <> 'cancelled' and (host_id = $1 or recipe_id = any($2::text[]))`, [personId, recipeIds]);
  return rowCount ?? 0;
}

/** A hosted dinner, its asks and opens (they cascade). */
export async function deleteHostedDinners(q: Queryable, personId: string, batch: number): Promise<number> {
  const { rowCount } = await q.query(`delete from dinners where id in (select id from dinners where host_id = $1 limit $2)`, [personId, batch]);
  return rowCount ?? 0;
}

export async function detachDinnersFromRecipes(q: Queryable, recipeIds: string[], batch: number): Promise<number> {
  if (recipeIds.length === 0) return 0;
  const { rowCount } = await q.query(
    `update dinners set status = 'cancelled', recipe_id = null where id in (select id from dinners where recipe_id = any($1::text[]) limit $2)`,
    [recipeIds, batch],
  );
  return rowCount ?? 0;
}

export async function deleteAsksOf(q: Queryable, personId: string, batch: number): Promise<number> {
  const { rowCount } = await q.query(`delete from dinner_requests where id in (select id from dinner_requests where guest_id = $1 limit $2)`, [personId, batch]);
  return rowCount ?? 0;
}

export async function deleteSwapsOf(q: Queryable, personId: string, recipeIds: string[], batch: number): Promise<number> {
  const { rowCount } = await q.query(
    `delete from swap_requests where id in (
       select id from swap_requests where requester_id = $1 or their_recipe_id = any($2::text[]) or my_recipe_id = any($2::text[]) limit $3)`,
    [personId, recipeIds, batch],
  );
  return rowCount ?? 0;
}

export async function forgetReporter(q: Queryable, personId: string, batch: number): Promise<number> {
  const { rowCount } = await q.query(`update reports set reporter_person_id = null where id in (select id from reports where reporter_person_id = $1 limit $2)`, [personId, batch]);
  return rowCount ?? 0;
}

export async function forgetRetryKeys(q: Queryable, personId: string): Promise<void> {
  await q.query(`delete from idempotency_keys where scope = $1`, [personId]);
}

export async function blankBlockLabels(q: Queryable, blockedFamilyId: string, batch: number): Promise<number> {
  const { rowCount } = await q.query(
    `update blocks set label = 'A family' where id in (select id from blocks where blocked_family_id = $1 and label <> 'A family' limit $2)`,
    [blockedFamilyId, batch],
  );
  return rowCount ?? 0;
}
