// Cook mode's voice rules, pure (node scripts/test-voice-ui.mjs): what each `say` from the voice service
// means for homie (docs/build/STACK.md "kid cooking additions"), which `say_end` and transcript belong
// to what, when voice starts on its own, when the phone reads aloud itself, app-only moments and the
// read-aloud offer's end, the kid's spoken yes or no, when homie is 'thinking', the kitchen timers the
// app counts down, what the pot shows, when homie's mic is on (a tap, or the 8 s after a step line) and
// what a tap does, which of the cook's answers to offer the kid, and what keeps Cartesia from billing
// for audio nobody said (which mic frames go out, the app in the background).
import type { HomieMoment, HomieState } from '@/lib/homie/store';

export type SayKind = 'step' | 'reply' | 'hint' | 'translation' | 'nudge' | 'offer' | 'greeting' | 'timer';
const KINDS: ReadonlySet<string> = new Set<SayKind>(['step', 'reply', 'hint', 'translation', 'nudge', 'offer', 'greeting', 'timer']);

/** An older service (Track B) sends no kind; it marks a translation with `translation: true`. */
export function sayKind(m: { kind?: unknown; translation?: unknown }): SayKind {
  if (typeof m.kind === 'string' && KINDS.has(m.kind)) return m.kind as SayKind;
  return m.translation ? 'translation' : 'reply';
}

export type OfferKind = 'read' | 'story';

/** homie asking for a tap: read the steps out loud, or hear the cook's story about this step. */
export function offerOf(kind: SayKind, text: string): OfferKind | null {
  if (kind === 'offer') return 'read';
  if (kind === 'nudge' && /\bstor(y|ies)\b/i.test(text)) return 'story';
  return null;
}

/**
 * A line homie says on its own (not an answer to the kid): it waits while a video plays (Caleb, Oct 24:
 * homie never talks over a video). The service holds these too; this catches one already on its way.
 */
export function waitsForVideo(kind: SayKind): boolean {
  return kind === 'greeting' || kind === 'nudge' || kind === 'timer';
}

/**
 * What /cook gets for a step the screen moved to. `read: false` for one her clip moved it to: the
 * service moves silently, so it never reads that step's line over her, and her translation still comes.
 */
export function stepMessage(stepOrder: number, read = true): { type: 'step'; stepOrder: number; read?: false } {
  return read ? { type: 'step', stepOrder } : { type: 'step', stepOrder, read: false };
}

/** What /cook gets when a video (or the cook's own voice) starts or stops on the phone. */
export function videoMessage(playing: boolean): { type: 'video'; playing: boolean } {
  return { type: 'video', playing };
}

