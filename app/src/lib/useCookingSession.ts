// Cook mode's side of "Leo is cooking your chili" (RETENTION-HANDOFF 3.1), for app/cook/[id].tsx:
//
//   const other = useOtherCook(recipe);                // the dish's cook, when it isn't me
//   const cook = other?.role === 'cook' ? other : null; // cookProfile matches any name; only cooks
//   const live = useCookingSession({ recipeId: recipe?.id, cook, step: n, total,
//     onHeart: () => setHeartKey((k) => k + 1) });
//   <ConsentSheet visible={live.askConsent} cookName={cook?.name} profile={cook}
//     onYes={() => live.answerConsent(true)} onNotNow={() => void live.answerConsent(false)}
//     onDismiss={live.dismissConsent} />
//   (ConsentSheet's Yes awaits the promise: loading, then the sheet closes, or "Try again".)
//   <HeartBurst trigger={heartKey} fromName={cook?.name} />
//   finish(): await live.finish(); then cooked(...)   // "I made it"
//
// Opening cook mode on another family cook's dish tells the server at once (the first call of a
// session pushes that cook); step changes follow 2 s after the last one; leaving cook mode and "I
// made it" end it; 45 min without a step change ends it too, and the next step change starts a new
// session (back after a long simmer). The first time, the server answers 'unasked' and the screen
// shows the consent question once; "Not now" means nothing is ever sent (Android back only closes it
// for this visit: nothing saved, asked again next time). While the cook can see the
// session, the 1:1 thread with the cook is checked every 10 s (foreground, screen focused; at once
// when that resumes) for a heart newer than the session start: onHeart fires once per new heart,
// however often the screen loses focus (one feed per session, kept in a ref). No push for hearts.
// A memorial cook (`cook.memorial`, from GET /family) turns it all off. Against a server that doesn't
// send the flag, its answer does it: consent 'no' + memorial (nothing written, never 'unasked'), and
// the session sends nothing more that visit, so the question is never asked about them.
// The logic lives in lib/cookingLogic.ts (tested under Node); this file only binds it to React.
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { cookingApi, heartFetcher } from './cookingApi';
import {
  createCookingSession,
  FINISH_WAIT_MS,
  HEART_POLL_MS,
  heartFeedFor,
  type CookingSessionController,
  type HeartFeed,
  type HeartLike,
  type SessionApi,
  type SessionState,
} from './cookingLogic';

export type CookingSessionOptions = {
  recipeId: string | null | undefined;
  /**
   * The dish's cook when it is another family cook (null: me, a learner, a YouTube cook or anyone else
   * who isn't a family profile, no one). A family cook's sample dishes count as theirs, as on the
   * server: every family dish is a sample today (PR 2 departure in RETENTION-WIRING; TODO(caleb):
   * pass null for recipe.sample once real recordings exist). `memorial: true` turns the session off
   * (guardrail 2).
   */
  cook: { id: string; name: string; memorial?: boolean | null } | null | undefined;
  /** The step on screen, 1-based, and how many there are. */
  step: number;
  total: number;
  /** false turns it all off (e.g. the web dev aid). Default true. */
  enabled?: boolean;
  /** The server calls (default lib/cookingApi). */
  api?: SessionApi & { setShare: (share: boolean) => Promise<unknown> };
  /** Messages in the 1:1 with the cook after a server time (default heartFetcher(cook.id)). */
  fetchHearts?: (after: string) => Promise<readonly HeartLike[]>;
  /** A heart from the cook arrived this session. */
  onHeart?: (heart: HeartLike) => void;
};

export type CookingSession = {
  /** 'unknown' until the server answers. */
  consent: SessionState['consent'];
  /**
   * The last call to the server failed (offline, a refused dish, an app ahead of its server), so
   * `consent` stays 'unknown' until a later step change gets an answer. Nothing waits on it then.
   */
  startFailed: boolean;
  /** Show the consent question now (asked once; never again after an answer). */
  askConsent: boolean;
  /**
   * The consent answer. Yes: stored, then sharing starts at the current step (rejects when it couldn't
   * be saved, so the button can say "Try again"). No: honoured at once and never rejects.
   */
  answerConsent: (yes: boolean) => Promise<void>;
  /**
   * The sheet went away without an answer (Android back, Escape on web): nothing is shared this
   * visit, nothing is saved, and the next visit asks again. Only a tap on a button answers.
   */
  dismissConsent: () => void;
  /** The cook can see this session right now. */
  shared: boolean;
  /**
   * "I made it": ends the session now. Resolves once the server has it, or after 2 s at most (the end
   * still goes through in the background), so the cook's live row is gone before the made-it message
   * lands and a slow network never holds up the moment. Never rejects.
   */
  finish: () => Promise<void>;
};

