// messages.sharePhoto: Claude drafts a short note from the kid to the cook about the photo. Nothing is sent: the app shows the draft for the kid to edit, then sends it
// with aiDrafted true. The app's contract returns the draft, so this waits on the model in the request (DISH-MIGRATION.md has the same exception). No database
// connection is held meanwhile, the call has a timeout and a bounded retry, and it's a paid call, so it has a per-person limit, which Convex's didn't.
import type { Signed } from "../../auth.js";
import { db } from "../../db.js";
import { invalid, notSetUp, providerDown } from "../../errors.js";
import { hit, subjectKey } from "../../rateLimit.js";
import { recipeFor } from "../recipes/read.js";
import { models, NotSetUp } from "./models.js";
import { actorOf } from "./actor.js";
import { usableFile } from "./uploads.js";
import { isRowId, MAX_BODY, noSuchRecipe } from "./values.js";
import { readLink } from "./views.js";

const NO_NOTE = "Couldn't draft a note just now.";

/** A photo of the dish made from it, so a recipe that isn't ready is no recipe, to its cook too. */
export async function sharePhoto(signed: Signed, body: Record<string, unknown>) {
  const actor = await actorOf(signed);
  const recipe = isRowId(body.recipeId) ? await recipeFor(db(), actor.familyId, actor.me.id, body.recipeId, { readyOnly: true }) : null;
  if (!recipe) throw noSuchRecipe();
  if (typeof body.photoKey !== "string" || !body.photoKey) throw invalid("photoKey");
  await usableFile(db(), actor, body.photoKey, "photo");
  const photoUrl = await readLink(body.photoKey);
  if (!photoUrl) throw providerDown(502);
  await hit(subjectKey(actor.me.id), [{ bucket: "messages-photo-note", max: 30, windowS: 3600 }]);
  const cook = actor.everyone.find((p) => p.id === recipe.cook_id)?.name || "the cook";
  const fact = `${actor.me.name} just cooked "${recipe.title}", the recipe ${cook} taught them, and is sending ${cook} this photo.`;
  let draft: string;
  try {
    draft = await models.photoNote(fact, photoUrl);
  } catch (error) {
    if (error instanceof NotSetUp) throw notSetUp("The note writer isn't set up yet.");
    throw providerDown(502, NO_NOTE);
  }
  if (!draft.trim()) throw providerDown(502, NO_NOTE);
  return { draft: draft.trim().replace(/^"|"$/g, "").slice(0, MAX_BODY), aiDrafted: true as const };
}
