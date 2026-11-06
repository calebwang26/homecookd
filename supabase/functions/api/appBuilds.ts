// Which app builds still call this function, so the old services can be turned off once old builds stop
// calling (docs/build/CUTOVER.md, step 13). It ships switched off: LOG_APP_BUILDS below. Turning it on is that
// one line, then applying 20261102120000_app_builds_seen.sql and a Supabase deploy with every file in this
// folder (AGENTS.md), with Caleb's OK.
//
// The app sends no version of its own, but iOS sends one anyway: React Native's fetch goes through NSURLSession,
// which sets `User-Agent: <app name>/<CFBundleVersion> CFNetwork/<v> Darwin/<v>`, and CFBundleVersion is the
// build number (build 6 is 1.0). Only that number and a platform are kept, never the user agent itself, and
// nothing about the person: one row per UTC day, platform and build in app_builds_seen.
//
// Each isolate writes a (day, platform, build) once, after the response, with a short timeout. A failed write is
// logged by its kind only and never retried in that isolate that day. So the table says which builds called on
// which days. It isn't a count of requests.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** The switch. false: nothing is parsed or written. true: app_builds_seen fills (CUTOVER.md, step 13). */
export const LOG_APP_BUILDS: boolean = false;

export const APP_PLATFORMS = ["ios", "android", "web", "other"] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];
export type AppBuild = { platform: AppPlatform; build: string };

/** The build of anything that doesn't say one (a browser, Android's OkHttp, the pipeline, junk). */
export const UNKNOWN = "unknown";
/** A user agent longer than this is `other`, unread. */
export const UA_MAX = 512;
/** Distinct (platform, build) pairs one isolate writes in a day, so made-up user agents can't fill the table. */
export const MAX_PER_DAY = 50;
export const WRITE_TIMEOUT_MS = 2000;

// <app name>/<build> CFNetwork/<v> Darwin/<v>. The name is percent-encoded by iOS (no spaces or slashes). The
// build is CFBundleVersion: up to three numbers with dots, Apple's own rule. The table's check matches it.
const IOS = /^[^\s/]{1,100}\/([0-9]{1,6}(?:\.[0-9]{1,6}){0,2}) CFNetwork\/[0-9.]{1,20} Darwin\/[0-9.]{1,20}$/;
// React Native on Android sends OkHttp's own user agent, which has no app build.
const ANDROID = /^(?:okhttp|Dalvik)\//i;
const BROWSER = /^Mozilla\//;

/** The build and platform in a user agent. Anything it doesn't know is {other, unknown}. */
export function appBuildOf(userAgent: string | null | undefined): AppBuild {
  const ua = (userAgent ?? "").trim();
  if (!ua || ua.length > UA_MAX) return { platform: "other", build: UNKNOWN };
  const ios = IOS.exec(ua);
  if (ios) return { platform: "ios", build: ios[1] };
  if (ANDROID.test(ua)) return { platform: "android", build: UNKNOWN };
  if (BROWSER.test(ua)) return { platform: "web", build: UNKNOWN };
  return { platform: "other", build: UNKNOWN };
}

/** A failed write's kind for the log: a Postgres or PostgREST code, else the error's name. Never its words. */
function kindOf(error: { code?: string; message?: string } | null | undefined): string {
  if (error?.code) return error.code;
  return /^[A-Za-z]*Error\b/.exec(error?.message ?? "")?.[0] ?? "error";
}

export type BuildLogDeps = {
  /** LOG_APP_BUILDS in index.ts; tests pass either. */
  on: boolean;
  db: SupabaseClient;
  /** Runs the write after the response (index.ts: runInBackground). */
  background: (task: Promise<unknown>) => void;
  clock?: () => Date;
  timeoutMs?: number;
};

/** One per isolate. record() never throws, never waits and, switched off, does nothing at all. */
export function makeBuildLog({ on, db, background, clock = () => new Date(), timeoutMs = WRITE_TIMEOUT_MS }: BuildLogDeps) {
  let day = "";
  const seen = new Set<string>();

  async function write(row: { day: string; platform: AppPlatform; build: string; last_seen: string }): Promise<void> {
    try {
      // first_seen is left out, so its default fills it once and the upsert never moves it.
      const { error } = await db.from("app_builds_seen")
        .upsert(row, { onConflict: "day,platform,build" })
        .abortSignal(AbortSignal.timeout(timeoutMs));
      if (error) console.error("app build log failed:", kindOf(error));
    } catch (e) {
      console.error("app build log failed:", e instanceof Error ? e.name : "error");
    }
  }

  /** Note this request's build: one write per (day, platform, build) in this isolate, after the response. */
  function record(userAgent: string | null): void {
    if (!on) return;
    try {
      const now = clock();
      const today = now.toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        seen.clear();
      }
      const { platform, build } = appBuildOf(userAgent);
      const key = `${platform} ${build}`;
      if (seen.has(key) || seen.size >= MAX_PER_DAY) return;
      seen.add(key);
      background(write({ day, platform, build, last_seen: now.toISOString() }));
    } catch (e) {
      console.error("app build log failed:", e instanceof Error ? e.name : "error");
    }
  }

  return { record };
}
