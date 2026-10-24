// "Leo is cooking your chili" (RETENTION-HANDOFF 3.1), the parts with no React and no network, so
// scripts/test-cooking.mjs runs them under plain Node: the copy, which cook-mode calls to send when
// (start at once, step changes 2 s after the last one, end on "I made it", on leaving and after 45
// min idle; a step change after an idle end starts again), picking a new heart from the cook out of
// the 1:1 thread (one feed per session, kept while polling pauses), and the cook's live rows.
// The hooks around this: lib/useCookingSession.ts (cook mode) & lib/useLiveCooking.ts (cook Home).
// The server side: supabase/functions/api/cooking.ts.
//
// No imports at all (Node type-stripping runs this file as it is).

export const STEP_DEBOUNCE_MS = 2_000;
/** No step change for this long ends the session (the server also hides rows this old). */
export const IDLE_END_MS = 45 * 60_000;
export const HEART_POLL_MS = 10_000;
export const LIVE_POLL_MS = 15_000;
export const LIVE_FRESH_MS = 45 * 60_000;
/** "I made it" waits at most this long for the end call (offline never holds up the made-it moment). */
export const FINISH_WAIT_MS = 2_000;

/** null on the server = 'unasked' (read as no); 'unknown' = no answer from the server yet. */
export type CookingConsent = 'yes' | 'no' | 'unasked';

/** POST /cooking's answer. */
export type CookingStart = {
  ok: true;
  shared: boolean;
  consent: CookingConsent;
  /** Server clock; the heart watch looks for hearts newer than this. Null unless shared. */
  started_at: string | null;
  new_session: boolean;
  /** A memorial cook's dish (guardrail 2): nothing is stored or sent, consent comes back 'no', nothing is asked. */
  memorial?: boolean;
};

/** One row of GET /cooking: a kid in cook mode on one of my dishes. */
export type LiveCooking = {
  profile: { id: string; name: string; role: string; relation: string | null; avatar_key: string | null };
  recipe_id: string;
  cook_id: string;
  step: number;
  total: number;
  started_at: string;
  updated_at: string;
};

/** The fields of a chat message the heart watch reads (lib/api.ts Message fits). */
export type HeartLike = { id: string; kind: string; body?: string | null; sender_id: string; created_at: string };

// ---------------------------------------------------------------------------------------------
// Copy. Never in the cook's voice, no gendered pronouns, no guilt words.

const clean = (s: string | null | undefined) => (s ?? '').trim();

/** "Let Mom see when you cook their dishes?" (the handoff's question, about the dish's cook). */
export function consentQuestion(cookName: string | null | undefined): string {
  return `Let ${clean(cookName) || 'your family'} see when you cook their dishes?`;
}

/**
 * The one line under the question: what saying yes does. The answer is one setting for every cook
 * (profiles.share_cooking), so the line says so, not just the cook the question names (guardrail 6:
 * informed consent). The "changeable later" toggle says it the same way ("Show cooks when I cook").
 */
export function consentDetail(): string {
  return 'Each cook in the family gets a note when you start one of their dishes.';
}

/** "Leo is making your Sunday Chili" (pass the dish as the app says it: kitchen.ts dishName). */
export function liveTitle(kidName: string, dish: string | null | undefined): string {
  return `${clean(kidName) || 'Someone'} is making your ${clean(dish) || 'recipe'}`;
}

/** "Step 3 of 8". */
export function stepLine(step: number, total: number): string {
  return `Step ${step} of ${total}`;
}

/** The kid's toast when a heart lands mid-cook: "Mom sent you a heart". */
export function heartToast(cookName: string | null | undefined): string {
  return `${clean(cookName) || 'Your family'} sent you a heart`;
}

/**
 * A reaction message (a cook's heart mid-cook, "Just like mine"): the chat shows it as a small
 * centred stamp (components/cooking/ReactionStamp), never a bubble with its raw body, and it is never
 * a preview, an unread, the last message, or an answer to a question.
 */
export const isReactionMessage = (m: { kind?: string | null } | null | undefined) => m?.kind === 'reaction';

/** The stamp's words beside the heart: "Mom", "You"; "Just like mine" adds the words: "“Just like mine.” · Mom". */
export function reactionStampText(body: string | null | undefined, who: string | null | undefined, mine = false): string {
  const name = mine ? 'You' : clean(who) || 'Your family';
  return body === 'just_like_mine' ? `“Just like mine.” · ${name}` : name;
}

// ---------------------------------------------------------------------------------------------
// Hearts from the cook (kid side). Polled from the 1:1 thread every 10 s while cooking; no push.

const at = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

/** Hearts from `from` newer than `since` (server time) not seen yet, oldest first. */
export function newHearts(messages: readonly HeartLike[], o: { from: string; since: string; seen: ReadonlySet<string> }): HeartLike[] {
  const after = at(o.since);
  return messages
    .filter((m) => m.kind === 'reaction' && m.body === 'heart' && m.sender_id === o.from && at(m.created_at) > after && !o.seen.has(m.id))
    .sort((a, b) => at(a.created_at) - at(b.created_at));
}

