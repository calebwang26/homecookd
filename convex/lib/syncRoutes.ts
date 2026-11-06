// The temporary sync into Postgres reads through these (docs/build/SYNC-MIGRATION.md): POST /sync/page and /sync/deletions, behind their own secret
// (`x-sync-secret`, SYNC_READ_SECRET in Convex env), so the api's key opens nothing else. With no secret set they refuse everyone. Read-only.
import type { HttpRouter } from "convex/server";
import { internal } from "../_generated/api";
import { fail, isNum, isStr, json, syncReader } from "./http";

// A page must stay well under Convex's read and response limits: recipes hold their steps and stories.
const MAX: Record<string, number> = { families: 100, people: 100, recipes: 25 };
const MAX_DELETIONS = 500;

const wholeNumber = (x: unknown, max: number): x is number => isNum(x) && Number.isInteger(x) && x >= 1 && x <= max;

export function registerSyncRoutes(http: HttpRouter): void {
  http.route({
    path: "/sync/page",
    method: "POST",
    handler: syncReader(async (ctx, body) => {
      const table = body.table;
      if (table !== "families" && table !== "people" && table !== "recipes") return fail(400, "table must be families, people or recipes");
      if (!wholeNumber(body.limit, MAX[table])) return fail(400, `limit must be 1..${MAX[table]}`);
      const cursor = body.cursor ?? null;
      if (cursor !== null && !isStr(cursor, 4000)) return fail(400, "cursor must be a string or null");
      const paginationOpts = { numItems: body.limit, cursor };
      try {
        const page =
          table === "families"
            ? await ctx.runQuery(internal.syncRead.families, { paginationOpts })
            : table === "people"
              ? await ctx.runQuery(internal.syncRead.people, { paginationOpts })
              : await ctx.runQuery(internal.syncRead.recipes, { paginationOpts });
        return json({ rows: page.page, next: page.isDone ? null : page.continueCursor });
      } catch (error) {
        // Convex refuses a cursor it doesn't know, and the caller starts the table again.
        if (cursor !== null && /cursor/i.test(String((error as Error).message))) return fail(400, "bad_cursor");
        throw error;
      }
    }),
  });

  http.route({
    path: "/sync/deletions",
    method: "POST",
    handler: syncReader(async (ctx, body) => {
      if (!isNum(body.after) || body.after < 0) return fail(400, "after must be a time");
      if (!wholeNumber(body.limit, MAX_DELETIONS)) return fail(400, `limit must be 1..${MAX_DELETIONS}`);
      return json({ rows: await ctx.runQuery(internal.syncRead.deletions, { after: body.after, limit: body.limit }) });
    }),
  });
}
