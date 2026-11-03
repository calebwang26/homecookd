// A parent's craving link, from the kid's side (convex/lib/cravingLinks.ts): what /dish/craving/peek shows, and the checks a card from the link passes, once before any
// model runs and again in the card's transaction. A link is reusable and can be forwarded, so it has caps of its own. The parent's side is cravings.ts.
import { db, type Queryable } from "../../db.js";
import { ApiError, retryAfter } from "../../errors.js";
import { memberById, type Member } from "../people/family.js";
import * as cravingData from "./cravingData.js";
import type { LinkRow } from "./cravingData.js";
import type { Relation } from "./recipe/types.js";
import { isRelation } from "./recipe/validate.js";
import { notFound } from "./values.js";

/** TODO(caleb): cards one link may make in all; then createLink makes her a new one. */
export const CRAVING_TOTAL = 20;
/** TODO(caleb): cards one link may make in 24 hours. */
export const CRAVING_PER_DAY = 5;
/** Convex's sentence, kept so the site's `isLinkBusy` still reads it until it reads the code. */
export const LINK_BUSY = "This link has had a lot of requests. Ask for a new one.";

const DAY_MS = 24 * 60 * 60_000;

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Who the kid asks: what the family calls her when it's one of the six ("Mom"), else mom. */
export function relationFrom(called: string | null | undefined): Relation {
  const word = called?.trim().toLowerCase();
  return isRelation(word) ? word : "mom";
}

/**
 * A link that isn't stopped, whose maker is still in its family: anything else is the one not-found, counted as a bad token. `lock` holds the link's row to the end of the
 * transaction, so two cards at once can't both pass its caps.
 */
async function openLink(q: Queryable, token: string, lock = false): Promise<{ link: LinkRow; maker: Member }> {
  const link = await cravingData.linkByToken(q, token, lock);
  if (!link || link.revoked_at) throw notFound();
  const maker = await memberById(q, link.person_id);
  if (!maker || maker.deleted_at || maker.removed_at || maker.family_id !== link.family_id) throw notFound();
  return { link, maker };
}

/** 429 `link_full`: Convex's 429 and sentence, with a code the site can read. `retry-after` is when the day's cap frees a card; a used-up link never frees, so a day. */
const linkFull = (seconds: number) => new ApiError(429, "link_full", retryAfter(seconds), LINK_BUSY);

/** The link's caps: CRAVING_TOTAL cards in all, CRAVING_PER_DAY in the last 24 hours. */
async function checkCaps(q: Queryable, link: LinkRow, now: number): Promise<void> {
  if (link.uses >= CRAVING_TOTAL) throw linkFull(DAY_MS / 1000);
  const today = await cravingData.cardTimesOfLink(q, link.id, new Date(now - DAY_MS), CRAVING_PER_DAY);
  if (today.length >= CRAVING_PER_DAY) throw linkFull((today[today.length - 1].getTime() + DAY_MS - now) / 1000);
}

/** POST /dish/craving/peek: who's asking, for the kid's page. Its caps aren't checked here: a full link still shows who sent it, and the card is refused. */
export async function peekLink(token: string): Promise<{ parentName: string; relation: string | null; message: string }> {
  const { link, maker } = await openLink(db(), token);
  return { parentName: firstName(maker.name), relation: maker.relation?.trim() || null, message: link.message };
}

/** POST /dish/cards with a craving token, before any model runs: 404 or 429 now, so a refused card costs nothing; else who the kid asks by default. */
export async function linkForCard(token: string, now = Date.now()): Promise<{ relation: Relation }> {
  const { link, maker } = await openLink(db(), token);
  await checkCaps(db(), link, now);
  return { relation: relationFrom(maker.relation) };
}

/** In the card's transaction: the same checks under the link's row lock, then this card counts. */
export async function takeLink(c: Queryable, token: string, now = Date.now()): Promise<LinkRow> {
  const { link } = await openLink(c, token, true);
  await checkCaps(c, link, now);
  await cravingData.countUse(c, link.id);
  return link;
}
