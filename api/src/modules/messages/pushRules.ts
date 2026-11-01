// What a push may do and what it says: pure, so every branch is unit-tested. The caps and the copy are Supabase's plumbing.ts and cooking.ts, the craving's
// quiet-hours wait is Convex's lib/push.ts. SCHEMA.md: their kinds don't overlap, so the two rule sets stay apart.
//
// Rules that hold here (RETENTION-HANDOFF.md, section 5): push copy only ever quotes what someone actually sent, never in the cook's voice; no assuming anyone's
// gender and no guilt words; caps and quiet hours apply only to pushes homecookd sends on its own.
import { DEFAULT_TZ, inQuietHours, localDateKey, localParts, monthStartUtc, NUDGE_AT, QUIET_FROM_HOUR, QUIET_TO_HOUR, RECAP_AT, validTz, weekStartUtc, zoneOf } from "./time.js";

const pad = (n: number) => String(n).padStart(2, "0");

// ---------------------------------------------------------------------------------------------
// Caps

export type CapRole = "cook" | "learner";
export const CAP_REASONS = ["quiet", "daily", "weekly", "monthly"] as const;
export type CapReason = (typeof CAP_REASONS)[number];
export type CapInput = {
  role: CapRole;
  appInitiated: boolean;
  now: Date;
  tz: string;
  /** This person's recent pushes that were really sent (skipped ones left out). */
  recent: { sent_at: string; app_initiated: boolean }[];
};

/** Kid: 1 a local day and 3 a local week (Mon-Sun). Cook: 1 a local month. */
export const CAPS = { learnerPerDay: 1, learnerPerWeek: 3, cookPerMonth: 1 } as const;

export function capCheck(i: CapInput): { ok: true } | { ok: false; reason: CapReason } {
  if (!i.appInitiated) return { ok: true };
  const tz = zoneOf(i.tz);
  if (inQuietHours(i.now, tz)) return { ok: false, reason: "quiet" };
  const times = i.recent
    .filter((r) => r.app_initiated)
    .map((r) => Date.parse(r.sent_at))
    .filter((t) => Number.isFinite(t))
    .map((t) => new Date(t));
  if (i.role === "learner") {
    const today = localDateKey(i.now, tz);
    if (times.filter((t) => localDateKey(t, tz) === today).length >= CAPS.learnerPerDay) return { ok: false, reason: "daily" };
    const week = weekStartUtc(i.now, tz).getTime();
    if (times.filter((t) => weekStartUtc(t, tz).getTime() === week).length >= CAPS.learnerPerWeek) return { ok: false, reason: "weekly" };
    return { ok: true };
  }
  const month = monthStartUtc(i.now, tz).getTime();
  if (times.filter((t) => monthStartUtc(t, tz).getTime() === month).length >= CAPS.cookPerMonth) return { ok: false, reason: "monthly" };
  return { ok: true };
}

/** How long until quiet hours (21:00-08:00 in `tz`) end; 0 outside them. A DST night can be an hour off. */
export function quietDelayMs(now: number, tz: string): number {
  const p = localParts(new Date(now), validTz(tz) ?? DEFAULT_TZ);
  const m = p.hour * 60 + p.minute;
  const from = QUIET_FROM_HOUR * 60;
  const to = QUIET_TO_HOUR * 60;
  if (m < from && m >= to) return 0;
  return ((((to - m) % 1440) + 1440) % 1440) * 60_000;
}

// ---------------------------------------------------------------------------------------------
// Push tokens

const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]\s]{1,200}\]$/;
export const PLATFORMS = ["ios", "android"] as const;
export type Platform = (typeof PLATFORMS)[number];

export function validPushToken(v: unknown): v is string {
  return typeof v === "string" && EXPO_TOKEN.test(v);
}

// ---------------------------------------------------------------------------------------------
// Copy for new messages

export type PushKind = "message" | "question" | "recipe" | "started" | "postcard" | "reaction" | "table_nudge" | "recap";
export type PushCopy = { kind: PushKind; title: string; body: string; url: string };

/** The fields of a stored message the copy needs. */
export type MessageLike = {
  kind: string;
  thread_id: string;
  body?: string | null;
  library_id?: string | null;
  step_order?: number | null;
  duration_s?: number | string | null;
  audio_key?: string | null;
  clip_key?: string | null;
};

export const PUSH_TEXT_MAX = 90;

/** One line, at most `max` characters, ending in "…" when cut. Never splits an emoji. */
export function truncate(s: string, max = PUSH_TEXT_MAX): string {
  const flat = s.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  if (chars.length <= max) return flat;
  return chars.slice(0, max - 1).join("").trimEnd() + "…";
}

/** 38 -> "0:38", 125 -> "2:05". */
export function mmss(seconds: number | string | null | undefined): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

export const chatUrl = (threadId: string) => `/chat/${threadId}`;
export const recipeUrl = (id: string) => `/recipe/${id}`;

const named = (s: string) => truncate(s, 40);
const isSpoken = (m: MessageLike) => !!(m.audio_key || m.clip_key);

export function textPush(m: MessageLike, sender: string): PushCopy | null {
  const text = (m.body ?? "").trim();
  if (!text) return null;
  return { kind: "message", title: named(sender), body: truncate(text), url: chatUrl(m.thread_id) };
}

