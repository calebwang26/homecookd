// Community dinners (convex/dinners.ts): someone hosts a dinner around one of their family's shared recipes (or another family's shared dish that family agreed to
// cook with them) and neighbors ask to join. The address stays private: only the host and the guests they accepted ever see it.
// "Invite friends": the host and accepted guests share one link per dinner; whoever opens it sees only the dish, the host's name and when, and counts once per phone
// or browser in "X going".
import { randomBytes } from "node:crypto";
import type { Signed } from "../../auth.js";
import { db, tx } from "../../db.js";
import { invalid, notFound, refused } from "../../errors.js";
import { requestHash } from "../../idempotency.js";
import { afterOf, decodeCursor, encodeCursor, type After } from "../../paging.js";
import { DINNER_INVITE_SALT, seal, unseal } from "../../sealed.js";
import { flagged } from "../dish/moderation.js";
import { sha256Hex } from "../dish/values.js";
import { familiesByIds, peopleByIds } from "../people/service.js";
import * as data from "./data.js";
import type { DinnerRow, PlaceKind } from "./data.js";
import { distanceLabel, milesBetween, placeOf, roundToGrid } from "./geo.js";
import { seenRecipes, type SeenRecipe, seesDinner, seesRecipe, type Shield, shieldFor } from "./safety.js";
import { coverUrl, familyLabel } from "./storyCard.js";
import { WORDS_POSTABLE } from "./words.js";

/** Invite links open the website's /d page (or the app, where it's installed): the same site join links use (accounts/invites.ts), staging's own on staging. */
const inviteOrigin = () => (process.env.EDIBLE_WEB_URL?.trim() || "https://homecookd.app").replace(/\/+$/, "");
/** A dinner's "going" count stops growing from link opens here. */
export const MAX_OPENS = 300;
/** At most this many new phones count per dinner in OPEN_BURST_MS; past it, the page still opens, uncounted. */
export const OPEN_BURST = 60;
export const OPEN_BURST_MS = 10 * 60_000;
const MINE_PAGE = 50;

const NOT_HAPPENING = "That dinner isn't happening anymore.";
const PICK_RECIPE = "Pick one of your family's recipes.";

/** What one person may see of these dinners. `recipes` holds their dishes. */
async function viewDinners(signed: Signed, shield: Shield, dinners: DinnerRow[], recipes: Map<string, SeenRecipe>) {
  const ids = dinners.map((d) => d.id);
  const hosted = dinners.filter((d) => d.host_id === signed.personId).map((d) => d.id);
  const accepted = await data.acceptedCounts(db(), ids);
  const mine = await data.myRequests(db(), ids, signed.personId);
  const opens = await data.inviteOpenCounts(db(), ids);
  const asks = (await data.requestsOn(db(), hosted)).filter((r) => !shield.blocked.has(r.guest_family_id));
  const people = await peopleByIds(db(), [signed.personId, ...dinners.map((d) => d.host_id), ...asks.map((r) => r.guest_id)]);
  const families = await familiesByIds(db(), dinners.map((d) => d.host_family_id));
  const me = people.get(signed.personId);
  return dinners.map((d) => {
    const isHost = d.host_id === signed.personId;
    const request = mine.get(d.id);
    const dish = d.recipe_id ? recipes.get(d.recipe_id) : undefined;
    const canOpen = !!dish && (!!dish.shared_at || dish.family_id === signed.familyId) && seesRecipe(shield, dish);
    const hostName = people.get(d.host_id)?.name ?? "";
    return {
      dinnerId: d.id,
      dish: d.dish,
      recipeId: canOpen ? d.recipe_id : null,
      coverUrl: canOpen ? coverUrl(dish) : null,
      hostName,
      familyName: familyLabel(families.get(d.host_family_id), hostName),
      ours: d.host_family_id === signed.familyId,
      placeKind: d.place_kind,
      placeName: d.place_name,
      startsAt: d.starts_at.getTime(),
      seats: d.seats,
      seatsLeft: Math.max(0, d.seats - (accepted.get(d.id) ?? 0)),
      inviteOpens: opens.get(d.id) ?? 0,
      status: d.status,
      distanceLabel: distanceLabel(milesBetween(placeOf(me), placeOf(d))),
      isHost,
      myRequest: request ? { requestId: request.id, status: request.status } : null,
      address: isHost || request?.status === "accepted" ? d.address : null,
      requests: isHost
        ? asks.filter((r) => r.dinner_id === d.id).map((r) => ({ requestId: r.id, guestName: people.get(r.guest_id)?.name ?? "", status: r.status }))
        : null,
    };
  });
}

