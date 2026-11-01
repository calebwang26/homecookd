// What the two pages get, and the state they're worked out from. A card's status is computed here: the stored one changes only on send,
// version and reopen. (convex/dishAsks.ts cardJson, askJson and the helpers above them.)
import { type Queryable } from "../../db.js";
import type { AnswerRow, CardRow } from "./data.js";
import * as data from "./data.js";
import type { MissQuestion } from "./recipe/types.js";
import { readLink } from "./uploads.js";
import {
  type Ask,
  askUrlOf,
  type Card,
  DAILY_BUDGET_USD,
  dayOf,
  MAX_MERGES,
  MERGE_STALE_MS,
  MOM_OVERAGE_USD,
  sha256Hex,
  shownRecipe,
} from "./values.js";

/** What the status and the merge are worked out from. */
export type State = { row: CardRow; answers: AnswerRow[]; now: number; spent: number };

export async function stateOf(q: Queryable, row: CardRow, now = Date.now()): Promise<State> {
  return { row, answers: await data.answersOf(q, row.id), now, spent: await data.spentOn(q, dayOf(now)) };
}

/** A try that started under 3 minutes ago may still be running (a try takes at most 2). */
const running = (s: State) => s.row.merge_started_at !== null && s.row.merge_started_at.getTime() > s.now - MERGE_STALE_MS;
/** Ink heard no words in any of her clips: trying again won't change that. */
const heardNothing = (answers: AnswerRow[]) => answers.length > 0 && answers.every((a) => a.words === "");
/** Her answers not in her version yet (all of them before the first version). */
export const fresh = (answers: AnswerRow[]) => answers.filter((a) => !a.merged);
/** Something to merge: a new answer, unless no clip has words and there's no version. */
const mergeable = (s: State) => fresh(s.answers).length > 0 && (!!s.row.version || !heardNothing(s.answers));
/** Past today's budget and Mom's overage: her answers wait for another day. */
export const momOver = (spent: number) => spent >= DAILY_BUDGET_USD + MOM_OVERAGE_USD;
/** No version is coming for her new answers for now: every try failed, or today's budget is spent. */
const stalled = (s: State) =>
  fresh(s.answers).length > 0 && !running(s) && (s.row.merge_tries >= MAX_MERGES || (!!s.row.finished_at && momOver(s.spent)));
/** From Send until her version lands or no version will come (Mom's page polls while it's true). */
const merging = (s: State) => !!s.row.finished_at && mergeable(s) && !stalled(s);
/** A merge try can start now. */
export const due = (s: State) => !!s.row.finished_at && s.row.merge_tries < MAX_MERGES && !running(s) && mergeable(s) && !momOver(s.spent);

const ms = (d: Date | null) => (d ? d.getTime() : null);
const link = (key: string | null) => (key ? readLink(key) : Promise.resolve(null));

export async function cardJson(s: State, askToken: string): Promise<Card> {
  const { row, answers } = s;
  let status = row.status;
  let list: AnswerRow[] = [];
  if (!row.version) {
    if (row.finished_at && answers.length && (heardNothing(answers) || stalled(s))) [status, list] = ["answered", answers];
  } else {
    const done = !!row.finished_at && (!fresh(answers).length || stalled(s));
    status = done ? "answered" : "asked";
    list = answers.filter((a) => (a.merged && a.words) || (done && !a.merged));
  }
  return {
    dish: row.dish || row.guess.dish,
    relation: row.relation,
    kidName: row.kid_name,
    status,
    guess: shownRecipe(row.guess),
    version: row.version ? shownRecipe(row.version) : null,
    answers: await Promise.all(
      list.map(async (a) => ({
        id: a.question_id,
        words: row.version ? (a.words ?? "") : "",
        english: row.version && a.words ? a.english : null,
        audioUrl: await readLink(a.audio_key),
        durationS: a.duration_s,
      })),
    ),
    merging: merging(s),
    asked: row.asked,
    message: row.message,
    kidVoiceUrl: await link(row.kid_voice_note_key),
    kidVoiceS: row.kid_voice_note_key ? row.kid_voice_s : null,
    photoUrls: await Promise.all(row.photo_keys.map((key) => readLink(key))),
    askUrl: row.relation === "none" ? null : askUrlOf(askToken),
    askedAt: ms(row.asked_at),
    openedAt: ms(row.opened_at),
    finishedAt: ms(row.finished_at),
    createdAt: row.created_at.getTime(),
    filmingDay: row.filming_day,
  };
}

/** Sorted keys: Postgres stores jsonb in its own order, and this hash must match what was computed before it was saved. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** What Mom's page in another language was translated from: while it matches, the translation stands. */
export const translationHash = (row: Pick<CardRow, "asked" | "message" | "version" | "guess">) =>
  sha256Hex(stable([row.asked.map((q) => [q.id, q.text]), row.message, row.version ?? null, row.guess]));

/** The card in Mom's page language, from the cache (never translated here); null for English or none yet. */
async function inLangOf(q: Queryable, row: CardRow, lang: string | undefined, open: MissQuestion[]): Promise<Ask["inLang"]> {
  if (!lang || lang === "en") return null;
  const hit = await data.translationOf(q, row.id, lang);
  if (!hit || hit.source_hash !== translationHash(row)) return null;
  const text = new Map(hit.questions.map((x) => [x.id, x.text]));
  return {
    lang,
    guess: shownRecipe(hit.guess),
    questions: open.map((x) => ({ id: x.id, text: text.get(x.id) ?? x.text })),
    message: hit.message,
    version: hit.version ? shownRecipe(hit.version) : null,
  };
}

/** Mom's page: the kid's guess and photos, the questions she hasn't answered, her own clips; never the kid token. */
export async function askJson(q: Queryable, s: State, lang?: string): Promise<Ask> {
  const { row, answers } = s;
  const answered = new Set(answers.map((a) => a.question_id));
  const open = row.asked.filter((x) => !answered.has(x.id));
  const isMerging = merging(s);
  return {
    dish: row.guess.dish,
    relation: row.relation,
    kidName: row.kid_name,
    message: row.message,
    kidVoiceUrl: await link(row.kid_voice_note_key),
    kidVoiceS: row.kid_voice_note_key ? row.kid_voice_s : null,
    guess: shownRecipe(row.guess),
    inLang: await inLangOf(q, row, lang, open),
    photoUrls: await Promise.all(row.photo_keys.map((key) => readLink(key))),
    questions: open,
    answered: [...answered].sort(),
    clips: await Promise.all(answers.map(async (a) => ({ id: a.question_id, audioUrl: await readLink(a.audio_key), durationS: a.duration_s }))),
    finished: !!row.finished_at || (row.asked.length > 0 && row.asked.every((x) => answers.some((a) => a.question_id === x.id && a.merged))),
    version: row.version && !isMerging ? shownRecipe(row.version) : null,
    merging: isMerging,
  };
}
