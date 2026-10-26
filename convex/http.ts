// HTTP routes for our own services (docs/build/STACK.md, "Contracts"). The pipeline worker sends
// `x-worker-secret`, the live voice service `x-voice-secret`, the glasses VM `x-glasses-secret`; each is
// a shared secret in Convex env. Errors are JSON `{ error }` with 400 (bad body), 401 (wrong secret or
// signed-out session) or 404. homie's routes are in lib/liveRoutes.ts, the glasses' in lib/glassesRoutes.ts,
// and the one public route (a dinner's invite link opened: POST /invite/open) in lib/inviteRoutes.ts.
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { registerGlassesRoutes } from "./lib/glassesRoutes";
import { fail, isNum, isStr, json, voice, worker } from "./lib/http";
import { registerInviteRoutes } from "./lib/inviteRoutes";
import { registerLiveRoutes } from "./lib/liveRoutes";
import { parseRecipeJson } from "./lib/recipeJson";

const http = httpRouter();

async function jobId(ctx: ActionCtx, raw: unknown): Promise<Id<"jobs"> | null> {
  if (!isStr(raw, 100)) return null;
  return await ctx.runQuery(internal.ids.job, { id: raw });
}

// ---- Worker → Convex ----

http.route({
  path: "/worker/claim",
  method: "POST",
  handler: worker(async (ctx) => {
    const job = await ctx.runMutation(internal.worker.claim, {});
    return job ? json(job) : new Response(null, { status: 204 });
  }),
});

http.route({
  path: "/worker/release",
  method: "POST",
  handler: worker(async (ctx, body) => {
    const id = await jobId(ctx, body.jobId);
    if (!id) return fail(404, "no such job");
    const result = await ctx.runMutation(internal.worker.release, { jobId: id });
    if (result === "cancelled") return fail(409, "cancelled");
    return result === "ok" ? json({ ok: true }) : fail(404, "no such job, or it isn't preparing");
  }),
});

const STAGES = ["preparing", "understanding", "writing", "indexing", "done", "failed"] as const;
type Stage = (typeof STAGES)[number];

http.route({
  path: "/worker/progress",
  method: "POST",
  handler: worker(async (ctx, body) => {
    const id = await jobId(ctx, body.jobId);
    if (!id) return fail(404, "no such job");
    if (!STAGES.includes(body.stage as Stage)) return fail(400, `stage must be one of ${STAGES.join(", ")}`);
    if (!isNum(body.progress) || body.progress < 0 || body.progress > 1) return fail(400, "progress must be 0..1");
    if (body.error !== undefined && typeof body.error !== "string") return fail(400, "error must be a string");
    const result = await ctx.runMutation(internal.worker.progress, {
      jobId: id,
      stage: body.stage as Stage,
      progress: body.progress,
      error: body.error as string | undefined,
    });
    // 409: the cook stopped this job; the worker drops it and publishes nothing.
    if (result === "cancelled") return fail(409, "cancelled");
    return result === "ok" ? json({ ok: true }) : fail(404, "no such job");
  }),
});

http.route({
  path: "/worker/published",
  method: "POST",
  handler: worker(async (ctx, body) => {
    const id = await jobId(ctx, body.jobId);
    if (!id) return fail(404, "no such job");
    const parsed = parseRecipeJson(body.recipe);
    if (typeof parsed === "string") return fail(400, parsed);
    const recipeJsonUrl = isStr(body.recipeJsonUrl) && body.recipeJsonUrl.startsWith("https://") ? body.recipeJsonUrl : undefined;
    if (body.memoriesOptIn !== undefined && typeof body.memoriesOptIn !== "boolean") {
      return fail(400, "memoriesOptIn must be a boolean");
    }
    let language = parsed.language;
    if (body.language !== undefined) {
      if (typeof body.language !== "string" || !/^[a-z]{2}$/.test(body.language)) {
        return fail(400, "language must be a two-letter code");
      }
      language = body.language;
    }
    const { followUps, ...fields } = parsed;
    const recipeId = await ctx.runMutation(internal.worker.published, {
      jobId: id,
      recipe: { ...fields, recipeJsonUrl, language },
      followUps,
      memoriesOptIn: body.memoriesOptIn as boolean | undefined,
    });
    if (recipeId === "cancelled") return fail(409, "cancelled");
    return recipeId === "missing" ? fail(404, "no such job") : json({ recipeId });
  }),
});

// A deleted account's Supabase rows, GCS media and voice clone (pipeline/account_purge.py): the worker
// asks for the next deletion to purge (`exclude`: ones it already took this pass) and says how it went.
http.route({
  path: "/worker/deletions/next",
  method: "POST",
  handler: worker(async (ctx, body) => {
    const exclude = body.exclude ?? [];
    if (!Array.isArray(exclude) || exclude.length > 100 || !exclude.every((x) => isStr(x, 100))) {
      return fail(400, "exclude must be a list of deletion ids");
    }
    const next = await ctx.runQuery(internal.worker.nextDeletion, { now: Date.now(), exclude });
    return next ? json(next) : new Response(null, { status: 204 });
  }),
});

const COUNT_NAME = /^[A-Za-z][A-Za-z0-9]{0,39}$/;