export function voicePush(m: MessageLike, sender: string, dish: string | null): PushCopy {
  const len = mmss(m.duration_s);
  const body = m.audio_key || !m.clip_key ? `Sent a voice note · ${len}` : dish ? truncate(`Sent a clip from ${dish} · ${len}`) : `Sent a clip · ${len}`;
  return { kind: "message", title: named(sender), body, url: chatUrl(m.thread_id) };
}

export function questionPush(m: MessageLike, sender: string, dish: string | null): PushCopy {
  const text = (m.body ?? "").trim();
  const body = text ? truncate(text) : isSpoken(m) ? `Sent a voice question · ${mmss(m.duration_s)}` : "Sent a question";
  const title = dish ? truncate(`${named(sender)} asked about ${dish}`) : `${named(sender)} asked you`;
  return { kind: "question", title, body, url: chatUrl(m.thread_id) };
}

export function recipePush(m: MessageLike, sender: string, dish: string | null): PushCopy {
  return {
    kind: "recipe",
    title: `Just in from ${named(sender)}`,
    body: dish ? truncate(dish) : "A new recipe",
    url: m.library_id ? recipeUrl(m.library_id) : chatUrl(m.thread_id),
  };
}

/** The push for a message someone just sent, or null when that kind sends none: a dish someone made, a system note, a heart, a photo. */
export function messagePush(m: MessageLike, sender: string, dish: string | null): PushCopy | null {
  switch (m.kind) {
    case "text":
    case "request":
      return textPush(m, sender);
    case "voice":
      return voicePush(m, sender, dish);
    case "question":
      return questionPush(m, sender, dish);
    case "step": {
      // A kid's step message with words is a step question; without, it just shares the step.
      if ((m.body ?? "").trim() || isSpoken(m)) return questionPush(m, sender, dish);
      const step = m.step_order ? `step ${m.step_order}` : "a step";
      return { kind: "message", title: named(sender), body: truncate(dish ? `Sent ${step} of ${dish}` : `Sent ${step}`), url: chatUrl(m.thread_id) };
    }
    case "recipe":
      return recipePush(m, sender, dish);
    case "reaction":
      // Hearts are in-app only. "Just like mine" answers a dish someone made.
      if (m.body !== "just_like_mine") return null;
      return {
        kind: "reaction",
        title: named(sender),
        body: dish ? truncate(`“Just like mine.” on your ${dish}`) : "“Just like mine.”",
        url: chatUrl(m.thread_id),
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Dishes, postcards, reactions (cooking.ts)

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** The dish as people say it, the app's dishName() rule: "Mom's Sunday Chili" -> "Sunday Chili", a long title cut at "with / and / in / on". */
export function dishName(title: string | null | undefined, cook?: string | null): string {
  let t = (title ?? "").trim();
  if (!t) return "recipe";
  const m = /^(.+?)['’]s\s+(.+)$/.exec(t);
  if (m && (!cook || norm(m[1]) === norm(cook) || m[1].split(/\s+/).length <= 2)) t = m[2];
  if (t.length > 22) {
    const short = t.split(/\s+(?:with|and|in|on)\s+/i)[0];
    if (short.length >= 4) t = short;
  }
  return t;
}

export function postcardPush(kidName: string, dish: { title: string; cook_name: string | null } | null): PushCopy {
  return {
    kind: "postcard",
    title: truncate(`${named(kidName)} made your ${dishName(dish?.title, dish?.cook_name)}`),
    body: "Sent you a postcard.",
    url: "/parent/home",
  };
}

/** One postcard push per cooked message, however often the photo is re-sent. */
export const postcardKey = (messageId: string) => `postcard:${messageId}`;

export const REACTIONS = ["heart", "just_like_mine"] as const;
export const isReaction = (v: unknown): boolean => typeof v === "string" && (REACTIONS as readonly string[]).includes(v);

/** Hearts never push. "Just like mine" pushes only whoever made the dish it answers, once. */
export function reactionPush(
  reaction: { body: string | null; thread_id: string; reply_to: string | null },
  sender: { id: string; name: string },
  answered: { id: string; kind: string; sender_id: string } | null,
  dish: string | null,
): { to: string; copy: PushCopy; dedupeKey: string } | null {
  if (reaction.body !== "just_like_mine") return null;
  if (!answered || answered.id !== reaction.reply_to || answered.kind !== "cooked") return null;
  if (answered.sender_id === sender.id) return null;
  const copy = messagePush({ kind: "reaction", body: reaction.body, thread_id: reaction.thread_id }, sender.name, dish);
  if (!copy) return null;
  return { to: answered.sender_id, copy, dedupeKey: `reaction:${answered.id}:just_like_mine` };
}

// ---------------------------------------------------------------------------------------------
// Who is due, hour by hour

export type CronPerson = { id: string; family_id: string; role: "cook" | "learner"; tz: string | null; memorial: boolean; removed_at: string | null };

/** Kids in their local Sunday 17:xx get the nudge, anyone on their local 1st at 10:xx the recap. */
export function dueProfiles<P extends CronPerson>(people: P[], now: Date): { nudge: P[]; recap: P[] } {
  const due: { nudge: P[]; recap: P[] } = { nudge: [], recap: [] };
  for (const p of people) {
    if (p.removed_at || p.memorial) continue;
    const at = localParts(now, zoneOf(p.tz));
    if (p.role === "learner" && at.weekday === NUDGE_AT.weekday && at.hour === NUDGE_AT.hour) due.nudge.push(p);
    if (at.day === RECAP_AT.day && at.hour === RECAP_AT.hour) due.recap.push(p);
  }
  return due;
}