/**
 * A dish my family may host: one of our own ready recipes, once its cook shared it (the dish name reaches every neighbor's feed, so only her share switch lets it
 * out), or another family's shared dish they agreed to cook with us ("Cook together").
 */
async function hostable(signed: Signed, recipeId: string): Promise<SeenRecipe> {
  const recipe = (await seenRecipes(db(), [recipeId])).get(recipeId);
  if (!recipe) throw notFound(PICK_RECIPE);
  if (recipe.family_id === signed.familyId) {
    if (recipe.status !== "ready") throw notFound(PICK_RECIPE);
    if (!recipe.shared_at) throw refused(409, "not_shared", "Share this recipe first.");
    return recipe;
  }
  const visible = seesRecipe(await shieldFor(db(), signed.familyId), recipe);
  if (visible && recipe.status === "ready" && recipe.shared_at && (await data.ourAsk(db(), signed.familyId, recipeId, "cook"))?.status === "accepted") return recipe;
  throw notFound(PICK_RECIPE);
}

function text(s: string, field: string, what: string): string {
  const t = s.trim();
  if (!t || t.length > 200) throw invalid(field, `Add the ${what}.`);
  return t;
}

export type NewDinner = { recipeId: string; startsAt: number; placeKind?: PlaceKind; placeName: string; address: string; seats: number };

/**
 * Before this route used `requestHash`, a key stored the hash of the body as sent, its keys in the order they came. A first call made before the deploy still matches its
 * retry after it this way, and no other body can (the two strings are equal only for the same fields). Those keys expire 7 days after the deploy
 * (idempotency_keys.expires_at), and this can go then.
 */
const hashAsSent = (input: NewDinner) => sha256Hex(JSON.stringify(input));

/** What a used retry key answers: the first dinner for the same body, and a refusal for another. */
function firstDinner(first: { request_hash: string | null; resource_id: string | null }, input: NewDinner, hash: string): { dinnerId: string } {
  const same = first.request_hash === hash || first.request_hash === hashAsSent(input);
  if (!same || !first.resource_id) throw refused(409, "idempotency_conflict", "That was already sent with different details.");
  return { dinnerId: first.resource_id };
}

/**
 * `idempotencyKey`, from a phone that may retry: the same key and body gets the first dinner back, whatever order the body's keys come in, and the same key with another
 * body is refused. Without one (old builds), a retry makes a second dinner, as on Convex.
 */
export async function createDinner(signed: Signed, input: NewDinner, idempotencyKey?: string | null): Promise<{ dinnerId: string }> {
  const hash = requestHash(input);
  // Before the checks: a retry gets its dinner back even if the dish has since been unshared or the time has passed.
  if (idempotencyKey) {
    const first = await data.retryKeyOf(db(), signed.personId, idempotencyKey);
    if (first) return firstDinner(first, input, hash);
  }
  const recipe = await hostable(signed, input.recipeId);
  if (input.startsAt <= Date.now()) throw invalid("startsAt", "Pick a time that hasn't passed.");
  if (!Number.isInteger(input.seats) || input.seats < 1 || input.seats > 20) throw invalid("seats", "Seats go from 1 to 20.");
  if (flagged(recipe.title, input.placeName, input.address)) throw refused(422, "words", WORDS_POSTABLE);
  const placeName = text(input.placeName, "placeName", "place's name");
  const address = text(input.address, "address", "address");
  const place = roundToGrid(placeOf((await peopleByIds(db(), [signed.personId])).get(signed.personId)));
  return await tx(async (c) => {
    // A second call at the same moment passed the look above, and waits here on the row's primary key, so the first has finished by the time this returns false.
    if (idempotencyKey && !(await data.claimRetryKey(c, signed.personId, idempotencyKey, hash))) {
      return firstDinner((await data.retryKeyOf(c, signed.personId, idempotencyKey))!, input, hash);
    }
    const dinnerId = await data.insertDinner(c, {
      hostId: signed.personId,
      familyId: signed.familyId,
      recipeId: recipe.id,
      dish: recipe.title,
      startsAt: new Date(input.startsAt),
      placeKind: input.placeKind ?? "campus_kitchen",
      placeName,
      address,
      lat: place.lat,
      lng: place.lng,
      seats: input.seats,
    });
    if (idempotencyKey) await data.finishRetryKey(c, signed.personId, idempotencyKey, dinnerId);
    return { dinnerId };
  });
}

