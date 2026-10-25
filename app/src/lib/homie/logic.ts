// homie's pure rules (node scripts/test-homie.mjs): what the pot shows, where it rests on each
// screen, which screen's tap line it says (lib/homie/tap; the hello only once: lib/homie/intro), the centred moment's layout
// and listening bars, the timer ring, the mic level, half duplex, and the voice service's https base.
import type { Homie, HomieFrame, HomieMoment, HomieState } from './store';
import { TAP_LINES, tapScreen, type TapScreen } from './tap';

export const HOMIE_REST_SIZE = 56;
export const HOMIE_MOMENT_SIZE = 170;
/** Room the "AI voice" label hangs below the resting pot: put anything under homie this much lower. */
export const HOMIE_LABEL_SPACE = 16;

const GUTTER = 24;
/** Between homie and the screen's own top-right control (the profile face, Share). */
const GAP = 10;
const SAY_PREFIX = 'say:';
const TRANSLATION_PREFIX = 'say:translation:';

export type SayPhase = 'none' | 'loading' | 'playing';

/** An AI say on the shared player (lib/live/say keys), from useNowPlaying()'s key and phase. */
export function sayPhase(key: string | null | undefined, phase: string): SayPhase {
  if (!key?.startsWith(SAY_PREFIX)) return 'none';
  return phase === 'playing' ? 'playing' : phase === 'loading' ? 'loading' : 'none';
}

/** What the pot shows: the store's state, lit while a say loads, speaking while one plays. */
export function potState(h: Pick<Homie, 'state'>, say: SayPhase): HomieState {
  if (h.state === 'lit' || say === 'loading') return 'lit';
  if (say === 'playing') return 'speaking';
  return h.state;
}

/**
 * The label under the pot while it speaks. Never the cook's name alone: it is always the AI. A screen
 * that knows the cook sets the label itself ("Translated from Grandma", lib/live/voice).
 */
export function speakingLabel(h: Pick<Homie, 'label'>, key: string | null | undefined): string {
  if (h.label) return h.label;
  return key?.startsWith(TRANSLATION_PREFIX) ? 'Translated from the cook' : 'AI voice';
}

/**
 * Half duplex (docs/build/STACK.md): while this is true the app itself is making sound, so every mic
 * frame goes to the voice service as zeroed PCM of the same length (the recorder keeps running).
 * True while homie is lit or speaking, while the shared player plays or loads anything (homie's say,
 * the cook's story or voice note), and while a step video plays (the cook's voice).
 */
export function halfDuplex(v: { homie: HomieState; audio: string; video: boolean }): boolean {
  return v.homie === 'lit' || v.homie === 'speaking' || v.audio === 'playing' || v.audio === 'loading' || v.video;
}

export const HELP = {
  /** Cook mode: what the kid can say (a long press on the pot there turns the mic on with it). */
  cook: TAP_LINES.cook,
  /** Before the first tap line homie ever says to this person (lib/homie/intro). */
  hello: 'Hi, I’m homie.',
} as const;

export type HomieRoute = {
  hidden: boolean;
  /** The header homie lines up with: a tab's large title row, or a detail screen's 48 pt buttons. */
  header: 'tab' | 'detail';
  /** Points from the right edge already taken by the screen's own controls (0 = none). */
  reserve: number;
  /** Whose tap line a tap here says (lib/homie/tap). */
  screen: TapScreen;
};

// Sign-in, the launch gateway, invite and share links, the month story (its Close is top-right), and
// chat (the parent's header puts the faces and name at the right).
const HIDDEN = new Set(['/', '/join', '/join-code', '/i', '/r', '/recap', '/_sitemap']);
const KID_FACE_PILL = 76; // ProfileButton faceOnly: 6 + 36 face + 6 + 16 chevron + 12
const BUTTON = 48;

/**
 * ProfileButton with the name ("Mom ▾"): 88 pt of face, chevron and padding, plus the name (DM Sans
 * 700 at 17; 13.5 pt a letter errs wide, "Mom" measures 40), at most 190.
 */
export function namePillWidth(name: string): number {
  return Math.min(190, 88 + Math.ceil(name.length * 13.5));
}

export function homieRoute(pathname: string, profileName = ''): HomieRoute {
  const p = pathname.replace(/\/+$/, '') || '/';
  const tab = /^\/(kid|parent)(\/|$)/.test(p);
  const base: HomieRoute = { hidden: false, header: tab ? 'tab' : 'detail', reserve: 0, screen: tapScreen(p) };
  if (HIDDEN.has(p) || p.startsWith('/chat/')) return { ...base, hidden: true };
  if (p === '/kid/home' || p === '/kid') return { ...base, reserve: GUTTER + KID_FACE_PILL };
  if (p === '/parent/home' || p === '/parent') return { ...base, reserve: GUTTER + namePillWidth(profileName) };
  // A dish: Share and the heart sit at the top right of the photo.
  if (/^\/(recipe|kid\/recipes)\/[^/]+$/.test(p)) return { ...base, header: 'detail', reserve: GUTTER + BUTTON + 12 + BUTTON };
  if (p.startsWith('/my-recipe/')) return { ...base, reserve: GUTTER + BUTTON };
  return base;
}

