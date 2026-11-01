// Community (convex/community.ts): recipes families chose to share with people nearby, recipe swaps and "cook together" asks, and "Report or block". Everything
// returned is a whitelist: no video, moments, memories, library links, other families' person ids or addresses. Places are the ~1 km grid cell, never finer.
//
// Each wrong-family or blocked case is refused the same as a missing row: one route, one 404, the same bytes.
// Not here, because they write `recipes` or `people`, which are read-only until their area moves: setShare, setLocation, and the story card they start
// (COMMUNITY-MIGRATION.md, blockers).
import type { Signed } from "../../auth.js";
import { db, tx, type Queryable } from "../../db.js";
import { notFound, refused } from "../../errors.js";
import { afterCursor, afterOf, badCursor, decodeCursor, encodeCursor, pageOf } from "../../paging.js";
import { flagged } from "../dish/moderation.js";
import { familiesByIds, peopleByIds } from "../people/service.js";
import { sharedRecipes } from "../recipes/service.js";
import * as data from "./data.js";
import type { DinnerRow, ReportReason, SwapRow } from "./data.js";
import { distanceLabel, type LatLng, milesBetween, placeOf, roundToGrid } from "./geo.js";
import { fileReport, type Reportable, reportedBy, seenRecipes, type SeenRecipe, seesDinner, seesRecipe, type Shield, shieldFor } from "./safety.js";
import { coverUrl, familyLabel, publicCard, quoteTranslated, recipeWords } from "./storyCard.js";

/** Read this many candidates, then keep what this family may see nearby. Convex's sizes. */
const RECIPE_WINDOW = 200;
const RECIPE_PAGE = 50;
const DINNER_WINDOW = 100;
const DINNER_PAGE = 20;
const SWAP_PAGE = 50;
const BLOCK_PAGE = 100;

const GONE = { recipe: "That recipe isn't shared anymore.", dinner: "That dinner isn't happening anymore." } as const;
const gone = (kind: Reportable) => notFound(GONE[kind]);
const ownFamily = (what: string) => refused(409, "own_family", `This is your family's ${what}.`);

async function myPlace(signed: Signed): Promise<LatLng> {
  return roundToGrid(placeOf((await peopleByIds(db(), [signed.personId])).get(signed.personId)));
}

// ---------------------------------------------------------------------------------------------
// The feed

type FeedDinner = { dinnerId: string; dish: string; hostName: string; placeName: string; startsAt: number; seatsLeft: number; distanceLabel: string };

/** One window of open dinners ahead that this family may see nearby, soonest first. Never my own family's: those are under "You". */
async function dinnersAhead(signed: Signed, shield: Shield, here: LatLng, near: (miles: number) => boolean, after: { at: string; id: string } | null) {
  const window = await data.openDinnersAhead(db(), after, DINNER_WINDOW);
  const recipes = await seenRecipes(db(), window.flatMap((d) => (d.recipe_id ? [d.recipe_id] : [])));
  const hosts = await peopleByIds(db(), window.map((d) => d.host_id));
  const accepted = await data.acceptedCounts(db(), window.map((d) => d.id));
  const rows: { dinner: DinnerRow; miles: number; row: FeedDinner }[] = [];
  for (const d of window) {
    if (d.host_family_id === signed.familyId) continue;
    const miles = milesBetween(here, placeOf(d));
    if (!near(miles) || !seesDinner(shield, d, d.recipe_id ? recipes.get(d.recipe_id) : null)) continue;
    const hostName = hosts.get(d.host_id)?.name ?? "";
    if (flagged(d.dish, d.place_name, hostName)) continue; // the word filter's backstop
    rows.push({
      dinner: d,
      miles,
      row: {
        dinnerId: d.id,
        dish: d.dish,
        hostName,
        placeName: d.place_name,
        startsAt: d.starts_at.getTime(),
        seatsLeft: Math.max(0, d.seats - (accepted.get(d.id) ?? 0)),
        distanceLabel: distanceLabel(miles),
      },
    });
  }
  return { rows, last: window.length === DINNER_WINDOW ? window.at(-1) : undefined };
}

/** The first DINNER_PAGE of a window, and where the next page starts: after the last one shown, or past the window when it held few this family can see. */
function dinnerPage(found: Awaited<ReturnType<typeof dinnersAhead>>) {
  const shown = found.rows.slice(0, DINNER_PAGE);
  const more = found.rows.length > DINNER_PAGE ? shown.at(-1)?.dinner : found.last;
  return {
    dinners: [...shown].sort((a, b) => a.row.startsAt - b.row.startsAt || a.miles - b.miles).map((d) => d.row),
    nextCursor: more ? encodeCursor([more.cursor_at, more.id]) : null,
  };
}