export async function getDinner(signed: Signed, dinnerId: string) {
  const d = await data.dinnerById(db(), dinnerId);
  if (!d) throw notFound();
  const shield = await shieldFor(db(), signed.familyId);
  const recipes = await seenRecipes(db(), d.recipe_id ? [d.recipe_id] : []);
  if (!seesDinner(shield, d, d.recipe_id ? recipes.get(d.recipe_id) : null)) throw notFound();
  return (await viewDinners(signed, shield, [d], recipes))[0];
}

const DONE = "done";

/** Dinners I host, then the ones I asked to join; soonest first within each page. The two lists page on their own, inside one cursor. */
export async function myDinners(signed: Signed, cursor?: string) {
  const position = decodeCursor(cursor, 4);
  const place = (at: string, id: string): After | null | typeof DONE => (at === DONE ? DONE : at ? afterOf(at, id) : null);
  const hostedAt = position ? place(position[0], position[1]) : null;
  const askedAt = position ? place(position[2], position[3]) : null;

  const hosted = hostedAt === DONE ? [] : await data.dinnersHostedBy(db(), signed.personId, hostedAt, MINE_PAGE + 1);
  const asked = askedAt === DONE ? [] : await data.dinnersAskedBy(db(), signed.personId, askedAt, MINE_PAGE + 1);
  const hosting = hosted.slice(0, MINE_PAGE);
  const askedPage = asked.slice(0, MINE_PAGE);

  const shield = await shieldFor(db(), signed.familyId);
  const recipes = await seenRecipes(db(), [...hosting, ...askedPage].flatMap((d) => (d.recipe_id ? [d.recipe_id] : [])));
  const joined = askedPage.filter((d) => seesDinner(shield, d, d.recipe_id ? recipes.get(d.recipe_id) : null)).sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime());

  const lastHosted = hosting.at(-1);
  const lastAsked = askedPage.at(-1);
  const moreHosted = hosted.length > MINE_PAGE && lastHosted;
  const moreAsked = asked.length > MINE_PAGE && lastAsked;
  const nextCursor =
    moreHosted || moreAsked
      ? encodeCursor([moreHosted ? lastHosted.cursor_at : DONE, moreHosted ? lastHosted.id : DONE, moreAsked ? lastAsked.ask_at : DONE, moreAsked ? lastAsked.ask_id : DONE])
      : null;
  return { dinners: await viewDinners(signed, shield, [...hosting, ...joined], recipes), nextCursor };
}

export async function requestJoin(signed: Signed, dinnerId: string): Promise<{ requestId: string }> {
  const d = await data.dinnerById(db(), dinnerId);
  const dish = d?.recipe_id ? (await seenRecipes(db(), [d.recipe_id])).get(d.recipe_id) : null;
  const visible = !!d && seesDinner(await shieldFor(db(), signed.familyId), d, dish);
  if (!d || !visible || d.status === "cancelled" || d.starts_at.getTime() <= Date.now()) throw notFound(NOT_HAPPENING);
  if (d.host_family_id === signed.familyId) throw refused(409, "own_family", "This is your family's dinner.");
  const already = () => refused(409, "already_asked", "You already asked to join.");
  if (await data.requestOfGuest(db(), dinnerId, signed.personId)) throw already();
  if (d.status === "full" || ((await data.acceptedCounts(db(), [dinnerId])).get(dinnerId) ?? 0) >= d.seats) throw refused(409, "full", "That dinner is full.");
  const requestId = await data.insertRequest(db(), dinnerId, signed.personId, signed.familyId);
  if (!requestId) throw already();
  return { requestId };
}

/**
 * The host says yes or no. The dinner is full once every seat has an accepted guest. Under the dinner's row lock, so two yeses can't both take the last seat, and no yes
 * lands on a dinner that's been called off or has started: a yes hands over the address. A no on one still answers the ask, as a no on a full dinner does: it gives
 * nothing away, and the host still sees the ask on that dinner.
 */
