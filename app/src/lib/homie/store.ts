// homie's one store: the pot that rests top-right on every screen (components/homie/HomieOverlay,
// mounted once in app/_layout). Screens say what homie is doing; the overlay draws it.
//
//   setHomie({ state: 'listening' })     the screen's state: off | listening | thinking | timer
//   setHomieLevel(level)                 mic level 0..1 (re-renders only on a visible change)
//   pulseLit()                           the warm beat before homie speaks, then 'speaking'
//   doneSpeaking()                       back to the screen's state (the overlay calls it when a say ends)
//   showMoment({ id, question, options, onChoose })   homie needs you: centre, blur, big buttons
//   chooseMoment(optionId)               closes it (unless the option keepOpen), then onChoose
//   closeMoment(id?)                     reverses it; a stale id leaves a newer moment alone
//   useHomie()                           the current value, in a component
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
  options: HomieOption[];
  /** The green "Just say it, I'm listening" bar. */
  listening?: { label: string; sublabel?: string };
  onChoose: (optionId: string) => void;
};

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
};

type Timers = { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (id: never) => void };

export const LIT_BEAT_MS = 350;
/** 'speaking' ends on its own after this, in case no say ever played (the overlay ends it sooner). */
export const MAX_SPEAKING_MS = 20_000;
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
    claimScreen(owner: object, patch: Pick<Homie, 'dock' | 'hidden' | 'onPress'>) {
      screenOwner = owner;
      set(patch);
    },
    releaseScreen(owner: object) {
      if (screenOwner !== owner) return;
      screenOwner = null;
      set({ dock: undefined, hidden: false, onPress: undefined });
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
  claimScreen,
  releaseScreen,
} = store;

export function useHomie(): Homie {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