/** What a recipe's feed row says of its soonest dinner: it sits where its host is, which may be far from the cook, so it has its own distance. */
const rideAlong = (d: FeedDinner | undefined) =>
  d ? { dinnerId: d.dinnerId, startsAt: d.startsAt, seatsLeft: d.seatsLeft, hostName: d.hostName, distanceLabel: d.distanceLabel } : null;

/**
 * Shared recipes nearest first (my own family's too, marked `ours`) and other families' open dinners nearby; `here` is my own grid cell, the map's middle.
 * A page of recipes comes from a window of the newest shared ones, ranked by distance. `cursor` continues in that ranking, then in the next window.
 */
export async function feed(signed: Signed, options: { maxMiles?: number; cursor?: string }) {
  const position = decodeCursor(options.cursor, 3);
  const before = position && position[0] ? afterOf(position[0], position[1]) : null;
  const skip = position ? Number(position[2]) : 0;
  if (!Number.isInteger(skip) || skip < 0) throw badCursor();

  const shield = await shieldFor(db(), signed.familyId);
  const here = await myPlace(signed);
  const near = (miles: number) => options.maxMiles === undefined || miles <= options.maxMiles;

  const ahead = await dinnersAhead(signed, shield, here, near, null);
  const page = dinnerPage(ahead);
  const dinnerFor = new Map<string, FeedDinner>();
  for (const { dinner, row } of ahead.rows) {
    if (dinner.recipe_id && row.seatsLeft > 0 && !dinnerFor.has(dinner.recipe_id)) dinnerFor.set(dinner.recipe_id, row);
  }

  const window = await sharedRecipes(db(), before, RECIPE_WINDOW);
  const seen = await seenRecipes(db(), window.map((r) => r.id));
  const cooks = await peopleByIds(db(), window.map((r) => r.cook_id));
  const families = await familiesByIds(db(), window.map((r) => r.family_id));
  const ranked = [];
  for (const shared of window) {
    const r = seen.get(shared.id);
    if (!r || r.status !== "ready" || !seesRecipe(shield, r)) continue;
    const cook = cooks.get(r.cook_id);
    const approx = roundToGrid(placeOf(cook));
    const miles = milesBetween(here, approx);
    if (!near(miles)) continue;
    const cookName = cook?.name ?? "";
    const family = families.get(r.family_id);
    const card = publicCard(r, cookName, family);
    const ours = r.family_id === signed.familyId;
    if (!ours && flagged(...recipeWords(r), card.text, card.quote, cookName, family?.public_name)) continue;
    ranked.push({
      miles,
      sharedAt: shared.shared_at?.getTime() ?? 0,
      row: {
        recipeId: r.id,
        dish: r.title,
        familyName: familyLabel(family, cookName),
        cookName,
        distanceLabel: distanceLabel(miles),
        approx,
        ours,
        story: card.text,
        culture: card.culture,
        quote: card.quote,
        quoteTranslated: quoteTranslated(r.steps, card.quote),
        coverUrl: coverUrl(r),
        stepCount: r.step_count,
        dinner: rideAlong(dinnerFor.get(r.id)),
      },
    });
  }
  ranked.sort((a, b) => a.miles - b.miles || b.sharedAt - a.sharedAt);

  const end = skip + RECIPE_PAGE;
  const last = window.at(-1);
  const nextCursor =
    end < ranked.length
      ? encodeCursor([before?.at ?? "", before?.id ?? "", end])
      : window.length === RECIPE_WINDOW && last
        ? encodeCursor([last.cursor_at, last.id, 0])
        : null;
  return { here, recipes: ranked.slice(skip, end).map((r) => r.row), dinners: page.dinners, nextCursor, dinnersCursor: page.nextCursor };
}

/** More of the feed's dinners: `dinnersCursor` from the feed, then `nextCursor` from here. */
export async function moreDinners(signed: Signed, options: { maxMiles?: number; cursor?: string }) {
  const shield = await shieldFor(db(), signed.familyId);
  const near = (miles: number) => options.maxMiles === undefined || miles <= options.maxMiles;
  return dinnerPage(await dinnersAhead(signed, shield, await myPlace(signed), near, afterCursor(options.cursor)));
}

