// What deleting an account does to the dish ask (SCHEMA.md section 4, C3). It goes by person: a card's family alone deletes nothing, and an
// anonymous card has no person, so nothing reaches it until it's claimed. The account purge calls this (accounts/purgeSteps.ts); until the one-way
// sync fills `people`, `person_id` and `requested_of` stay null. Each card is one transaction; a file is marked before its row goes.
import { randomBytes } from "node:crypto";
import { db, tx, type Queryable } from "../../db.js";
import { markPurged, markPurgedIfKnown } from "../../purge.js";
import { dropQueuedCraving } from "../messages/pushData.js";
import { personIsLive } from "../people/service.js";
import type { CardRow } from "./data.js";
import * as data from "./data.js";

async function markKidFiles(c: Queryable, personId: string, card: CardRow): Promise<void> {
  await markPurged(c, personId, card.photo_keys, "private", "photo");
  await markPurged(c, personId, [card.dish_voice_note_key, card.kid_voice_note_key], "private", "voice");
}

/**
 * The kid deleted and Mom is still here: the card stays for her, without the kid's name, photos, voice notes, ip_key or message (C3), and
 * without the translations, which copy the message. The guess stays: Mom's version is built on it. The kid's link stops, so nobody who has it reads what Mom says next or
 * claims the kid's side. `kid_deleted_at` is what tells Mom's purge nobody is left to wait for.
 */
async function dropKid(c: Queryable, card: CardRow, personId: string): Promise<void> {
  await markKidFiles(c, personId, card);
  await data.deleteTranslations(c, card.id);
  await data.patchCard(c, card.id, {
    person_id: null,
    kid_name: null,
    kid_voice_note_key: null,
    kid_voice_s: null,
    dish_voice_note_key: null,
    photo_keys: [],
    kid_claimed_at: null,
    kid_deleted_at: new Date(),
    kid_token_hash: randomBytes(32).toString("hex"),
    ip_key: null,
    message: "",
  });
}

/** Mom deleted: her answers, clips and version go, and so does her filming day. The card waits for an answer again, for the kid. */
async function dropCook(c: Queryable, card: CardRow, personId: string): Promise<void> {
  const answers = await data.answersOf(c, card.id);
  await markPurged(c, personId, answers.map((a) => a.audio_key), "private", "voice");
  await data.deleteAnswers(c, card.id);
  await data.deleteTranslations(c, card.id);
  await data.patchCard(c, card.id, {
    requested_of: null,
    cook_claimed_at: null,
    version: null,
    status: "asked",
    opened_at: null,
    finished_at: null,
    merge_tries: 0,
    merge_started_at: null,
    merged_at: null,
    mom_page_lang: null,
    filming_day: null,
    voice_recipe_q: null,
  });
}

/** A card with everything it holds. `model_calls` keeps its cost history with the id nulled; translations cascade. */
async function deleteCard(c: Queryable, card: CardRow, personId: string): Promise<void> {
  const answers = await data.answersOf(c, card.id);
  await markPurged(c, personId, answers.map((a) => a.audio_key), "private", "voice");
  await markKidFiles(c, personId, card);
  await markPurgedIfKnown(c, personId, await data.fileKeysOfCard(c, card.id));
  await data.deleteAnswers(c, card.id);
  await data.deleteCardRow(c, card.id);
}

const BATCH = 100;

/** Safe to run again: each card leaves the person's lists as it's handled. Says how many rows it handled, so the account purge knows when nothing's left. */
export async function purgeDishForPerson(personId: string): Promise<number> {
  let handled = 0;
  for (;;) {
    const ids = await data.cardsOfKid(db(), personId, BATCH);
    handled += ids.length;
    for (const id of ids) {
      await tx(async (c) => {
        const card = await data.cardById(c, id, true);
        if (!card || card.person_id !== personId) return;
        if (card.requested_of) await dropQueuedCraving(c, card.requested_of, card.id); // it names them, and can be waiting for morning
        if (card.requested_of && (await personIsLive(c, card.requested_of))) await dropKid(c, card, personId);
        else await deleteCard(c, card, personId);
      });
    }
    if (ids.length < BATCH) break;
  }
  for (;;) {
    const ids = await data.cardsAskedOf(db(), personId, BATCH);
    handled += ids.length;
    for (const id of ids) {
      await tx(async (c) => {
        const card = await data.cardById(c, id, true);
        if (card?.requested_of !== personId) return;
        // The kid left first: nobody is left to wait for an answer, whichever of them went first.
        if (card.kid_deleted_at) await deleteCard(c, card, personId);
        else await dropCook(c, card, personId);
      });
    }
    if (ids.length < BATCH) break;
  }
  // Cards made from a link stay: they follow the rules above.
  for (;;) {
    const links = await data.deleteCravingLinksOf(db(), personId, BATCH);
    handled += links;
    if (links < BATCH) return handled;
  }
}