/** `{ gcsObjects: 3, … }`: what the worker deleted. undefined when absent, null when malformed. */
function purgeCounts(raw: unknown): Record<string, number> | undefined | null {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = Object.entries(raw);
  const ok = entries.length <= 30 && entries.every(([k, n]) => COUNT_NAME.test(k) && Number.isInteger(n) && (n as number) >= 0);
  return ok ? (Object.fromEntries(entries) as Record<string, number>) : null;
}

http.route({
  path: "/worker/deletions/done",
  method: "POST",
  handler: worker(async (ctx, body) => {
    const id = isStr(body.deletionId, 100) ? await ctx.runQuery(internal.ids.deletion, { id: body.deletionId }) : null;
    if (!id) return fail(404, "no such deletion");
    if (typeof body.ok !== "boolean") return fail(400, "ok must be true or false");
    if (body.error !== undefined && typeof body.error !== "string") return fail(400, "error must be a string");
    const counts = purgeCounts(body.counts);
    if (counts === null) return fail(400, "counts must be { name: whole number }");
    const status = await ctx.runMutation(internal.worker.deletionDone, { deletionId: id, ok: body.ok, error: body.error, counts });
    return status === "missing" ? fail(404, "no such deletion") : json({ status });
  }),
});

// ---- Voice service → Convex ----

http.route({
  path: "/voice/session",
  method: "POST",
  handler: voice(async (ctx, body) => {
    if (!isStr(body.sessionToken, 200) || !isStr(body.recipeId, 100)) return fail(400, "sessionToken and recipeId are required");
    const view = await ctx.runQuery(internal.voice.sessionView, { sessionToken: body.sessionToken, recipeId: body.recipeId });
    if ("error" in view) return view.error === "signed_out" ? fail(401, "signed out") : fail(404, "no such recipe");
    const stepOrder = await ctx.runMutation(internal.cooking.setStep, {
      familyId: view.familyId,
      kidId: view.kid.personId,
      recipeId: view.recipe.recipeId,
    });
    return json({ ...view, stepOrder });
  }),
});

http.route({
  path: "/voice/step",
  method: "POST",
  handler: voice(async (ctx, body) => {
    if (!isStr(body.sessionToken, 200) || !isStr(body.recipeId, 100)) return fail(400, "sessionToken and recipeId are required");
    if (!isNum(body.stepOrder) || !Number.isInteger(body.stepOrder) || body.stepOrder < 1) return fail(400, "stepOrder must be a whole number from 1");
    const view = await ctx.runQuery(internal.voice.sessionView, { sessionToken: body.sessionToken, recipeId: body.recipeId });
    if ("error" in view) return view.error === "signed_out" ? fail(401, "signed out") : fail(404, "no such recipe");
    if (body.stepOrder > view.recipe.steps.length) return fail(400, "no such step");
    const stepOrder = await ctx.runMutation(internal.cooking.setStep, {
      familyId: view.familyId,
      kidId: view.kid.personId,
      recipeId: view.recipe.recipeId,
      stepOrder: body.stepOrder,
    });
    return json({ ok: true, stepOrder });
  }),
});

http.route({
  path: "/voice/question",
  method: "POST",
  handler: voice(async (ctx, body) => {
    if (!isStr(body.sessionToken, 200) || !isStr(body.recipeId, 100)) return fail(400, "sessionToken and recipeId are required");
    if (!isStr(body.text, 2000)) return fail(400, "text is required");
    if (body.stepOrder !== undefined && !isNum(body.stepOrder)) return fail(400, "stepOrder must be a number");
    let found: { startS: number; endS: number; quote: string } | undefined;
    if (body.found !== undefined && body.found !== null) {
      const f = body.found as Record<string, unknown>;
      if (!f || typeof f !== "object" || !isNum(f.startS) || !isNum(f.endS) || typeof f.quote !== "string") {
        return fail(400, "found must be { startS, endS, quote }");
      }
      found = { startS: f.startS, endS: f.endS, quote: f.quote };
    }
    const resolved = await ctx.runQuery(internal.sessions.resolve, { sessionToken: body.sessionToken });
    if (!resolved) return fail(401, "signed out");
    const recipeId = await ctx.runQuery(internal.ids.recipe, { id: body.recipeId });
    if (!recipeId) return fail(404, "no such recipe");
    const asked = await ctx.runMutation(internal.questions.ask, {
      familyId: resolved.familyId,
      personId: resolved.personId,
      recipeId,
      stepOrder: body.stepOrder as number | undefined,
      text: body.text,
      found,
    });
    return asked ? json(asked) : fail(404, "no such recipe");
  }),
});

// What's new for the person tapping homie (homie.ts), so the voice service can say it warmly (/homie/line).
http.route({
  path: "/homie/news",
  method: "POST",
  handler: voice(async (ctx, body) => {
    if (!isStr(body.sessionToken, 200)) return fail(400, "sessionToken is required");
    const news = await ctx.runQuery(internal.homie.newsByToken, { sessionToken: body.sessionToken, now: Date.now() });
    return news ? json(news) : fail(401, "signed out");
  }),
});

registerLiveRoutes(http);
registerGlassesRoutes(http);
registerInviteRoutes(http);

export default http;