/** The label under the pot while a say plays; undefined is the overlay's own "AI voice". */
export function sayLabel(kind: SayKind, cookName: string): string | undefined {
  if (kind === 'translation') return `Translated from ${cookName}`;
  if (kind === 'hint') return 'AI hint';
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// The line to the service

/**
 * A `say_end` arrived; `open` lines had started without one. The service cuts a line off when it
 * starts the next one (or a clip), and that line's end arrives after the next one's `say`: an end
 * while a newer line is still open is the old line's (`stale`), never the current one's.
 */
export function endSay(open: number): { open: number; stale: boolean } {
  const left = Math.max(0, open - 1);
  return { open: left, stale: left > 0 };
}

/** A text the phone sent ({ type: "text" }), waiting for the service's echo. */
export type SentText = { key: string; at: number };
/** An echo comes back at once; one this late isn't (the service dropped that text). */
const ECHO_MAX_MS = 5000;

export const sentText = (text: string, at: number): SentText => ({ key: text.trim().toLowerCase(), at });

/**
 * The service repeats every { type: "text" } at once as a finished transcript. Where that echo is in
 * what this phone sent (-1: the kid really said it).
 */
export function echoAt(sent: readonly SentText[], text: string, now: number): number {
  const key = text.trim().toLowerCase();
  return sent.findIndex((s) => s.key === key && now - s.at <= ECHO_MAX_MS);
}

/**
 * The "Let Mom see" sheet is out of the way: it isn't up, and it won't come (its question needs the
 * server's answer first: `consent` stays 'unknown' until then). Voice starts, and homie asks, only
 * then (one thing asks at a time).
 */
export function consentSettled(v: { askConsent: boolean; liveOn: boolean; consent: string; startFailed: boolean }): boolean {
  return !v.askConsent && (!v.liveOn || v.consent !== 'unknown' || v.startFailed);
}

/**
 * "Leo is cooking" (lib/useCookingSession) is on for this visit: the same test as that hook's own
 * `on`. Off (a memorial cook, the web dev aid, no dish yet) there is no "Let Mom see" answer to wait
 * for, so it is consentSettled's `liveOn`.
 */
export function cookingSessionOn(v: { enabled: boolean; cookId?: string | null; memorial?: boolean | null; recipeId?: string | null; total: number }): boolean {
  return v.enabled && !!v.cookId && !v.memorial && !!v.recipeId && v.total >= 1;
}

/**
 * No voice line reads for the kid (Expo Go, web, no voice service, or the line gave up or failed):
 * the phone itself offers "read it out loud?" and reads each step in homie's voice.
 */
export function phoneReads(v: { voiceHere: boolean; live: boolean; unavailable: boolean }): boolean {
  return !v.live && (!v.voiceHere || v.unavailable);
}

// ---------------------------------------------------------------------------------------------
// App-only moments and the service's read-aloud offer (the shared contract with the voice service)

/** A moment the app opened on its own (not the service's offer or story nudge). */
export type AppMomentKind = 'answer' | 'story' | 'ask' | 'help';

/**
 * Which app-only moment this is, from the id cook mode gave it (components/cooking/CookMoments):
 * "<cook> answered your question" and "Ask <cook> anything". The read-aloud offer and the story
 * nudge are the service's own offers (its yes plays them), so they never count.
 */
export function appMomentKind(id: string | null | undefined): AppMomentKind | null {
  if (!id) return null;
  if (id.startsWith('answer:')) return 'answer';
  if (id.startsWith('ask:')) return 'ask';
  return null;
}

/**
 * What /cook gets when an app-only moment opens or closes: while one is open, the service still
 * streams transcripts, but a "yes" / "no" / "sure" is the moment's, not an answer to its own offer.
 */
export function momentMessage(kind: AppMomentKind | null): { type: 'moment'; open: true; kind: AppMomentKind } | { type: 'moment'; open: false } {
  return kind ? { type: 'moment', open: true, kind } : { type: 'moment', open: false };
}

/** The service's { type: "offer_closed", accepted }: the read-aloud offer is over (true: it reads). */
export function offerClosed(m: { accepted?: unknown }): boolean {
  return m.accepted === true;
}

/**
 * The read-aloud choice to keep after the service's offer_closed, or null when the phone already has
 * that answer. The service's answer wins when it differs: it heard the kid after the phone moved on.
 */
export function readAfterOfferClosed(current: 'yes' | 'no' | null, accepted: boolean): 'yes' | 'no' | null {
  const c = accepted ? 'yes' : 'no';
  return current === c ? null : c;
}

/**
 * The { type: "text" } that declines the service's read-aloud offer for this visit: sent for a tap
 * anywhere on the offer, or a "no" this phone remembers. Steps then change silently.
 */
export const DECLINE_TEXT = 'no';

// The kid's spoken yes or no, for homie's offers and the app's own moments: a copy of the service's
// voice/src/yesNo.ts (#47), same rules, so the phone and homie agree (test-voice-ui checks the two
// against each other). A yes word is a yes whatever follows ("Sure, read it."); okay, alright and
// please only without a command or a question after them. A no counts whatever follows ("No, not
// right now.", "Don't.") and wins ("Okay, no."). "Not yet", "later", "skip it" and "I'm good" count
// only alone; "no problem", "no idea" and "oh no, I burned it" are neither.
const FILLERS = /^((um|uh|oh|ah|hmm|mm|well|wait|so|hey|and|now|but) )+/;
const OH_NO = /^((um|uh|ah|hmm|mm|well|wait|so|hey|and|now|but) )*oh no\b/;
/** Yes words, okays and fillers before the rest of the reply ("okay um yes but"). */
const LEAD = /^((yes|yeah|yep|yup|sure|of course(?! not\b)|ok|okay|alright|all right|please|um|uh|oh|ah|hmm|mm|well|so|hey|and|now|but)( |$))+/;
const SAID_YES = /\b(yes|yeah|yep|yup|sure|of course)\b/;
const SAID_OK = /\b(ok|okay|alright|all right|please)\b/;
const YES = /^(go ahead|do it|play it|read it|let'?s hear it|can do|will do)\b/;
/** A no keeps the "no" of "no need", "no point" and "no reason", so NO_FILLER sees "no need to read it". */
const NO = /^(?=no (need|point|reason)\b)|^(no( no(?! (need|point|reason)\b))*(?! (problem|worries|idea|clue|one|doubt|matter|wonder)\b)|nah|nope|not now|not right now|of course not|don'?t(?= (bother|worry|read|play|do|want|need)\b|$))( |$)/;
const WHOLE_NO = /^(not yet|not really|later|maybe later|maybe not|skip it|i'?m good)$/;
/** One of the no's own words, before a command or a filler: "no thanks, next step", "nah, no need, next step". */
const NO_WORD = /^(no (need|point|reason)|no|nah|nope|not now|not right now|thanks|thank you|but|just|um|uh|so|well|then|ok|okay)( |$)/;
/** A command or a question (what the service's fast commands, timers and Claude are for). */
const COMMAND = /^(next|done|go on|go back|back|previous|last step|step back|repeat|again|say that|one more time|what|how|when|where|why|who|which|can|could|should|would|will|is|are|am i|do i|do you|do we|does|did|set|start|stop|pause|wait|hold on|hang on|help)\b|\btimer\b/;
/** What a no can trail and still be only the no: "No, I'm good for now.", "Nah, no need for that.", "No, I got it." */
const NO_FILLER = new RegExp(
  '^(' +
    [
      "i'?m (all right|(all )?(good|fine|okay|ok|alright|set))( (on|with) (that|it|this))?",
      "(that'?s|it'?s) (fine|okay|ok|alright|all right)",
      "all good|never ?mind|i'?d rather not|skip( it| that)?",
      "(there'?s )?no (need|point|reason)( to( (read|play|do)( it| that| them)?( out loud)?)?| for (it|that))?",
      "i('?ve)? got (it|this)|i can do (it|this)|you don'?t (have|need) to",
      '(maybe )?(not|later|next time|another time)|not (yet|really|today|this time)',
      "don'?t( (bother|worry|read|play|do|want|need)( it| that| about it| to)?( out loud)?)?",
      "i don'?t (want|need) (it|that|this|one|any|to|to hear it)",
    ].join('|') +
    ')( (for now|right now|today|though|anyway|really|thanks( so much)?|thank you( so much)?))*$',
);

function parseYesNo(text: string) {
  const all = text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/( (please|thanks|thank you))+$/, '');
  const reply = all.replace(FILLERS, '');
  const lead = reply.match(LEAD)?.[0] ?? '';
  const rest = reply.slice(lead.length);
  const no = NO.exec(rest);
  const tail = no ? rest.slice(no[0].length) : '';
  // "Oh no" is a no only when a no follows it, or nothing does.
  const isNo = no ? !OH_NO.test(all) || !tail || NO.test(tail) || WHOLE_NO.test(tail) : WHOLE_NO.test(rest);
  return { lead, rest, isNo, tail };
}

/** The kid's answer to homie's yes-or-no question, out loud; null for anything else ("next", a question). */
export function yesNo(text: string): 'yes' | 'no' | null {
  const { lead, rest, isNo } = parseYesNo(text);
  if (isNo) return 'no';
  if (SAID_YES.test(lead) || YES.test(rest)) return 'yes';
  if (!SAID_OK.test(lead)) return null;
  return rest && (COMMAND.test(rest) || /\?\s*$/.test(text)) ? null : 'yes';
}

/**
 * What's left after a spoken no. `more`: the kid said more than the no ("No, I'm out of ginger.", but
 * not "No thanks, I'm good for now."); the service then gives Claude the whole sentence. `fastTail`:
 * the rest without the no's own words ("No thanks, next step." → "next step"), for a plain command.
 */
export function afterNo(text: string): { more: boolean; fastTail: string } {
  const { isNo, tail } = parseYesNo(text);
  // Peel off the no's own words ("thanks", "no need", "but") until what's left is nothing, a filler, or the rest.
  let rest = isNo ? tail : '';
  let word: RegExpExecArray | null;
  while (rest && !NO_FILLER.test(rest) && (word = NO_WORD.exec(rest))) rest = rest.slice(word[0].length);
  const more = !!rest && !NO_FILLER.test(rest);
  return { more, fastTail: more ? rest : '' };
}

/**
 * The kid's finished words: does homie start 'thinking'? Only when the service will answer (its
 * voice/src/cook.ts heard() and turn()). Never for the echo of this phone's own text (a chip's, or the
 * "no" for a tap on the offer). While an app-only moment is up, the service holds a yes, or a no with
 * nothing more, for the phone; what follows a no is still its own ("No, I'm out of ginger. Can I skip
 * it?"). While its own offer is up (the read-aloud offer, a story), a no with nothing more closes it
 * and nothing is said.
 */
export function thinksAfter(v: { echo: boolean; appMoment: boolean; momentUp: boolean; text: string }): boolean {
  if (v.echo) return false;
  const yn = yesNo(v.text);
  const onlyNo = yn === 'no' && !afterNo(v.text).more;
  if (v.appMoment) return yn !== 'yes' && !onlyNo;
  return !(v.momentUp && onlyNo);
}

/** Messages that are homie doing something (an answer to the kid). */
export const HOMIE_ACTIONS: ReadonlySet<string> = new Set(['go_to_step', 'play_clip', 'asked_cook', 'timer', 'timer_done']);

/**
 * 'thinking' ends with homie's answer: an action, a line, the offer closing (a no gets no line), or the
 * service's `quiet` (the words weren't for homie, so it says nothing).
 */
export function endsThinking(type: string): boolean {
  return HOMIE_ACTIONS.has(type) || type === 'say' || type === 'offer_closed' || type === 'quiet';
}

export const SAY_YES_NO = 'Say “yes” or “no”';
export const TAP_TO_CLOSE = 'Tap anywhere to close';

/**
 * homie's yes-or-no question as a moment (Caleb, Oct 24): no buttons, the listening bars and "Say
 * “yes” or “no”"; a tap anywhere closes it ("not now", only for this visit). A phone that can't hear
 * the answer (no mic, mic off) gets one button for yes instead. onChoose gets 'yes' (the button) or
 * 'not_now' (a tap anywhere).
 */
export function yesNoMoment(m: { id: string; question: string; questionEn?: string; hearing: boolean; button: string; onChoose: (choice: string) => void }): HomieMoment {
  const base = { id: m.id, question: m.question, questionEn: m.questionEn, tapToClose: TAP_TO_CLOSE, onChoose: m.onChoose };
  return m.hearing ? { ...base, options: [], bars: true, prompt: { label: SAY_YES_NO } } : { ...base, options: [{ id: 'yes', label: m.button, kind: 'primary' }] };
}

/**
 * What the pot shows on the cook screen, under homie's own lit / speaking beat (the store puts those on
 * top). True to the mic both ways: `listening` only while homie is on, the recorder runs and its frames
 * really go out; while the app makes sound (`sounding`: homie, her voice, a video) lib/live/mic zeroes
 * every frame and cook mode sends none, so the pot shows off (or the timer) then, never a listening it
 * isn't doing. `thinking` (the kid's words went out, the answer is on its way) stays true through that.
 * So the mic never streams unless the pot shows listening or thinking. The ring follows store.timer.
 */
export function cookPotState(v: { active: boolean; listening: boolean; sounding: boolean; thinking: boolean; timers: number; timerDue: boolean }): HomieState {
  if (v.active && v.listening && v.thinking) return 'thinking';
  if (v.active && v.listening && !v.sounding) return 'listening';
  return v.timers || v.timerDue ? 'timer' : 'off';
}

// ---------------------------------------------------------------------------------------------
// homie on or off (Caleb, Oct 24: one tap turns it on, the next turns it off; no always-on mic)

/**
 * Why cook mode's mic is on: the kid's tap ('tap', until the next tap or a minute with nobody talking),
 * the 8 s after a step line ('window'), or a turn the kid began in that window ('turn', until homie's
 * answer is over). 'off': the recorder is stopped, so no frames and no Ink credits; the line stays open
 * for step lines.
 */
export type MicHold = 'off' | 'tap' | 'window' | 'turn';
export type MicEvent = 'tap' | 'step_line_end' | 'window_timeout' | 'heard' | 'answered' | 'cap' | 'idle';

/** How long the mic listens after a step line (only the time it really hears counts: no app sound). */
export const LISTEN_WINDOW_MS = 8000;
/** After homie's answer, a beat for the line that follows an action ("next step": the step, then its line). */
export const ANSWER_GRACE_MS = 1000;
/** The kid stopped talking (no partial transcript for this long) even if Ink's turn end never came. */
export const KID_QUIET_MS = 6000;
/** A window and any turn begun in it end this long after the window opened, whatever is still talking (a TV). */
export const TURN_MAX_MS = 20_000;
/** homie on by a tap goes off after this long with no word from the kid and nothing playing. */
export const TAP_IDLE_MS = 60_000;
/** A partial transcript this short ("um", a TV's stray word) never starts or holds a turn. */
export const MIN_TURN_WORDS = 2;
/**
 * The mic level (lib/homie/logic pcmLevel: -50 dBFS is 0, -10 dBFS is 1) above which a frame is the kid
 * talking: about -32 dBFS, a little under the walkie's -28 (components/record/walkieLogic) because the
 * kid may be across the counter.
 */
export const SPEECH_LEVEL = 0.45;
/** The kid is mid-sentence while the mic was that loud this recently. */
export const SPEECH_TAIL_MS = 800;
/** A window's end waits at most this much longer for a sentence to finish. */
export const EDGE_MAX_MS = 3000;
/** How often the wait re-checks while Ink's words are still coming (a partial with no final yet). */
const EDGE_STEP_MS = 400;
/**
 * Ink's words are still coming this long after its last partial with no final since: its turn ends
 * about 2 s after the kid stops (voice/src/ink.ts turn_end_timeout_ms). A stray word that never gets a
 * final stops counting then.
 */
export const WORDS_OPEN_MS = 2500;

/** A partial transcript that counts as the kid talking to homie (MIN_TURN_WORDS or more). */
export function turnWords(text: string): boolean {
  return text.trim().split(/\s+/).filter(Boolean).length >= MIN_TURN_WORDS;
}

/**
 * The window's 8 s are up: how much longer to keep listening (0: close now). The kid is mid-sentence
 * when the mic was loud in the last SPEECH_TAIL_MS (`loudAgo`), or Ink's words are still coming (its
 * last partial `wordsAgo` ms ago, no final since; Infinity for none): Ink then gets the end of the
 * sentence and can end its turn. `extended`: how long it already waited, EDGE_MAX_MS in all.
 */
export function edgeWait(v: { loudAgo: number; wordsAgo: number; extended: number }): number {
  const left = EDGE_MAX_MS - v.extended;
  if (left <= 0) return 0;
  if (v.loudAgo < SPEECH_TAIL_MS) return Math.min(left, SPEECH_TAIL_MS - v.loudAgo);
  return v.wordsAgo < WORDS_OPEN_MS ? Math.min(left, EDGE_STEP_MS) : 0;
}

/**
 * homie's lines that leave the kid something to answer open the listening window when they end: a step's
 * line ("next", a question), and a nudge ("Still on step 3?", "Grandma has a story … want to hear it?").
 */
export function opensWindow(kind: SayKind): boolean {
  return kind === 'step' || kind === 'nudge';
}

/**
 * The next hold. A tap toggles what the kid sees: off turns homie on until the next tap, and any other
 * hold (a pot that listens or thinks, by a tap or a window) turns it off. A step line's end opens a
 * fresh window, unless the kid's tap holds homie on. The kid's words in a window hold it for the turn;
 * the window's 8 s, the turn's answer, or the cap close it; a tapped-on homie left idle goes off.
 */
export function micAfter(hold: MicHold, e: MicEvent): MicHold {
  if (e === 'tap') return hold === 'off' ? 'tap' : 'off';
  if (e === 'step_line_end') return hold === 'tap' ? 'tap' : 'window';
  if (e === 'heard') return hold === 'window' ? 'turn' : hold;
  if (e === 'window_timeout') return hold === 'window' ? 'off' : hold;
  if (e === 'answered') return hold === 'turn' ? 'off' : hold;
  if (e === 'cap') return hold === 'window' || hold === 'turn' ? 'off' : hold;
  return hold === 'tap' ? 'off' : hold;
}

/** What the mic's timers look at (lib/live/voice keeps it). */
export type MicNow = {
  hold: MicHold;
  /** The recorder really runs. */
  listening: boolean;
  /** The app makes sound (homie, her voice, a video): every frame is zeroed, nothing reaches Ink. */
  sounding: boolean;
  /** The kid's words went out and the answer is on its way. */
  thinking: boolean;
  /** homie's own line (lit or speaking). */
  talking: boolean;
  /** The kid is mid-sentence: partials of MIN_TURN_WORDS or more, no final yet. */
  kidTalking: boolean;
  /** This window's first finished words came (later words, a TV's, never hold the turn). */
  heardFinal: boolean;
  /** Since the window opened (ms). */
  openFor: number;
};

/**
 * The timer homie's mic waits on now, or null.
 * - A window closes after LISTEN_WINDOW_MS of really hearing (no app sound, nobody mid-sentence).
 * - A turn closes ANSWER_GRACE_MS after its answer is over: nothing on its way, homie quiet, and the kid
 *   done talking, unless the first finished words already came (then more talking doesn't hold it).
 * - Either ends TURN_MAX_MS after the window opened, whatever else.
 * - On by a tap: TAP_IDLE_MS with the mic hearing and nobody talking or answering turns it off.
 */
export function micTimer(v: MicNow): { ms: number; event: MicEvent } | null {
  if (v.hold === 'tap') return v.listening && !v.sounding && !v.thinking && !v.kidTalking ? { ms: TAP_IDLE_MS, event: 'idle' } : null;
  if (v.hold !== 'window' && v.hold !== 'turn') return null;
  const cap = { ms: Math.max(0, TURN_MAX_MS - v.openFor), event: 'cap' as const };
  const hears = v.hold === 'window' && v.listening && !v.sounding && !v.kidTalking;
  const answered = v.hold === 'turn' && !v.thinking && !v.talking && (v.heardFinal || !v.kidTalking);
  const t = hears ? { ms: LISTEN_WINDOW_MS, event: 'window_timeout' as const } : answered ? { ms: ANSWER_GRACE_MS, event: 'answered' as const } : null;
  return t && t.ms <= cap.ms ? t : cap;
}

/**
 * The recorder runs only while homie is on, the line is open, this screen is on top, the mic hasn't
 * been refused (`muted`: a tap tries again), and no video plays. A video's frames are zeroed anyway
 * (half duplex), and a running recorder holds iOS in its voice-chat mode, which turns the video's sound
 * right down (Caleb, Oct 25: "when i click into the video after homie stops talking, it'll be muted").
 * The recorder stops for it (lib/live/mic then hands the session back to playback) and starts again after.
 */
export function micWanted(v: { hold: MicHold; open: boolean; focused: boolean; muted: boolean; video: boolean }): boolean {
  return v.hold !== 'off' && v.open && v.focused && !v.muted && !v.video;
}

/**
 * The kid can answer homie's yes-or-no out loud for as long as it's up: homie is on by a tap and the
 * mic streams. A step line's window may close first, so a moment then gets its one button instead.
 */
export function hearsAnswers(v: { live: boolean; hold: MicHold; listening: boolean }): boolean {
  return v.live && v.hold === 'tap' && v.listening;
}

/**
 * A tap on homie in cook mode never navigates. With a voice line (open, opening, one that failed and
 * says "Tap homie to try again", or one this build can start), it turns homie on or off ('toggle').
 * With none (Expo Go, web, no service, a dish the service can't cook), it reads the step aloud
 * ('read'), and a tap while homie talks stops it ('stop').
 */
export function cookTap(v: { voiceHere: boolean; status: 'off' | 'connecting' | 'listening' | 'error'; unavailable: boolean; talking: boolean }): 'toggle' | 'read' | 'stop' {
  if (v.status !== 'off' || (v.voiceHere && !v.unavailable)) return 'toggle';
  return v.talking ? 'stop' : 'read';
}

// ---------------------------------------------------------------------------------------------
// Timers

export type CookTimer = { id: string; label: string; endsAt: number; totalS: number };
const MAX_TIMER_S = 24 * 3600;

/**
 * A timer's id on this phone: the service's id on that socket (`socket`, counted up on each open). The
 * service starts its ids again at "timer-1" on every socket, and a pause and resume opens a new one.
 */
export function socketTimerId(socket: number, id: unknown): string {
  return `${socket}/${String(id)}`;
}

/**
 * A `timer` message from socket `socket` as this phone's countdown: it ends `seconds` from now on our
 * clock (the service's `endsAt` is on its clock). Null when it is malformed.
 */
export function parseTimer(m: { id?: unknown; seconds?: unknown; label?: unknown }, now: number, socket: number): CookTimer | null {
  const seconds = Number(m.seconds);
  if (typeof m.id !== 'string' || !m.id || !Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_TIMER_S) return null;
  const label = typeof m.label === 'string' && m.label.trim() ? m.label.trim() : 'timer';
  return { id: socketTimerId(socket, m.id), label, endsAt: now + Math.round(seconds * 1000), totalS: seconds };
}

/**
 * Soonest first; a timer with the same id replaces the old one. A timer from an older socket stays: it
 * counts down and buzzes here, and leaves on its own, since that socket's `timer_done` can't come.
 */
export function withTimer(list: readonly CookTimer[], t: CookTimer): CookTimer[] {
  return [...list.filter((x) => x.id !== t.id), t].sort((a, b) => a.endsAt - b.endsAt);
}

/** `timer_done` from socket `socket`: only that socket's timer leaves. */
export function withoutTimer(list: readonly CookTimer[], socket: number, id: unknown): CookTimer[] {
  const gone = socketTimerId(socket, id);
  return list.filter((x) => x.id !== gone);
}

/**
 * The service's `timer_done` from socket `socket`. It usually comes before this phone's own zero (same
 * clock, a little latency), so a timer that hasn't buzzed here buzzes now (`buzz`: its id): it stays,
 * at zero ("Done"), and leaves a little later like any buzzed timer. One that already buzzed here
 * leaves now (`buzz` null), and so does nothing for an id this phone doesn't have.
 */
export function timerDone(list: readonly CookTimer[], buzzed: ReadonlySet<string>, socket: number, id: unknown, now: number): { list: CookTimer[]; buzz: string | null } {
  const done = socketTimerId(socket, id);
  const t = list.find((x) => x.id === done);
  if (!t || buzzed.has(done)) return { list: withoutTimer(list, socket, id), buzz: null };
  return { list: withTimer(list, { ...t, endsAt: Math.min(t.endsAt, now) }), buzz: done };
}

/**
 * Timers reaching zero on this phone (or buzzed by an early timer_done), each buzzing once. `buzzed`:
 * the ids that already buzzed here; the ones whose timer left the list drop out (`kept`). `next`: the
 * soonest timer still to buzz (null: none). `due`: a timer that buzzed is still on screen ("Done": the
 * pot's timer state).
 */
export function timerBuzz(list: readonly CookTimer[], buzzed: ReadonlySet<string>): { next: CookTimer | null; kept: Set<string>; due: boolean } {
  const kept = new Set(list.filter((t) => buzzed.has(t.id)).map((t) => t.id));
  return { next: list.find((t) => !kept.has(t.id)) ?? null, kept, due: kept.size > 0 };
}

/** Whole seconds left, rounded up: 0 only once it is done. */
export function secondsLeft(t: Pick<CookTimer, 'endsAt'>, now: number): number {
  return Math.max(0, Math.ceil((t.endsAt - now) / 1000));
}

/** "4:32", "12:00", "1:05:00". */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** "Rice timer, 4 minutes 32 seconds left" / "Rice timer is done". */
export function timerA11y(t: Pick<CookTimer, 'label' | 'endsAt'>, now: number): string {
  const name = t.label === 'timer' ? 'Timer' : `${t.label[0].toUpperCase()}${t.label.slice(1)} timer`;
  const left = secondsLeft(t, now);
  if (!left) return `${name} is done`;
  const part = (n: number, unit: string) => (n ? `${n} ${unit}${n === 1 ? '' : 's'}` : '');
  const words = [part(Math.floor(left / 3600), 'hour'), part(Math.floor((left % 3600) / 60), 'minute'), part(left % 60, 'second')].filter(Boolean).join(' ');
  return `${name}, ${words} left`;
}

// ---------------------------------------------------------------------------------------------
// The cook's answers (Convex questions.forRecipe rows)

export type AnswerRow = {
  _id: string;
  _creationTime: number;
  status: string;
  text: string;
  askedByName?: string;
  answerAudioUrl?: string | null;
};

/**
 * The cook's voice answers to my questions about this dish that I haven't heard, newest first. Mine =
 * asked under my name, or sent to the cook from this cook mode (`mine`). Only questions asked after
 * `since`, so an old answer doesn't pop up forever.
 */
export function answersToHear<T extends AnswerRow>(
  rows: readonly T[],
  o: { myName?: string | null; mine?: ReadonlySet<string>; heard: ReadonlySet<string>; skipped?: ReadonlySet<string>; since: number },
): T[] {
  const name = o.myName?.trim().toLowerCase();
  return rows
    .filter((r) => r.status === 'answered' && !!r.answerAudioUrl && r._creationTime >= o.since)
    .filter((r) => o.mine?.has(r._id) || (!!name && r.askedByName?.trim().toLowerCase() === name))
    .filter((r) => !o.heard.has(r._id) && !o.skipped?.has(r._id))
    .sort((a, b) => b._creationTime - a._creationTime);
}

// ---------------------------------------------------------------------------------------------
// Half duplex and Cartesia credits (Ink 2 bills every second of audio it gets, silence too)

/**
 * A mic frame goes to /cook only when it is the kid's (Cartesia credit fix A) and homie is on
 * (`active`: a frame still arriving after the recorder was told to stop is dropped): never one
 * lib/live/mic zeroed because the app makes sound (`quiet`), nor one while another screen is on top.
 * Nothing is sent instead; the service's own half duplex (voice/src/cook.ts hearing) is the backup.
 */
export function cookSendsFrame(v: { quiet: boolean; focused: boolean; active: boolean }): boolean {
  return v.active && !v.quiet && v.focused;
}

/**
 * The app is on screen (React Native AppState): anything but the background. iOS 'inactive' (Control
 * Center, the notification shade, a call banner, the mic's permission prompt) leaves it on screen.
 */
export function appInForeground(state: string | null | undefined): boolean {
  return state !== 'background';
}

/**
 * What cook mode's voice line does when the app's state changes (Cartesia credit fix B). In the
 * background, a line that was on (`lineOn`) closes ('pause'), so nothing streams. Back on top
 * ('active') after a pause: it opens again ('resume'; the mic only if the kid hadn't turned it off).
 * iOS 'inactive' is never a pause: the app is still on screen, and closing the line there would only
 * churn sockets. So the mic's own permission prompt (also 'inactive') never pauses it either; going
 * home meanwhile does.
 */
export function appStateStep(v: { next: string; lineOn: boolean; paused: boolean }): 'pause' | 'resume' | null {
  if (v.next === 'active') return v.paused ? 'resume' : null;
  if (v.next !== 'background') return null;
  return v.lineOn && !v.paused ? 'pause' : null;
}

/**
 * One /cook socket at a time. Each hang-up (a pause, the kid, leaving the screen) starts a new line
 * (`line` + 1). A retry a dropped socket scheduled, or a connect still waiting for its Convex session,
 * belongs to the line it began on (`began`): it opens a socket only while that line is still the one
 * wanted and has none yet. So a pause and a resume inside a retry's wait never leave two sockets open.
 */
export function lineMayOpen(v: { want: boolean; line: number; began: number; open: boolean }): boolean {
  return v.want && v.line === v.began && !v.open;
}

const silences = new Map<number, ArrayBuffer>();

/** Zeros the size of a mic chunk: what lib/live/mic hands on instead of the mic while the app plays sound. */
export function silence(bytes: number): ArrayBuffer {
  let s = silences.get(bytes);
  if (!s) {
    s = new ArrayBuffer(bytes);
    silences.set(bytes, s);
  }
  return s;
}