/** Where the pot rests: centred on the header's 48 pt row, at the right (left of the screen's own control). */
export function restFrame(route: Pick<HomieRoute, 'header' | 'reserve'>, screen: { width: number; insetsTop: number }, size = HOMIE_REST_SIZE): HomieFrame {
  // Header tops: LargeHeader max(60, inset + 13); detail screens useScreenTop max(56, inset + 4).
  const rowTop = route.header === 'tab' ? Math.max(60, screen.insetsTop + 13) : Math.max(56, screen.insetsTop + 4);
  const right = route.reserve ? route.reserve + GAP : GUTTER;
  return { x: screen.width - right - size, y: rowTop + BUTTON / 2 - size / 2, size };
}

/** The pot in a moment: centred, high enough that the question and big buttons fit under it. */
export function momentFrame(screen: { width: number; height: number; insetsTop: number }): HomieFrame {
  const size = Math.round(Math.min(HOMIE_MOMENT_SIZE, screen.height * 0.21));
  return { x: (screen.width - size) / 2, y: Math.max(screen.insetsTop + 24, Math.round(screen.height * 0.14)), size };
}

// ---------------------------------------------------------------------------------------------
// The centred column (homie asks out loud, no buttons; Caleb Oct 24): the same rhythm as Grandma's
// centred screens. The pot (176), 56 pt, the words; the whole group centred between the safe insets.

export const HOMIE_ASK_SIZE = 176;
/** Between the pot and the question (room for the "AI voice" label under the pot). */
export const ASK_POT_GAP = 56;
/** Side padding of the words. */
export const ASK_SIDE = 32;
/** The resting pot's size while the cook's own voice plays (store `shrunk`). */
export const SHRUNK_SCALE = 0.82;

/** Docked low on the screen (cook mode's bottom bar): the words go above the pot, not under it. */
export function labelAbove(frame: HomieFrame, windowH: number): boolean {
  return frame.y + frame.size / 2 > windowH / 2;
}

/** Where the resting pot really is: a little smaller about its centre while the cook's voice plays. */
export function shownFrame(frame: HomieFrame, shrunk: boolean): HomieFrame {
  if (!shrunk) return frame;
  const size = frame.size * SHRUNK_SCALE;
  return { x: frame.x + (frame.size - size) / 2, y: frame.y + (frame.size - size) / 2, size };
}

/** A moment homie asks out loud (bars, a spoken prompt, or a tap anywhere to close) uses the centred column. */
export function isCentredMoment(m: Pick<HomieMoment, 'bars' | 'prompt' | 'tapToClose'>): boolean {
  return !!(m.bars || m.prompt || m.tapToClose);
}

/**
 * The centred column's pot frame and where the words start, from the words' measured height. The
 * pot shrinks on a short phone; a group taller than the screen starts at the top (the words scroll).
 */
export function askFrame(
  screen: { width: number; height: number; insetsTop: number; insetsBottom: number },
  wordsH: number,
): { pot: HomieFrame; wordsTop: number } {
  const size = Math.round(Math.min(HOMIE_ASK_SIZE, screen.height * 0.22));
  const top = screen.insetsTop + 16;
  const bottom = screen.height - Math.max(16, screen.insetsBottom + 8);
  const group = size + ASK_POT_GAP + Math.max(0, wordsH);
  const y = Math.max(top, Math.round(top + (bottom - top - group) / 2));
  return { pot: { x: (screen.width - size) / 2, y, size }, wordsTop: y + size + ASK_POT_GAP };
}

/** The five listening bars' heights (pt) at a mic level 0..1: a low rest shape that grows with the voice. */
const BAR_REST = [10, 16, 22, 16, 10];
const BAR_GROW = [16, 24, 30, 24, 16];
export const BAR_MAX = BAR_REST[2] + BAR_GROW[2];
export function barHeights(level: number): number[] {
  const l = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  return BAR_REST.map((h, i) => Math.round(h + BAR_GROW[i] * l));
}

/** 1 -> 0 as a timer runs out. */
export function timerProgress(timer: { endsAt: number; totalS: number }, now: number): number {
  if (!(timer.totalS > 0)) return 0;
  return Math.max(0, Math.min(1, (timer.endsAt - now) / (timer.totalS * 1000)));
}

/** Loudness of a chunk of 16-bit PCM, 0..1: -50 dBFS (a quiet room) is 0, -10 dBFS (talking close) is 1. */
export function pcmLevel(pcm: ArrayBuffer | Int16Array): number {
  const s = pcm instanceof Int16Array ? pcm : new Int16Array(pcm, 0, Math.floor(pcm.byteLength / 2));
  if (!s.length) return 0;
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s[i] * s[i];
  const rms = Math.sqrt(sum / s.length) / 32768;
  if (rms <= 0) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 50) / 40));
}

/** wss://host/cook -> https://host (ws:// -> http:// for a laptop's test socket). Null if it isn't a URL. */
export function voiceHttpBase(url: string): string | null {
  const m = /^(wss?|https?):\/\/([^/?#\s]+)/i.exec(url.trim());
  if (!m) return null;
  const secure = /^(wss|https)$/i.test(m[1]);
  return `${secure ? 'https' : 'http'}://${m[2]}`;
}

/** expo-speech's language for an Ink-style code (unset = English). */
export function deviceVoiceLanguage(lang?: string | null): string {
  const l = (lang ?? 'en').toLowerCase();
  return ({ en: 'en-US', mr: 'mr-IN', hi: 'hi-IN' } as Record<string, string>)[l] ?? l;
}