/** A shared recipe's text: the story card and the steps. My own family's always open; one we reported or blocked, or one the filter caught, doesn't. */
export async function recipe(signed: Signed, recipeId: string) {
  const r = (await seenRecipes(db(), [recipeId])).get(recipeId);
  const ours = r?.family_id === signed.familyId;
  if (!r || r.status !== "ready" || (!r.shared_at && !ours)) throw notFound();
  if (!seesRecipe(await shieldFor(db(), signed.familyId), r)) throw notFound();
  const cookName = (await peopleByIds(db(), [r.cook_id])).get(r.cook_id)?.name ?? "";
  const family = (await familiesByIds(db(), [r.family_id])).get(r.family_id);
  const story = publicCard(r, cookName, family).text;
  if (!ours && flagged(...recipeWords(r), story, cookName, family?.public_name)) throw notFound();
  return {
    recipeId: r.id,
    dish: r.title,
    familyName: familyLabel(family, cookName),
    cookName,
    ours,
    story,
    steps: r.steps.map(({ order, title, text }) => ({ order, title, text })),
  };
}

// ---------------------------------------------------------------------------------------------
// Swaps ("Teach each other your family dishes") and "Cook together". Anyone in a family asks for another family's shared recipe, offering one of their own shared
// ones or none, or asks that family to cook their dish together; anyone in the family that was asked says yes or no. Every recipe in one is shared already, so it
// shows no new recipe text; the other family is named the way the cards name it.

async function askFamily(signed: Signed, recipeId: string, kind: "swap" | "cook", myRecipeId?: string) {
  const shield = await shieldFor(db(), signed.familyId);
  const seen = await seenRecipes(db(), myRecipeId ? [recipeId, myRecipeId] : [recipeId]);
  const theirs = seen.get(recipeId);
  if (!theirs || !seesRecipe(shield, theirs) || theirs.status !== "ready" || !theirs.shared_at) throw gone("recipe");
  if (theirs.family_id === signed.familyId) throw ownFamily("recipe");
  if (myRecipeId) {
    const mine = seen.get(myRecipeId);
    if (!mine || mine.family_id !== signed.familyId || mine.status !== "ready" || !mine.shared_at) throw refused(409, "not_shared", "Share that recipe first.");
  }
  const answer = (asked: SwapRow) => {
    if (asked.status === "declined") throw refused(409, "declined", "They said not this time.");
    return { swapId: asked.id };
  };
  const before = await data.ourAsk(db(), signed.familyId, recipeId, kind);
  if (before) return answer(before);
  const id = await data.insertSwap(db(), { requesterId: signed.personId, familyId: signed.familyId, recipeId, myRecipeId: myRecipeId ?? null, otherFamilyId: theirs.family_id, kind });
  if (id) return { swapId: id };
  return answer((await data.ourAsk(db(), signed.familyId, recipeId, kind))!); // someone in the family asked in that same moment
}

export const requestSwap = (signed: Signed, recipeId: string, myRecipeId?: string) => askFamily(signed, recipeId, "swap", myRecipeId);
export const cookTogether = (signed: Signed, recipeId: string) => askFamily(signed, recipeId, "cook");

/** Anyone in the family that was asked says yes or no, once. */
export async function respondSwap(signed: Signed, swapId: string, accept: boolean): Promise<void> {
  await tx(async (c) => {
    const s = await data.swapById(c, swapId, true);
    const refuse = () => notFound("Only the family that was asked can answer.");
    if (!s || s.other_family_id !== signed.familyId) throw refuse();
    if ((await shieldFor(c, signed.familyId)).blocked.has(s.requester_family_id)) throw refuse();
    if (s.status !== "pending") throw refused(409, "answered", "You already answered.");
    await data.setSwapStatus(c, swapId, accept ? "accepted" : "declined");
  });
}

/** My family's swaps and "cook together" asks, both ways, newest first. */
export async function mySwaps(signed: Signed, cursor?: string) {
  const shield = await shieldFor(db(), signed.familyId);
  const { rows, nextCursor } = pageOf(await data.swapsOfFamily(db(), signed.familyId, [...shield.blocked], afterCursor(cursor), SWAP_PAGE + 1), SWAP_PAGE);
  const seen = await seenRecipes(db(), rows.flatMap((s) => (s.my_recipe_id ? [s.their_recipe_id, s.my_recipe_id] : [s.their_recipe_id])));
  const families = await familiesByIds(db(), rows.flatMap((s) => [s.requester_family_id, s.other_family_id]));
  const people = await peopleByIds(db(), rows.flatMap((s) => {
    const cook = seen.get(s.their_recipe_id)?.cook_id;
    return cook ? [s.requester_id, cook] : [s.requester_id];
  }));
  const shown = (r: SeenRecipe | undefined) =>
    r && (r.family_id === signed.familyId || (r.shared_at && seesRecipe(shield, r))) ? { recipeId: r.id, dish: r.title } : null;
  const swaps = rows.map((s) => {
    const incoming = s.other_family_id === signed.familyId;
    const theirRecipe = seen.get(s.their_recipe_id);
    const myRecipe = s.my_recipe_id ? seen.get(s.my_recipe_id) : undefined;
    const [ours, theirs] = incoming ? [theirRecipe, myRecipe] : [myRecipe, theirRecipe];
    // Named like a card: the public name, else whoever asked us, or the cook of the dish we asked for.
    const otherFamily = families.get(incoming ? s.requester_family_id : s.other_family_id);
    const nameFrom = incoming ? s.requester_id : theirRecipe?.cook_id;
    const name = nameFrom ? (people.get(nameFrom)?.name ?? "") : "";
    return { swapId: s.id, kind: s.kind, status: s.status, incoming, ourDish: shown(ours), theirDish: shown(theirs), familyName: familyLabel(otherFamily, name) };
  });
  return { swaps, nextCursor };
}

