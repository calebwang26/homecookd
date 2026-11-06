// Asking a cook to put her recipe on the map (convex/shareRequests.ts ask, and the question it writes). Only the recipe's cook can share it, so when someone else in the
// family asks, homie asks her: it becomes one of her open questions (kind 'share'), in her language once questions.translate has run. She answers it like any other
// question (POST /v1/questions/:id/answer, her own recipe's only), questions.read_share reads her answer, and only a clear yes shares it (questions.ts, storyCards.ts).
// Community's route calls this, because Messages owns `questions`. No push: a cook-mode question sends none, as on Convex.
//
// SQL, with its index:
//   A recipe's newest share ask        questions_share_recent
//   One open ask per dish              questions_one_open_share (unique)
import { tx, type Queryable } from "../../db.js";
import { refused } from "../../errors.js";
import { enqueue } from "../../outbox.js";
import { memberById } from "../people/family.js";

/** After a no or an unclear answer, the family waits this long to ask her again. */
export const ASK_AGAIN_MS = 24 * 60 * 60_000;

/**
 * TODO(caleb): the words homie asks the cook with (translated for her when she doesn't speak English). Convex's shareQuestion, word for word.
 * The culture is the story card's guess at where the dish is from ("Maharashtrian"), shown on the map card.
 */
export function shareQuestion(askerName: string, dish: string): string {
  const who = askerName.trim() || "Someone in your family";
  return `${who} wants to put your ${dish} on the map for neighbors. They'd see the recipe, one line you said and homie's guess at where the dish is from, never your video. Is that okay?`;
}

export type ShareAsk = { recipe_id: string; share_said: "yes" | "no" | "unclear" | null; share_decided_at: Date | null };

/** Each recipe's newest share ask. */
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

/** Where the newest ask stands. `open`: waiting on her, or on homie reading what she said. `notNowAt`: when homie read a no or an unclear answer. */
export function askState(q: ShareAsk | undefined): { open: boolean; notNowAt: number | null } {
  if (!q) return { open: false, notNowAt: null };
  if (q.share_said === null) return { open: true, notNowAt: null };
  return { open: false, notNowAt: q.share_said === "yes" || !q.share_decided_at ? null : q.share_decided_at.getTime() };
}

/**
 * shareRequests.ask, for anyone in the family but the cook, on her ready recipe that isn't shared (the caller has checked both). "asked" when an ask is waiting already,
 * or this one now is. Within a day of her no, the family waits: 409 `declined`. One open ask per dish, by a unique index, so two kids asking at once make one question.
 */
export async function askCookToShare(asker: { personId: string; familyId: string }, recipe: { id: string; title: string; cook_id: string }, requestId?: string): Promise<"asked"> {
  return await tx(async (c): Promise<"asked"> => {
    const last = askState((await latestShareAsks(c, [recipe.id])).get(recipe.id));
    if (last.open) return "asked";
    const cook = await memberById(c, recipe.cook_id);
    if (last.notNowAt !== null && Date.now() - last.notNowAt < ASK_AGAIN_MS) {
      throw refused(409, "declined", `${cook?.name.trim() || "The cook"} said not now. Ask again tomorrow.`);
    }
    const me = await memberById(c, asker.personId);
    const { rows } = await c.query(
      `insert into questions (family_id, recipe_id, asked_by, text, status, kind) values ($1, $2, $3, $4, 'asked_cook', 'share')
       on conflict (recipe_id) where kind = 'share' and share_said is null do nothing returning id`,
      [asker.familyId, recipe.id, asker.personId, shareQuestion(me?.name ?? "", recipe.title)],
    );
    if (rows[0] && cook?.language && cook.language !== "en") {
      await enqueue(c, { queue: "scheduled", payload: { task: "questions.translate", questionId: rows[0].id, language: cook.language }, requestId });
    }
    return "asked";
  });
}