export async function respondToJoin(signed: Signed, requestId: string, accept: boolean): Promise<void> {
  await tx(async (c) => {
    const refuse = () => notFound("Only the host can answer.");
    const first = await data.requestById(c, requestId);
    const d = first && (await data.dinnerById(c, first.dinner_id, true));
    if (!first || !d || d.host_id !== signed.personId) throw refuse();
    if ((await shieldFor(c, signed.familyId)).blocked.has(first.guest_family_id)) throw refuse();
    const r = await data.requestById(c, requestId);
    if (!r) throw refuse();
    if (r.status !== "pending") throw refused(409, "answered", "You already answered.");
    if (!accept) return await data.setRequestStatus(c, requestId, "declined");
    if (d.status === "cancelled" || d.starts_at.getTime() <= Date.now()) throw notFound(NOT_HAPPENING);
    const taken = (await data.acceptedCounts(c, [d.id])).get(d.id) ?? 0;
    if (taken >= d.seats) throw refused(409, "full", "Every seat is taken.");
    await data.setRequestStatus(c, requestId, "accepted");
    if (taken + 1 >= d.seats) await data.setDinnerFull(c, d.id);
  });
}

// ---------------------------------------------------------------------------------------------
// "Invite friends"

/**
 * The dinner's one invite link, for the host or a guest they said yes to. The same link every time: the token is stored sealed, and only its sha256 is looked up. One
 * that can't be opened (another key, or a dinner from before tokens were sealed) is replaced, and its old link stops working.
 */
export async function inviteLink(signed: Signed, dinnerId: string): Promise<{ token: string; url: string }> {
  const d = await data.dinnerById(db(), dinnerId);
  const dish = d?.recipe_id ? (await seenRecipes(db(), [d.recipe_id])).get(d.recipe_id) : null;
  const visible = !!d && seesDinner(await shieldFor(db(), signed.familyId), d, dish);
  if (!d || !visible || d.status === "cancelled") throw notFound(NOT_HAPPENING);
  if (d.host_id !== signed.personId && (await data.requestOfGuest(db(), dinnerId, signed.personId))?.status !== "accepted") {
    throw refused(403, "not_a_guest", "Only the host and their guests can invite friends.");
  }
  const token =
    (await unseal(DINNER_INVITE_SALT, d.id, d.invite_token_enc)) ??
    (await tx(async (c) => {
      const kept = await unseal(DINNER_INVITE_SALT, d.id, await data.lockInviteToken(c, d.id));
      if (kept) return kept;
      const fresh = randomBytes(32).toString("base64url");
      await data.setInviteToken(c, d.id, sha256Hex(fresh), await seal(DINNER_INVITE_SALT, d.id, fresh));
      return fresh;
    }));
  return { token, url: `${inviteOrigin()}/d?t=${token}` };
}

/**
 * Someone opened an invite link. Counts this phone or browser once per dinner, while the dinner is still ahead, up to MAX_OPENS and OPEN_BURST per OPEN_BURST_MS. The
 * reply is all the opener ever sees: the dish, the host's name and when. Never the place, the address or any id.
 * `dinner` null: the link doesn't work. `known`: it was a real link, to a dinner that's off, so nobody is guessing (inviteRoutes.ts). The caller's answer is the same either way.
 * TODO(caleb): this is the host's whole display name; if families put surnames in it, decide whether a link anyone can forward should show less.
 */
export async function openInvite(token: string, deviceId: string): Promise<{ dinner: { dish: string; hostName: string; startsAt: number } | null; known: boolean }> {
  const d = await data.dinnerByInviteHash(db(), sha256Hex(token));
  if (!d) return { dinner: null, known: false };
  if (d.status === "cancelled" || d.hidden_at) return { dinner: null, known: true };
  if (d.recipe_id && (await seenRecipes(db(), [d.recipe_id])).get(d.recipe_id)?.hidden) return { dinner: null, known: true }; // its dish was hidden after reports
  const hostName = ((await peopleByIds(db(), [d.host_id])).get(d.host_id)?.name ?? "").trim();
  const dinner = { dish: d.dish, hostName, startsAt: d.starts_at.getTime() };
  if (d.starts_at.getTime() <= Date.now()) return { dinner, known: true };
  const full = (seen: { total: number; recent: number; seen: boolean }) => seen.total >= MAX_OPENS || seen.recent >= OPEN_BURST || seen.seen;
  // Most opens of a busy link change nothing: this phone's been counted, or the count has stopped. Those take no lock, so they don't queue pool connections behind the
  // host's answers. Only a new phone's count does, and it looks again under the lock, so the ceiling and the burst limit hold under many opens at once.
  if (full(await data.inviteOpenState(db(), d.id, deviceId, OPEN_BURST_MS))) return { dinner, known: true };
  await tx(async (c) => {
    await data.dinnerById(c, d.id, true);
    if (!full(await data.inviteOpenState(c, d.id, deviceId, OPEN_BURST_MS))) await data.insertInviteOpen(c, d.id, deviceId);
  });
  return { dinner, known: true };
}