// ---------------------------------------------------------------------------------------------
// "Report or block". From another family's recipe or dinner page. A report hides it from my family at once, and from everyone once two families reported it. A
// block works both ways and tells the team too (a "family" report). Anyone in a family can do either, for the whole family.

/**
 * Whose recipe or dinner it is, named the way its card names that family, and whether my family can see it now (shared or happening, and not hidden from us).
 * Never my own family's. Holds a dinner's row lock, because a report may hide it.
 */
async function ownerOf(c: Queryable, signed: Signed, kind: Reportable, targetId: string) {
  const shield = await shieldFor(c, signed.familyId);
  let owner: { id: string; familyId: string; personId: string; visible: boolean } | null = null;
  if (kind === "recipe") {
    const r = (await seenRecipes(c, [targetId])).get(targetId);
    if (r) owner = { id: r.id, familyId: r.family_id, personId: r.cook_id, visible: r.status === "ready" && !!r.shared_at && seesRecipe(shield, r) };
  } else {
    const d = await data.dinnerById(c, targetId, true);
    if (d) {
      const dish = d.recipe_id ? (await seenRecipes(c, [d.recipe_id])).get(d.recipe_id) : null;
      owner = { id: d.id, familyId: d.host_family_id, personId: d.host_id, visible: d.status !== "cancelled" && seesDinner(shield, d, dish) };
    }
  }
  if (!owner) throw gone(kind);
  if (owner.familyId === signed.familyId) throw ownFamily(kind);
  const name = (await peopleByIds(c, [owner.personId])).get(owner.personId)?.name ?? "";
  return { ...owner, shield, label: familyLabel((await familiesByIds(c, [owner.familyId])).get(owner.familyId), name) };
}

export async function report(signed: Signed, kind: Reportable, targetId: string, reason: ReportReason | null, requestId?: string): Promise<void> {
  await tx(async (c) => {
    const owner = await ownerOf(c, signed, kind, targetId);
    if (!owner.visible && !reportedBy(owner.shield, kind, owner.id)) throw gone(kind);
    await fileReport(c, signed, { kind, id: owner.id, familyId: owner.familyId }, reason, requestId);
  });
}

/** Block the family behind a recipe or dinner. Blocking again changes nothing. */
export async function block(signed: Signed, kind: Reportable, targetId: string, requestId?: string): Promise<void> {
  await tx(async (c) => {
    const owner = await ownerOf(c, signed, kind, targetId);
    if (await data.blockExists(c, signed.familyId, owner.familyId)) return;
    if (!owner.visible) throw gone(kind);
    await data.insertBlock(c, signed.familyId, owner.familyId, owner.label);
    await fileReport(c, signed, { kind: "family", id: owner.familyId, familyId: owner.familyId }, null, requestId);
  });
}

/** The families mine blocked, for the list under "You" (never the ones that blocked us). */
export async function blocked(signed: Signed, cursor?: string) {
  const position = decodeCursor(cursor, 1);
  const rows = await data.blocksOfFamily(db(), signed.familyId, position ? position[0] : null, BLOCK_PAGE + 1);
  const page = rows.slice(0, BLOCK_PAGE);
  return {
    blocked: page.map((b) => ({ blockId: b.id, familyName: b.label })),
    nextCursor: rows.length > BLOCK_PAGE ? encodeCursor([page.at(-1)!.blocked_family_id]) : null,
  };
}

export async function unblock(signed: Signed, blockId: string): Promise<void> {
  if (!(await data.deleteBlock(db(), blockId, signed.familyId))) throw notFound();
}
