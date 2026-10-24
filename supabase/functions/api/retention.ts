// Retention for the api function (docs/build/RETENTION-HANDOFF.md): the one file index.ts imports.
// It re-exports every retention module and composes their routes & cron jobs in one makeRetention()
// call, each route tagged with the PR it belongs to, so the wiring turns PRs on one at a time with a
// single list (`prs`). Wiring steps: docs/build/RETENTION-WIRING.md.
//
//   PR 1 plumbing    plumbing.ts  POST /push-tokens, POST /push-tokens/remove, POST /cron/hourly (public),
//                                 notify() & the caps, push copy, x-tz, the library, recipe-event kinds
//   PR 2 cooking     cooking.ts   POST /cooking, POST /cooking/end, GET /cooking,
//                                 GET & POST /profile/share-cooking; the reaction push rule
//   PR 3 send home   (none here)  POST /messages/:id/postcard lives in index.ts, on qa-cook's photo
//                                 helpers (photoPathFor, voiceExists(…, PHOTO_BUCKET), the signed
//                                 photo_url); its push copy is cooking.ts's postcardPush()/postcardKey(),
//                                 its column (messages.rating) is in PR 1's migration and, idempotently,
//                                 20261018100400_retention_postcard.sql
//   PR 4 hearts      hearts.ts    GET /dish-stats, GET /hearts/recent
//   PR 5 table       tablePr.ts   GET /table; cron job `table_nudge` (pure rules: table.ts)
//   PR 6 recap       recapPr.ts   GET /recap; cron job `recap` (pure slides: recap.ts)
//   PR 7 touches     (app only)
//
// Imports (no cycles): time.ts imports nothing; table.ts & recap.ts import time.ts; plumbing.ts
// imports time.ts (+ types); the PR modules import plumbing.ts / time.ts / table.ts / recap.ts and never
// this file. Only index.ts imports this file. supabase/tests/retention_wiring_test.ts checks it.
//
// index.ts (RETENTION-WIRING.md section 3.4, then one number per later PR):
//
//   const library = makeLibrary({ bucketUrl: BUCKET_URL });
//   const retention = makeRetention<Ctx>({
//     prs: [1, 2, 4, 5, 6],          // PR 1 is always on; add each later PR as it lands
//     db, HttpError, requireMe, rateLimit, dbFail, clientIp, assertRecipe, library,
//     answersFor: (fam, rows) => answersFor(familyCtx(fam), rows as unknown as MessageRow[]),
//     expoAccessToken: Deno.env.get("EXPO_ACCESS_TOKEN") ?? null,
//   });
//   for (const r of retention.routes) on(r.method, r.path, r.handler, r.auth);
//   for (const r of retention.publicRoutes) onPublic(r.method, r.path, r.handler);
//
// A PR that is on but missing what it needs (library for 2, 4, 5 & 6; answersFor for 6) throws at
// module init, so a bad deploy fails its first request loudly instead of half-working.

import { makeCooking } from "./cooking.ts";
import { makeHearts } from "./hearts.ts";
import {
  type CronJob,
  type Library,
  makePlumbing,
  type PlumbingDeps,
  type PublicRouteArgs,
  type RetentionCtx,
  type RouteArgs,
} from "./plumbing.ts";
import { makeRecap, type RecapDeps } from "./recapPr.ts";
import { makeTable } from "./tablePr.ts";

export * from "./time.ts";
export * from "./table.ts";
export * from "./recap.ts";
export * from "./plumbing.ts";
export * from "./cooking.ts";
export * from "./hearts.ts";
export * from "./tablePr.ts";
export * from "./recapPr.ts";

/** The retention PRs with server routes or jobs in these modules (RETENTION-HANDOFF section 6). */
export const RETENTION_PRS = [1, 2, 4, 5, 6] as const;
export type RetentionPr = (typeof RETENTION_PRS)[number];

export type RouteAuth = { lenientMe?: boolean };
/** A signed-in route, as index.ts's on(method, path, handler, auth) takes it, tagged with its PR. */
export type RetentionRoute<C> = {
  pr: RetentionPr;
  method: "GET" | "POST";
  path: string;
  handler: (a: RouteArgs<C>) => Promise<unknown>;
  auth: RouteAuth;
};
/** A public route, as index.ts's onPublic(method, path, handler) takes it, tagged with its PR. */
export type RetentionPublicRoute = {
  pr: RetentionPr;
  method: "GET" | "POST";
  path: string;
  handler: (a: PublicRouteArgs) => Promise<unknown>;
};

export type RetentionDeps<C extends RetentionCtx> = Omit<PlumbingDeps<C>, "requireMe"> & {
  /** index.ts's requireMe: the acting person (cooking.ts & hearts.ts read their name). */
  requireMe: (ctx: C) => { id: string; name: string };
  /**
   * Which PRs to turn on. PR 1 is always on (every later PR pushes, or runs on the cron, through it).
   * Default: PR 1 alone.
   */
  prs?: readonly RetentionPr[];
  /** index.ts's makeLibrary() (one 10-minute cache for everything). Needed by PRs 2, 4, 5 & 6. */
  library?: Library;
  /** index.ts's assertRecipe (cached HEAD of recipe.json). PR 2 checks a dish once per cook-mode session. */
  assertRecipe?: (recipeId: string) => Promise<void>;
  /** index.ts's answersFor() over a whole family (RETENTION-WIRING.md, PR 6 wiring). Needed by PR 6. */
  answersFor?: RecapDeps<C>["answersFor"];
  /** qa-cook's photo signer (signVoice(paths, PHOTO_BUCKET)). PR 6 only; without it postcards show no photo. */
  signPhotos?: RecapDeps<C>["signPhotos"];
};

