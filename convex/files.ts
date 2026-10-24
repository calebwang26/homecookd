// Small files (voice notes, dish photos) go straight to Convex storage: the app POSTs the bytes to this
// URL, gets back a storageId, and passes it to messages.send or questions.answer.
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireSession } from "./lib/auth";

export const uploadUrl = mutation({
  args: { sessionToken: v.string() },
  returns: v.string(),
  handler: async (ctx, { sessionToken }) => {
    await requireSession(ctx, sessionToken);
    return await ctx.storage.generateUploadUrl();
  },
});
