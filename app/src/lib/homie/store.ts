// homie's one store: the pot that rests top-right on every screen (components/homie/HomieOverlay,
// mounted once in app/_layout). Screens say what homie is doing; the overlay draws it.
//
//   setHomie({ state: 'listening' })     the screen's state: off | listening | thinking | timer
//   setHomieLevel(level)                 mic level 0..1 (re-renders only on a visible change)
//   pulseLit()                           the warm beat before homie speaks, then 'speaking'
//   doneSpeaking()                       back to the screen's state (the overlay calls it when a say ends)
//   showMoment({ id, question, options, onChoose })   homie needs you: centre, blur, big buttons
//   showMoment({ id, question, options: [], bars: true, prompt: { label: 'Say “yes” or “no”' },
//                tapToClose: 'Tap anywhere to close', onChoose })   homie asks out loud: no buttons,
//                                        one centred column (any of bars / prompt / tapToClose)
//   chooseMoment(optionId)               closes it (unless the option keepOpen), then onChoose
//   dismissMoment(id?)                   closes it as "not now" (a tap anywhere): onChoose('not_now')
//   closeMoment(id?)                     reverses it; a stale id leaves a newer moment alone
//   setHomie({ shrunk: true })           the cook's own voice is playing: the resting pot steps back
//   useHomie()                           the current value, in a component
//   useHomieSelect((h) => h.state)       one part of it (no re-render on each mic level)
//
// 'lit' and 'speaking' sit on top of the screen's state: a screen that sets 'listening' while homie
// speaks gets it back once homie is done. Any AI say playing (lib/live/say keys) also shows as
// 'speaking' on its own (lib/homie/logic potState), so the kid's voice replies light the pot too.
import { useSyncExternalStore } from 'react';

export type HomieState = 'off' | 'listening' | 'thinking' | 'lit' | 'speaking' | 'timer';

export type HomieOption = {
  id: string;
  label: string;
  /** A second, smaller line (the English under a Marathi label). */
  sublabel?: string;
  kind?: 'primary' | 'secondary';
  /** Choosing it leaves the moment up ("Say it again"). */
  keepOpen?: boolean;
};

export type HomieMoment = {
  id: string;
  /** In the person's language; homie also says it. */
  question: string;
  /** The English, smaller, when `question` isn't English. */
  questionEn?: string;
  /** Big buttons; [] for none. In the centred column, at most one (the no-mic case). */
  options: HomieOption[];
  /** The green "Just say it, I'm listening" bar (the buttons layout only). */
  listening?: { label: string; sublabel?: string };
  /** Five bars that move with the mic level (store `level`), under the question. */
  bars?: boolean;
  /** How to answer out loud, under the bars: "Say “yes” or “no”" (and a smaller line). */
  prompt?: { label: string; sublabel?: string };
  /** A tap anywhere closes it as "not now" (onChoose('not_now')); this small line says so. */
  tapToClose?: string;
  onChoose: (optionId: string) => void;
};

/** What onChoose gets when a moment is dismissed (a tap anywhere, VoiceOver's escape). */
export const MOMENT_DISMISS = 'not_now';

/** Window points: the pot's top-left corner and its diameter. */
export type HomieFrame = { x: number; y: number; size: number };

export type Homie = {
  state: HomieState;
  level: number;
  /** Under the pot while it speaks: "AI voice", "Translated from Grandma". */
  label?: string;
  timer?: { endsAt: number; totalS: number };
  moment: HomieMoment | null;
  hidden: boolean;
  /** Where the pot rests on this screen, instead of its usual corner. */
  dock?: HomieFrame;
  /** A tap on the resting pot does this instead of the screen's help line. */
  onPress?: () => void;
  /** A long press on the resting pot (cook mode: "Ask Grandma anything"), and what it does ("Ask Grandma"). */
  onLongPress?: () => void;
  longPressLabel?: string;
  /** The cook's own voice is playing (her clip, her voice note): the resting pot shrinks a little. */
  shrunk?: boolean;
};

type Timers = { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (id: never) => void };

export const LIT_BEAT_MS = 350;
/** 'speaking' ends on its own after this, in case no say ever played (the overlay ends it sooner). */
export const MAX_SPEAKING_MS = 20_000;
/**
 * A 'lit' set by setHomie (a line on its way) ends on its own after this, in case its audio never
 * comes: lit is half duplex too (lib/homie/logic halfDuplex), so it must never hold the mic for good.
 */
export const MAX_LIT_MS = 12_000;
const LEVEL_STEP = 0.04;

const INITIAL: Homie = { state: 'off', level: 0, moment: null, hidden: false };
const isVoice = (s: HomieState) => s === 'lit' || s === 'speaking';

