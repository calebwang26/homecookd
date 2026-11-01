// messages.sharePhoto: Claude drafts a short note from the kid to the cook about the photo. Nothing is sent: the app shows the draft for the kid to edit, then sends it
// with aiDrafted true. The app's contract returns the draft, so this waits on the model in the request (DISH-MIGRATION.md has the same exception). No database
// connection is held meanwhile, the call has a timeout and a bounded retry, and it's a paid call, so it has a per-person limit, which Convex's didn't.
import type { Signed } from "../../auth.js";
import { db } from "../../db.js";
import { ApiError } from "../../errors.js";
import { hit, subjectKey } from "../../rateLimit.js";
import { familyRecipe } from "../recipes/read.js";
import { models, NotSetUp } from "./models.js";
import { actorOf } from "./actor.js";
import { usableFile } from "./uploads.js";
import { bad, isRowId, MAX_BODY } from "./values.js";
import { readLink } from "./views.js";

export async function sharePhoto(signed: Signed, body: Record<string, unknown>) {
  const actor = await actorOf(signed);
  const recipe = isRowId(body.recipeId) ? await familyRecipe(db(), actor.familyId, body.recipeId) : null;
  if (!recipe) throw new ApiError(404, "no_such_recipe");
  if (typeof body.photoKey !== "string" || !body.photoKey) throw bad("photo_required");
  await usableFile(db(), actor, body.photoKey, "photo");
  const photoUrl = await readLink(body.photoKey);
  if (!photoUrl) throw new ApiError(502, "storage");
  await hit(subjectKey(actor.me.id), [{ bucket: "messages-photo-note", max: 30, windowS: 3600 }]);
  const cook = actor.everyone.find((p) => p.id === recipe.cook_id)?.name || "the cook";
  const fact = `${actor.me.name} just cooked "${recipe.title}", the recipe ${cook} taught them, and is sending ${cook} this photo.`;
  let draft: string;
  try {
    draft = await models.photoNote(fact, photoUrl);
  } catch (error) {
    if (error instanceof NotSetUp) throw new ApiError(503, "note_writer_not_set_up");
    throw new ApiError(502, "note_failed");
  }
  if (!draft.trim()) throw new ApiError(502, "note_failed");
  return { draft: draft.trim().replace(/^"|"$/g, "").slice(0, MAX_BODY), aiDrafted: true as const };
}
