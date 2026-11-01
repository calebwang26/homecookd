// Who owns an uploaded file (docs/build/UPLOAD-OWNERSHIP.md). files.uploadUrl can't record an owner: the bytes go
// straight to storage and only the phone learns the id. But nobody else can know a new file's id until it's attached,
// because that's when a URL for it can first appear. So the first person to use a fresh file owns it.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** How long a file can wait to be used. An older file with no claim may have been attached before claims existed. */
export const CLAIM_WINDOW_MS = 24 * 60 * 60_000;

const claimOf = (ctx: QueryCtx, id: Id<"_storage">) =>
  ctx.db.query("fileClaims").withIndex("by_storage", (q) => q.eq("storageId", id)).unique();

/** On a card or a recording already. The server stores most of these itself, so they never get a claim. */
async function inUse(ctx: QueryCtx, id: Id<"_storage">): Promise<boolean> {
  return !!(
    (await ctx.db.query("dishFiles").withIndex("by_storage", (q) => q.eq("storageId", id)).first()) ??
    (await ctx.db.query("dishAnswers").withIndex("by_audio", (q) => q.eq("audio", id)).first()) ??
    (await ctx.db.query("liveFrames").withIndex("by_storage", (q) => q.eq("storageId", id)).first())
  );
}

/** The file if this person may attach it, claiming it when it's fresh and unclaimed; else null, whatever the reason. */
export async function claimFile(ctx: MutationCtx, person: Doc<"people">, id: Id<"_storage">) {
  const file = await ctx.db.system.get("_storage", id);
  if (!file || (await inUse(ctx, id))) return null;
  const claim = await claimOf(ctx, id);
  if (claim) return claim.personId === person._id ? file : null;
  if (file._creationTime <= Date.now() - CLAIM_WINDOW_MS) return null;
  await ctx.db.insert("fileClaims", { storageId: id, personId: person._id });
  return file;
}

export async function ownsFile(ctx: QueryCtx, personId: Id<"people">, id: Id<"_storage">): Promise<boolean> {
  return (await claimOf(ctx, id))?.personId === personId;
}

/**
 * Deletes a file a row of `owner`'s points at, and its claim. Another person's file is left alone: a row may have been
 * pointed at it before claims existed.
 */
export async function dropFileOf(ctx: MutationCtx, owner: Id<"people"> | undefined, id: Id<"_storage"> | undefined) {
  if (!id) return;
  const claim = await claimOf(ctx, id);
  if (claim && claim.personId !== owner) return;
  if (await ctx.db.system.get("_storage", id)) await ctx.storage.delete(id);
  if (claim) await ctx.db.delete("fileClaims", claim._id);
}
