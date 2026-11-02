// Claim on install, and after a move (convex/links.ts, convex/lib/linkRoutes.ts; docs/build/V2-LINKING.md section 2, JOIN-SIMPLE.md section 4). A dish card's links open the app. A card that
// belongs to a family is an invite to it, so someone new who opens one gets a signed join ticket for POST /auth/apple|google, at most once per side and only within JOIN_WINDOW_DAYS of its
// last activity. Signed in, a claim puts the card in their app. Nobody is moved between families by a claim.
import type { Signed } from "../../auth.js";
import { db, tx } from "../../db.js";
import { forbidden, invalid, notFound, removedFromFamily } from "../../errors.js";
import * as cards from "../dish/links.js";
import * as data from "./data.js";
import { extId } from "./data.js";
import { rehomeCookWork, requestMossSync } from "./neighbors.js";
import { cardRef, joinSecret, signTicket, verifyMoved } from "./tickets.js";
import { DAY_MS, DEAD_LINK, JOIN_TOKEN, JOIN_WINDOW_DAYS, limit, newJti, NOT_IN_THIS_FAMILY, refuse, sha256Hex, TICKET_MS, UUID, type Body } from "./values.js";

const TOO_MANY_TRIES = "Too many tries. Please wait a few minutes and try again.";
const CANT_CHECK = "That move can't be checked. Your recipes stay where they were.";

const relationLabel = (relation: string) => relation.charAt(0).toUpperCase() + relation.slice(1);

/** The /dish routes' sentence for a 429, with its retry-after like any other. */
const limited = (kind: string, value: string, max: number, minutes: number) => limit(kind, value, max, minutes, TOO_MANY_TRIES);

/** POST /link/open: says what the card is and, when it's an open invite to its family, hands back a ticket. It changes nothing but the rate-limit counters, so opening a link twice is harmless. */
export async function openLink(b: Body, ip: string) {
  await limited("link-open", ip, 30, 10);
  const token = b.token;
  if (typeof token !== "string" || !token) throw invalid("token", "token is required");
  const found = JOIN_TOKEN.test(token) ? await cards.cardOfToken(db(), sha256Hex(token)) : null;
  if (!found) {
    await limited("dish-bad", ip, 20, 10); // the same budget as a bad token on the /dish routes, as on Convex
    throw notFound(DEAD_LINK);
  }
  const { card, side } = found;
  const family = card.family_id ? await data.familyById(db(), card.family_id) : null;
  const open = family && !family.blanked_at ? family : null;
  const claimed = cards.claimedOnce(card, side);
  let joinable: "yes" | "taken" | "window" | "no_family" | "off" = !open
    ? "no_family"
    : claimed
      ? "taken"
      : Date.now() - cards.lastActivityMs(card) > JOIN_WINDOW_DAYS * DAY_MS
        ? "window"
        : "yes";
  const secret = joinSecret();
  let ticket: string | null = null;
  // A ticket's family must be an id Supabase's check takes. A seeded demo family's isn't, so it reads as having no family to join.
  const fam = open ? extId(open) : "";
  if (joinable === "yes" && !secret) joinable = "off";
  else if (joinable === "yes" && !UUID.test(fam)) joinable = "no_family";
  else if (joinable === "yes" && secret) {
    const ref = cardRef(card.id);
    await limited("link-ticket", `${side}:${ref}`, 5, 60); // by card and side, not IP: one card can't mint tickets faster than this, from anywhere
    ticket = signTicket(secret, {
      v: 1,
      fam,
      card: ref,
      side,
      name: side === "kid" ? card.kid_name : relationLabel(card.relation),
      exp: Date.now() + TICKET_MS,
      jti: newJti(),
    });
  }
  return {
    side,
    dish: card.dish || (card.guess as { dish?: string }).dish || "",
    kidName: card.kid_name,
    relation: card.relation,
    familyName: open?.name ?? null,
    taken: !!(await cards.liveHolder(db(), cards.holderOf(card, side))),
    ticket,
    language: side === "cook" ? await cards.answerLanguage(db(), card.id) : null,
    joinable,
  };
}

/**
 * Signed in: the card goes in the caller's app. The kid's token makes them the card's kid, the ask token its Mom, unless someone still here already holds that side. The card joins the
 * caller's family when it has none; a card in another family stays there. Claiming again returns the same.
 */
export async function claimCard(signed: Signed, b: Body) {
  const token = b.token;
  if (typeof token !== "string" || !JOIN_TOKEN.test(token)) throw notFound(DEAD_LINK);
  return tx(async (c) => {
    // Held to the end, so a deletion can't pass between the session's check and the card naming them.
    if (!(await data.lockLivePerson(c, signed.personId))) throw removedFromFamily(NOT_IN_THIS_FAMILY);
    const found = await cards.cardOfToken(c, sha256Hex(token), true);
    if (!found) throw notFound(DEAD_LINK);
    const { card, side } = found;
    if (cards.otherSideOf(card, side) === signed.personId) throw refuse(409, "already_on_card", "You're already on this card.");
    const familyId = card.family_id ?? signed.familyId;
    const result = { dishAskId: card.id, side, sameFamily: familyId === signed.familyId };
    const holder = await cards.liveHolder(c, cards.holderOf(card, side));
    if (holder) return { ...result, taken: holder !== signed.personId };
    await cards.claimCardSide(c, card, side, signed.personId, familyId);
    // TODO(aws-push): the "joined" push to the other side (convex/links.ts) waits for the push area.
    if (side === "cook") await data.setRelationIfUnset(c, signed.personId, relationLabel(card.relation));
    return { ...result, taken: false };
  });
}

/**
 * After a move between families: the app hands over the signed receipt, signed in as the new person. When nobody else signs in to the old family (`solo`), her recipes, their jobs and
 * recordings, the questions on them and her dish cards come to the new family, as do those of the phone-less faces who moved with her. Otherwise everything stays. TODO(caleb): the solo rule
 * (approved Oct 29, marked there too). Running it again finds nothing left to move.
 */
export async function afterMove(signed: Signed, b: Body) {
  const secret = joinSecret();
  const receipt = typeof b.receipt === "string" ? b.receipt : "";
  const r = secret ? verifyMoved(secret, receipt, Date.now()) : null;
  const person = await data.personByExtId(db(), signed.personId);
  const family = await data.familyById(db(), signed.familyId);
  if (!r || !person || !family || r.toProfile !== extId(person) || r.toFamily !== extId(family)) throw forbidden(CANT_CHECK);
  const none = { recipes: 0, faces: 0 };
  if (!r.solo) return none;
  const from = await data.familyByExtId(db(), r.fromFamily);
  if (!from || from.id === family.id) return none;
  return tx(async (c) => {
    let recipes = 0;
    let faces = 0;
    const old = await data.personByExtId(c, r.fromProfile);
    if (old && old.family_id === from.id && !old.deleted_at) {
      recipes += await rehomeCookWork(c, old.id, person.id, from.id, family.id);
      await cards.rehomeCards(c, old.id, person.id, from.id, family.id);
    }
    // The move already took each face into this family. Theirs stay theirs, in the new family. Only faces with work to bring count, so running this again says none.
    for (const id of r.faces) {
      const face = await data.personByExtId(c, id);
      if (!face || face.family_id !== family.id || face.deleted_at) continue;
      const moved = await rehomeCookWork(c, face.id, face.id, from.id, family.id);
      recipes += moved;
      if (moved) faces += 1;
    }
    if (recipes) {
      await requestMossSync(c, from.id);
      await requestMossSync(c, family.id);
    }
    return { recipes, faces };
  });
}