/**
 * Watches the thread for hearts from the cook since the session started. `poll()` asks for messages
 * after a cursor (the newest message seen, so each poll is small) and resolves the newest new heart,
 * or null. Several hearts between two polls make one burst. Never throws.
 */
export function createHeartWatch(o: { from: string; since: string; fetchSince: (cursor: string) => Promise<readonly HeartLike[]> }) {
  const seen = new Set<string>();
  let cursor = o.since;
  return {
    async poll(): Promise<HeartLike | null> {
      let list: readonly HeartLike[];
      try {
        list = await o.fetchSince(cursor);
      } catch {
        return null;
      }
      if (!Array.isArray(list)) return null;
      for (const m of list) if (at(m.created_at) > at(cursor)) cursor = m.created_at;
      const fresh = newHearts(list, { from: o.from, since: o.since, seen });
      for (const m of fresh) seen.add(m.id);
      return fresh.at(-1) ?? null;
    },
  };
}

export type HeartFeed = {
  /** The session it belongs to (heartFeedKey). */
  key: string;
  /**
   * One poll: the newest new heart while `listening()` is still true when the answer comes back. A
   * heart that lands after the listener stopped (the screen lost focus mid-poll) is held for the next
   * poll or takeHeld(), so it is shown once, late, rather than never.
   */
  poll(listening?: () => boolean): Promise<HeartLike | null>;
  /** The held heart, if any (shown when polling resumes). */
  takeHeld(): HeartLike | null;
};

/**
 * One feed per session: the cook and the session's start (server clock), as an instant, so the same
 * start spelled two ways ("...00.123Z" / "...00.123+00:00") is still the same session.
 */
export const heartFeedKey = (from: string, since: string) => {
  const t = Date.parse(since);
  return `${from}|${Number.isFinite(t) ? t : since}`;
};

/**
 * The heart feed for this session. The same session (cook + start) gets `current` back as it is, so
 * polling can stop and start again (focus, Control Center, a notification banner) without a fresh
 * cursor and an empty `seen`: an old heart never bursts twice. Another cook or a new session start
 * gets a new feed.
 */