/** The PRs that are on: PR 1 plus `prs`, in order. Throws on a PR that has nothing here. */
export function retentionPrs(prs: readonly number[] | undefined): RetentionPr[] {
  const known = new Set<number>(RETENTION_PRS);
  for (const n of prs ?? []) {
    if (!known.has(n)) throw new Error(`makeRetention: PR ${n} has no server routes here (PRs: ${RETENTION_PRS.join(", ")})`);
  }
  const on = new Set<number>([1, ...(prs ?? [])]);
  return RETENTION_PRS.filter((n) => on.has(n));
}

export function makeRetention<C extends RetentionCtx>(deps: RetentionDeps<C>) {
  const prs = retentionPrs(deps.prs);
  const isOn = (pr: RetentionPr) => prs.includes(pr);
  const need = <T>(pr: RetentionPr, name: string, value: T | undefined): T => {
    if (value === undefined || value === null) throw new Error(`makeRetention: PR ${pr} needs ${name}`);
    return value;
  };

  const plumbing = makePlumbing<C>(deps);
  const { db, HttpError, requireMe, rateLimit, dbFail } = deps;
  const routes: RetentionRoute<C>[] = [];
  const publicRoutes: RetentionPublicRoute[] = [];
  const verb = (m: string): "GET" | "POST" => {
    if (m !== "GET" && m !== "POST") throw new Error(`makeRetention: unexpected method ${m}`);
    return m;
  };
  // Typed so each module's handler must accept what index.ts hands it (RouteArgs / PublicRouteArgs).
  const add = (pr: RetentionPr, list: { method: string; path: string; handler: RetentionRoute<C>["handler"]; auth: RouteAuth }[]) => {
    for (const r of list) routes.push({ pr, method: verb(r.method), path: r.path, handler: r.handler, auth: r.auth });
  };
  const addJob = (pr: RetentionPr, job: CronJob) => plumbing.cronJobs.push({ ...job, pr });

  // PR 1: push tokens & the hourly cron.
  add(1, plumbing.routes);
  for (const r of plumbing.publicRoutes) {
    const handler: RetentionPublicRoute["handler"] = r.handler;
    publicRoutes.push({ pr: 1, method: verb(r.method), path: r.path, handler });
  }

  // PR 2: Leo is cooking.
  const cooking = isOn(2)
    ? makeCooking<C>({
      db,
      HttpError,
      requireMe,
      rateLimit,
      dbFail,
      notify: plumbing.notify,
      library: need(2, "library", deps.library),
      assertRecipe: deps.assertRecipe,
    })
    : null;
  if (cooking) add(2, cooking.routes);

  // PR 4: hearts & kitchen.
  const hearts = isOn(4) ? makeHearts<C>({ db, HttpError, requireMe, dbFail, library: need(4, "library", deps.library) }) : null;
  if (hearts) add(4, hearts.routes);

  // PR 5: the Sunday table & its Sunday nudge.
  const table = isOn(5) ? makeTable<C>({ db, dbFail, library: need(5, "library", deps.library) }) : null;
  if (table) {
    add(5, table.routes);
    addJob(5, table.cronJob);
  }

  // PR 6: month in the kitchen & its 1st-of-month push.
  const recap = isOn(6)
    ? makeRecap<C>({
      db,
      HttpError,
      requireMe,
      dbFail,
      library: need(6, "library", deps.library),
      answersFor: need(6, "answersFor", deps.answersFor),
      signPhotos: deps.signPhotos,
    })
    : null;
  if (recap) {
    add(6, recap.routes);
    addJob(6, recap.cronJob);
  }

  return {
    /** The PRs that are on, in order (PR 1 always). */
    prs,
    /** Signed-in routes of the PRs that are on, each tagged with its PR: on(r.method, r.path, r.handler, r.auth). */
    routes,
    /** Public routes of the PRs that are on (PR 1's /cron/hourly): onPublic(r.method, r.path, r.handler). */
    publicRoutes,
    /** notify(profileId, push, now?): caps, dedupe & the Expo sender. Never throws. */
    notify: plumbing.notify,
    /** notify after the response (never awaited by the request). */
    notifyLater: plumbing.notifyLater,
    /** The hourly jobs, already registered for the PRs that are on. index.ts never adds to it. */
    cronJobs: plumbing.cronJobs,
    // Handlers by name, for tests.
    registerToken: plumbing.registerToken,
    removeToken: plumbing.removeToken,
    cronHourly: plumbing.cronHourly,
    /** Each later PR's module when it's on (null when off), for tests & index.ts hooks. */
    cooking,
    hearts,
    table,
    recap,
  };
}
