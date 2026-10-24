// homie's pure rules (node scripts/test-homie.mjs): what the pot shows, where it rests on each
// screen, what a tap on it says, the timer ring, the mic level, and the voice service's https base.
import type { Homie, HomieFrame, HomieState } from './store';

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

/** The label under the pot while it speaks. Never the cook's name alone: it is always the AI. */
export function speakingLabel(h: Pick<Homie, 'label'>, key: string | null | undefined): string {
  if (h.label) return h.label;
  return key?.startsWith(TRANSLATION_PREFIX) ? 'Translated · AI voice' : 'AI voice';
}

export const HELP = {
  cook: 'Say next, back, repeat, or ask me anything.',
  recipes: 'Pick a dish and say start.',
  parentHome: 'Tap Record to cook with me.',
  default: 'Hi, I’m homie.',
} as const;

export type HomieRoute = {
  hidden: boolean;
  /** The header homie lines up with: a tab's large title row, or a detail screen's 48 pt buttons. */
  header: 'tab' | 'detail';
  /** Points from the right edge already taken by the screen's own controls (0 = none). */
  reserve: number;
  help: string;
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
  const base: HomieRoute = { hidden: false, header: tab ? 'tab' : 'detail', reserve: 0, help: HELP.default };
  if (HIDDEN.has(p) || p.startsWith('/chat/')) return { ...base, hidden: true };
  if (p.startsWith('/cook/')) return { ...base, help: HELP.cook };
  if (p === '/kid/recipes' || p === '/parent/recipes') return { ...base, help: HELP.recipes };
  if (p === '/kid/home' || p === '/kid') return { ...base, reserve: GUTTER + KID_FACE_PILL };
  if (p === '/parent/home' || p === '/parent') return { ...base, reserve: GUTTER + namePillWidth(profileName), help: HELP.parentHome };
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