export function heartFeedFor(
  current: HeartFeed | null | undefined,
  o: { from: string; since: string; fetchSince: (cursor: string) => Promise<readonly HeartLike[]> },
): HeartFeed {
  const key = heartFeedKey(o.from, o.since);
  if (current && current.key === key) return current;
  const watch = createHeartWatch(o);
  let held: HeartLike | null = null;
  return {
    key,
    async poll(listening = () => true) {
      const heart = await watch.poll();
      if (heart) held = heart;
      if (!held || !listening()) return null;
      const out = held;
      held = null;
      return out;
    },
    takeHeld() {
      const out = held;
      held = null;
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The cook's live rows (cook Home).

/** Fresh rows only (the server checks too), one per kid (their newest), newest step first. */
export function freshLive(rows: readonly LiveCooking[], now: number, freshMs = LIVE_FRESH_MS): LiveCooking[] {
  const byKid = new Map<string, LiveCooking>();
  for (const r of rows) {
    if (!r?.profile?.id || now - at(r.updated_at) >= freshMs) continue;
    const had = byKid.get(r.profile.id);
    if (!had || at(r.updated_at) > at(had.updated_at)) byKid.set(r.profile.id, r);
  }
  return [...byKid.values()].sort((a, b) => at(b.updated_at) - at(a.updated_at));
}

/** A key for one session's row: a new session (or another dish) is a new row, so its heart resets. */
export const liveKey = (r: Pick<LiveCooking, 'profile' | 'recipe_id' | 'started_at'>) => `${r.profile.id}:${r.recipe_id}:${r.started_at}`;

// ---------------------------------------------------------------------------------------------
// The cook-mode session (kid side).

export type SessionApi = {
  start: (input: { recipe_id: string; cook_id: string; step: number; total: number }) => Promise<CookingStart>;
  end: (recipeId: string) => Promise<unknown>;
};
export type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};
export type SessionState = {
  /** 'unknown' until the server answers (offline: stays, and the next step tries again). */
  consent: CookingConsent | 'unknown';
  /** The server is showing this session to the cook. */
  shared: boolean;
  /** The session's start, server clock (for the heart watch). Set once a session, never respelled. */
  startedAt: string | null;
  ended: boolean;
};

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * One cook-mode visit to one dish. Sends POST /cooking at once on open, then 2 s after the last step
 * change (one call in flight at a time; the newest step wins), nothing while the kid hasn't said yes,
 * and POST /cooking/end on stop (after any call in flight, so a late step never brings the row
 * back). 45 min without a step change ends the session; if the kid then moves to another step (back
 * after a long simmer), a new session starts at once (after that end reached the server; the
 * server's one-push-a-day rule keeps the cook from a second push). stop() is final. Every call is
 * best effort: a failure never reaches the screen, and the next step change tries again.
 */
export function createCookingSession(o: {
  recipeId: string;
  cookId: string;
  api: SessionApi;
  timers?: Timers;
  debounceMs?: number;
  idleMs?: number;
  onChange?: (s: SessionState) => void;
}) {
  const timers = o.timers ?? realTimers;
  const debounceMs = o.debounceMs ?? STEP_DEBOUNCE_MS;
  const idleMs = o.idleMs ?? IDLE_END_MS;
  let state: SessionState = { consent: 'unknown', shared: false, startedAt: null, ended: false };
  let latest: { step: number; total: number } | null = null;
  let sentStep: { step: number; total: number } | null = null;
  let inFlight: Promise<void> | null = null;
  let again = false;
  let debounce: unknown = null;
  let idle: unknown = null;
  /** stop() ran ("I made it", leaving): nothing after it. An idle end leaves this false. */
  let closed = false;
  /** The end call of the last idle end, so a new session never reaches the server before it. */
  let ending: Promise<void> | null = null;
  /** Bumped at each end: an answer that comes back after it belongs to the old session. */
  let generation = 0;

  const set = (patch: Partial<SessionState>) => {
    state = { ...state, ...patch };
    o.onChange?.(state);
  };
  const wantsServer = () => !state.ended && (state.consent === 'unknown' || state.consent === 'yes');
  const clear = (h: unknown) => {
    if (h !== null) timers.clearTimeout(h);
  };

  function armIdle() {
    clear(idle);
    idle = timers.setTimeout(() => void finish(false), idleMs);
  }

  function send(): void {
    if (!latest || !wantsServer()) return;
    if (inFlight) {
      again = true;
      return;
    }
    const at = latest;
    const gen = generation;
    inFlight = o.api
      .start({ recipe_id: o.recipeId, cook_id: o.cookId, step: at.step, total: at.total })
      .then((res) => {
        if (gen !== generation || state.ended || !res || typeof res !== 'object') return;
        if (res.memorial) {
          // A memorial cook can't see anything, so there is nothing to ask about them: 'no' for this
          // visit and no more calls (the server answers 'no' already; this holds even if it didn't).
          sentStep = null;
          set({ consent: 'no', shared: false, startedAt: null });
          return;
        }
        // Only a stored step counts as sent (an 'unasked' answer stored nothing).
        sentStep = res.shared ? at : null;
        // The start is set once a session: only the call that started it (or the first shared answer)
        // may change it, so a step answer spelling the same time another way never restarts the heart
        // feed (a heart already shown would burst again).
        const startedAt = !res.shared
          ? null
          : res.new_session || !state.startedAt
            ? (res.started_at ?? state.startedAt)
            : state.startedAt;
        set({ consent: res.consent, shared: !!res.shared, startedAt });
      })
      .catch(() => {
        // Offline or refused: the next step change tries again.
      })
      .finally(() => {
        inFlight = null;
        if (again) {
          again = false;
          const now = latest;
          if (now && (!sentStep || now.step !== sentStep.step || now.total !== sentStep.total)) send();
        }
      });
  }

  /** Cook mode opened on this dish at this step: the first call goes at once. */
  function open(step: number, total: number) {
    if (closed) return;
    if (state.ended) return reopen(step, total);
    latest = { step, total };
    armIdle();
    send();
  }

  /** After an idle end: a new session at this step, sent once the idle end's call has finished. */
  function reopen(step: number, total: number) {
    latest = { step, total };
    sentStep = null;
    set({ ended: false, shared: false, startedAt: null });
    armIdle();
    const go = () => {
      if (!closed && !state.ended) send();
    };
    if (ending) void ending.then(go);
    else go();
  }

  /** The kid moved to another step: sent 2 s after the last change. The same step again is nothing. */
  function step(step: number, total: number) {
    if (closed) return;
    if (latest && latest.step === step && latest.total === total) return;
    if (state.ended) return reopen(step, total);
    latest = { step, total };
    armIdle();
    clear(debounce);
    debounce = timers.setTimeout(() => {
      debounce = null;
      send();
    }, debounceMs);
  }

  /**
   * The consent answer, after the app stored it (POST /profile/share-cooking). Yes sends now. No sends
   * nothing more this visit; it is also how the sheet goes away for this visit only (Android back),
   * when nothing was stored and the next visit asks again.
   */
  function answer(yes: boolean) {
    if (state.ended) return;
    set({ consent: yes ? 'yes' : 'no', shared: false });
    if (yes) send();
  }

  /** Ends the session: for good ("I made it", leaving) or until the next step change (45 min idle). */
  async function finish(final: boolean): Promise<void> {
    if (final) closed = true;
    if (state.ended) {
      if (ending) await ending;
      return;
    }
    const told = state.consent === 'yes' || state.consent === 'unknown';
    clear(debounce);
    clear(idle);
    debounce = idle = null;
    again = false;
    generation += 1;
    set({ ended: true, shared: false });
    const run = (async () => {
      if (inFlight) await inFlight;
      if (told) await o.api.end(o.recipeId).catch(() => {});
    })();
    ending = run;
    await run;
    if (ending === run) ending = null;
  }

  /** "I made it" or leaving cook mode: final. Safe to call more than once. */
  const stop = () => finish(true);

  return { open, step, answer, stop, get state() { return state; } };
}

export type CookingSessionController = ReturnType<typeof createCookingSession>;