const IDLE: SessionState = { consent: 'unknown', shared: false, startedAt: null, ended: false };

export function useCookingSession(o: CookingSessionOptions): CookingSession {
  const api = o.api ?? cookingApi;
  const cookId = o.cook?.id ?? null;
  const recipeId = o.recipeId ?? null;
  const on = (o.enabled ?? true) && !!cookId && !o.cook?.memorial && !!recipeId && o.total >= 1;

  const [state, setState] = useState<SessionState>(IDLE);
  const [startFailed, setStartFailed] = useState(false);
  const session = useRef<CookingSessionController | null>(null);
  // The newest step & callbacks, read from effects without restarting them.
  const latest = useRef({ step: o.step, total: o.total, api, onHeart: o.onHeart, fetchHearts: o.fetchHearts });
  useEffect(() => {
    latest.current = { step: o.step, total: o.total, api, onHeart: o.onHeart, fetchHearts: o.fetchHearts };
  });

  // One session per visit to one dish: opened on mount, stopped on leaving (or a new dish).
  useEffect(() => {
    if (!on || !cookId || !recipeId) return;
    let alive = true;
    const s = createCookingSession({
      recipeId,
      cookId,
      api: {
        // The session swallows a failed start (the next step change tries again); the screen only
        // needs to know it failed, so it stops waiting on the consent answer.
        start: (input) =>
          latest.current.api.start(input).then(
            (res) => {
              if (alive) setStartFailed(false);
              return res;
            },
            (e: unknown) => {
              if (alive) setStartFailed(true);
              throw e;
            },
          ),
        end: (rid) => latest.current.api.end(rid),
      },
      onChange: setState,
    });
    session.current = s;
    s.open(clampStep(latest.current.step, latest.current.total), latest.current.total);
    return () => {
      alive = false;
      session.current = null;
      void s.stop();
      setState(IDLE);
      setStartFailed(false);
    };
  }, [on, cookId, recipeId]);

  // Step changes (the session debounces and ignores repeats).
  useEffect(() => {
    if (on) session.current?.step(clampStep(o.step, o.total), o.total);
  }, [on, o.step, o.total]);

  // Hearts from the cook, while the cook can see the session.
  const focused = useFocusedSafe();
  const [active, setActive] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  const startedAt = state.shared ? state.startedAt : null;
  // One feed per session (cook + start), kept across focus & app-state changes: pausing and resuming
  // only stops and starts the timer, so a heart already shown never shows again.
  const feed = useRef<HeartFeed | null>(null);
  useEffect(() => {
    if (!on || !cookId || !startedAt || !focused || !active) return;
    const f = heartFeedFor(feed.current, {
      from: cookId,
      since: startedAt,
      fetchSince: (after) => (latest.current.fetchHearts ?? heartFetcher(cookId))(after),
    });
    feed.current = f;
    let stopped = false;
    const show = (heart: HeartLike | null) => {
      if (heart) latest.current.onHeart?.(heart);
    };
    // A heart that came in as the screen lost focus shows now.
    show(f.takeHeld());
    const tick = async () => show(await f.poll(() => !stopped));
    // Ask at once on (re)start, so pulling down Control Center now and then never starves the poll.
    void tick();
    const timer = setInterval(() => void tick(), HEART_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [on, cookId, startedAt, focused, active]);

  const answerConsent = useCallback(async (yes: boolean) => {
    if (!yes) {
      // Honoured at once, here; if saving fails, the next visit simply asks again.
      session.current?.answer(false);
      await latest.current.api.setShare(false).catch(() => {});
      return;
    }
    await latest.current.api.setShare(true);
    session.current?.answer(true);
  }, []);

  const dismissConsent = useCallback(() => {
    session.current?.answer(false);
  }, []);

  const finish = useCallback(async () => {
    const s = session.current;
    if (!s) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([s.stop(), new Promise<void>((r) => (timer = setTimeout(r, FINISH_WAIT_MS)))]);
    clearTimeout(timer);
  }, []);

  return {
    consent: state.consent,
    startFailed: on && startFailed,
    askConsent: on && state.consent === 'unasked' && !state.ended,
    answerConsent,
    dismissConsent,
    shared: state.shared,
    finish,
  };
}

const clampStep = (step: number, total: number) => Math.min(Math.max(1, Math.round(step) || 1), Math.max(1, total));

/** useIsFocused, but true outside a navigator. */
function useFocusedSafe(): boolean {
  try {
    return useIsFocused();
  } catch {
    return true;
  }
}