export function createHomieStore(timers: Timers = globalThis as unknown as Timers) {
  let value: Homie = INITIAL;
  // The screen's own state under a lit / speaking beat.
  let under: HomieState = 'off';
  let beat: unknown = null;
  let watchdog: unknown = null;
  // Which screen's dock / hidden / onPress is applied (useHomieScreen): a screen losing focus after the
  // next one gained it must not clear the next one's.
  let screenOwner: object | null = null;
  const listeners = new Set<() => void>();

  const stop = (t: unknown) => {
    if (t != null) timers.clearTimeout(t as never);
  };

  function set(patch: Partial<Homie>) {
    const keys = Object.keys(patch) as (keyof Homie)[];
    if (keys.every((k) => Object.is(value[k], patch[k]))) return;
    value = { ...value, ...patch };
    for (const l of listeners) l();
  }

  function speakingNow() {
    stop(beat);
    beat = null;
    stop(watchdog);
    watchdog = timers.setTimeout(() => {
      watchdog = null;
      if (value.state === 'speaking') doneSpeaking();
    }, MAX_SPEAKING_MS);
    set({ state: 'speaking' });
  }

  function doneSpeaking() {
    stop(beat);
    stop(watchdog);
    beat = watchdog = null;
    if (isVoice(value.state)) set({ state: under, label: undefined });
  }

  function setHomie(patch: Partial<Homie>) {
    const { state, ...rest } = patch;
    if (state === undefined) return set(rest);
    if (state === 'speaking') {
      if (!isVoice(value.state)) under = value.state;
      set(rest);
      return speakingNow();
    }
    if (state === 'lit') {
      if (!isVoice(value.state)) under = value.state;
      stop(beat);
      beat = null;
      stop(watchdog);
      watchdog = timers.setTimeout(() => {
        watchdog = null;
        if (value.state === 'lit') doneSpeaking();
      }, MAX_LIT_MS);
      return set({ ...rest, state });
    }
    under = state;
    set(isVoice(value.state) ? rest : { ...rest, state });
  }

  function closeMoment(id?: string) {
    if (!value.moment || (id && value.moment.id !== id)) return;
    set({ moment: null });
  }

  return {
    get: () => value,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    setHomie,
    setHomieLevel(level: number) {
      const l = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
      if (Math.abs(l - value.level) < LEVEL_STEP && !(l === 0 && value.level !== 0)) return;
      set({ level: l });
    },
    pulseLit(ms = LIT_BEAT_MS) {
      if (!isVoice(value.state)) under = value.state;
      stop(beat);
      set({ state: 'lit' });
      beat = timers.setTimeout(() => {
        beat = null;
        if (value.state === 'lit') speakingNow();
      }, ms);
    },
    doneSpeaking,
    showMoment(m: HomieMoment) {
      set({ moment: m });
    },
    closeMoment,
    chooseMoment(optionId: string) {
      const m = value.moment;
      const option = m?.options.find((o) => o.id === optionId);
      if (!m || !option) return;
      // Closed first, so onChoose can open the next moment.
      if (!option.keepOpen) closeMoment(m.id);
      try {
        m.onChoose(optionId);
      } catch (e) {
        console.warn('[homie] onChoose', String(e));
      }
    },
    dismissMoment(id?: string) {
      const m = value.moment;
      if (!m || (id && m.id !== id)) return;
      closeMoment(m.id);
      try {
        m.onChoose(MOMENT_DISMISS);
      } catch (e) {
        console.warn('[homie] onChoose', String(e));
      }
    },
    claimScreen(owner: object, patch: Pick<Homie, 'dock' | 'hidden' | 'onPress' | 'onLongPress' | 'longPressLabel'>) {
      screenOwner = owner;
      set(patch);
    },
    releaseScreen(owner: object) {
      if (screenOwner !== owner) return;
      screenOwner = null;
      set({ dock: undefined, hidden: false, onPress: undefined, onLongPress: undefined, longPressLabel: undefined });
    },
  };
}

const store = createHomieStore();

export const getHomie = store.get;
export const {
  setHomie,
  setHomieLevel,
  pulseLit,
  doneSpeaking,
  showMoment,
  closeMoment,
  chooseMoment,
  dismissMoment,
  claimScreen,
  releaseScreen,
} = store;

export function useHomie(): Homie {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/**
 * One part of homie, in a component that shouldn't re-render with every mic level (about 10 a
 * second while someone talks). `select` returns a primitive or one of the store's own objects.
 */
export function useHomieSelect<T>(select: (h: Homie) => T): T {
  const read = () => select(store.get());
  return useSyncExternalStore(store.subscribe, read, read);
}
