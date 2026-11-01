// What deleting an account does to the dish ask (SCHEMA.md section 4, C3). It goes by person: a card's family alone deletes nothing, and an
// anonymous card has no person, so nothing reaches it until it's claimed. Nothing calls this yet: the account purge moves last, and until the
// one-way sync fills `people`, `person_id` and `requested_of` stay null. Each card is one transaction; a file is marked before its row goes.
import { db, tx, type Queryable } from "../../db.js";
import { personIsLive } from "../people/service.js";
import type { CardRow } from "./data.js";
import * as data from "./data.js";

const kidKeys = (card: CardRow) =>
  [...card.photo_keys, card.dish_voice_note_key, card.kid_voice_note_key].filter((key): key is string => !!key);

/**
 * The kid deleted and Mom is still here: the card stays for her, without the kid's name, photos, voice notes, ip_key or message (C3), and
 * without the translations, which copy the message. The guess stays: Mom's version is built on it.
 */
async function dropKid(c: Queryable, card: CardRow): Promise<void> {
  await data.markFilesForDeletion(c, kidKeys(card));
  await data.deleteTranslations(c, card.id);
  await data.patchCard(c, card.id, {
    person_id: null,
    kid_name: null,
    kid_voice_note_key: null,
    kid_voice_s: null,
    dish_voice_note_key: null,
    photo_keys: [],
    kid_claimed_at: null,
    ip_key: null,
    message: "",
  });
}

/** Mom deleted: her answers, clips and version go, and so does her filming day. The card waits for an answer again, for the kid. */
async function dropCook(c: Queryable, card: CardRow): Promise<void> {
  const answers = await data.answersOf(c, card.id);
  await data.markFilesForDeletion(c, answers.map((a) => a.audio_key));
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
async function deleteCard(c: Queryable, card: CardRow): Promise<void> {
  const answers = await data.answersOf(c, card.id);
  await data.markFilesForDeletion(c, [...answers.map((a) => a.audio_key), ...kidKeys(card), ...(await data.fileKeysOfCard(c, card.id))]);
  await data.deleteAnswers(c, card.id);
  await data.deleteCardRow(c, card.id);
}

const BATCH = 100;

/** Safe to run again: each card leaves the person's lists as it's handled. */
export async function purgeDishForPerson(personId: string): Promise<void> {
  for (;;) {
    const ids = await data.cardsOfKid(db(), personId, BATCH);
    for (const id of ids) {
      await tx(async (c) => {
        const card = await data.cardById(c, id, true);
        if (!card || card.person_id !== personId) return;
        if (card.requested_of && (await personIsLive(c, card.requested_of))) await dropKid(c, card);
        else await deleteCard(c, card);
      });
    }
    if (ids.length < BATCH) break;
  }
  for (;;) {
    const ids = await data.cardsAskedOf(db(), personId, BATCH);
    for (const id of ids) {
      await tx(async (c) => {
        const card = await data.cardById(c, id, true);
        if (card?.requested_of === personId) await dropCook(c, card);
      });
    }
    if (ids.length < BATCH) break;
  }
  // Cards made from a link stay: they follow the rules above.
  while ((await data.deleteCravingLinksOf(db(), personId, BATCH)) === BATCH);
}
