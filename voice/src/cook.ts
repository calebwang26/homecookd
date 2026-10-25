// One kid cooking one recipe: a WebSocket from the app, an Ink stream for their voice, Claude for
// what they want, Sonic (homie's voice) for what we say. Messages are the "App ↔ voice service" contract
// in STACK.md, with the Oct 24 kid-side additions: every `say` has a `kind`; after `ready`, homie greets in
// the cook's language and offers to read the recipe out loud, and until the kid says yes, steps change
// silently (a no keeps them silent for the visit); timers; labelled hints; and two nudges (a step with a
// story, a long quiet on one step). While the app has one of its own homie moments up, the kid's yes or no
// is that moment's answer, never ours. While any video plays on the phone (the app's { type: "video" }, or a
// clip we played), homie says nothing on its own: the greeting, an offer, a nudge or a timer waits for the
// next pause (Caleb, Oct 24). Only an answer to what the kid just said is spoken meanwhile. The read-aloud
// offer is off by default (VOICE_READ_OFFER=1 brings it back): steps are read once the kid asks. Claude decides
// whether the kid was talking to homie at all (agent.ts); a turn that ends with nothing done or said sends
// { type: "quiet" }, so the phone stops showing homie thinking.
import WebSocket from "ws";
import { TurnAgent, type Actions } from "./agent.js";
import * as convex from "./convex.js";
import { env } from "./env.js";
import { findMoments, warm } from "./moss.js";
import { SONIC_SAMPLE_RATE, type AudioFormat } from "./sonic.js";
import { listenInk, speak } from "./speech.js";
import type { Stt, SttEvents } from "./stt.js";
import { translateQuote } from "./translate.js";
import { afterNo, yesNo } from "./yesNo.js";

type SayKind = "step" | "reply" | "hint" | "translation" | "nudge" | "offer" | "greeting" | "timer";
/** Lines homie says on its own, not in answer to the kid: these wait while a video plays. */
const UNPROMPTED: ReadonlySet<SayKind> = new Set(["greeting", "offer", "nudge", "timer"]);

/** What a cooking session talks to. Tests pass fakes. */
export type CookingDeps = {
  convex: Pick<typeof convex, "startSession" | "setStep" | "logQuestion">;
  /** The kid's speech to text (Ink 2). */
  listen: (events: SttEvents, keyterms: string[]) => Stt;
  speak: typeof speak;
  agent: (session: convex.CookSession, actions: Actions) => Pick<TurnAgent, "turn">;
  findMoments: typeof findMoments;
  warm: typeof warm;
  translateQuote: typeof translateQuote;
};

const LIVE: CookingDeps = {
  convex,
  listen: listenInk,
  speak,
  agent: (session, actions) => new TurnAgent(session, actions),
  findMoments,
  warm,
  translateQuote,
};

// Plain commands skip Claude: they're most of what a kid says, and this saves a model call.
const FAST: [RegExp, "next" | "previous" | "repeat"][] = [
  [/^(next|next step|next one|what'?s next|done|go on)$/, "next"],
  [/^(go back|back|previous|previous step|last step|step back)$/, "previous"],
  [/^(repeat|repeat that|again|say that again|one more time|what)$/, "repeat"],
];
const normalize = (t: string) => t.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
/** How long a spoken piece with no end punctuation waits for the rest of the sentence (Ink's next turn.end). */
const HOLD_MS = 1200;
/** "Um, wait, go back please" → "go back". */
const command = (t: string) =>
  normalize(t)
    .replace(/^((um|uh|wait|okay|ok|so|hey|alright|and|now) )+/, "")
    .replace(/( (please|thanks|thank you))+$/, "");
/** "Set a timer for 5 minutes (for the rice)" with digits, as Ink writes them; anything else goes to Claude. */
function timerAsk(t: string): { seconds: number; label: string } | null {
  const m = t.toLowerCase().match(/\btimer (?:for )?(\d+(?:\.\d+)?) ?(sec|second|min|minute|hour|hr)s?\b(?: (?:for|on) (?:the |my )?([a-z ]{2,30}?))?[.!?]*$/);
  if (!m) return null;
  const seconds = Math.round(Number(m[1]) * (m[2].startsWith("h") ? 3600 : m[2].startsWith("m") ? 60 : 1));
  return seconds >= 5 && seconds <= 4 * 3600 ? { seconds, label: m[3]?.trim() || "timer" } : null;
}
/** After a no, a timer only when it's the whole ask: "No, set a timer for 5 minutes.", never "No, don't set a timer…". */
const TIMER_FIRST = /^((set|start) (a |the |me a )?)?timer\b/;

/** Mostly non-Latin letters: Ink writes the cook's Marathi (from a clip playing nearby) in Devanagari. */
const notLatin = (t: string) => {
  const letters = t.match(/\p{L}/gu) ?? [];
  return letters.length > 0 && letters.filter((c) => !/\p{Script=Latin}/u.test(c)).length / letters.length > 0.5;
};

/** True when `heard` is mostly words we just said: our own voice coming back through the mic. */
function isEcho(heard: string, spoken: string): boolean {
  const said = new Set(normalize(spoken).split(" "));
  const words = normalize(heard).split(" ").filter(Boolean);
  if (words.length < 3) return false;
  return words.filter((w) => said.has(w)).length / words.length > 0.7;
}

/** homie's hello in the cook's language, and its English (the pot greets the family in their own words). */
export const GREETINGS: Record<string, [string, string]> = {
  mr: ["चला, स्वयंपाक करूया!", "Let's cook!"],
  hi: ["चलो, खाना बनाते हैं!", "Let's cook!"],
  es: ["¿Listos? ¡A cocinar!", "Ready? Let's cook!"],
  fr: ["Prêts ? On cuisine !", "Ready? Let's cook!"],
  pt: ["Vamos cozinhar!", "Let's cook!"],
  it: ["Pronti? Si cucina!", "Ready? Let's cook!"],
  ja: ["さあ、作りましょう！", "Let's cook!"],
  zh: ["我们开始做饭吧！", "Let's start cooking!"],
  ko: ["자, 요리해 볼까요?", "Shall we cook?"],
  vi: ["Nấu thôi nào!", "Let's cook!"],
  tl: ["Tara, luto na tayo!", "Come on, let's cook!"],
  // Oct 24. TODO(caleb): a native speaker's check, like the Marathi lines.
  gu: ["ચાલો, રસોઈ બનાવીએ!", "Let's cook!"],
  ta: ["வாங்க, சமைக்கலாம்!", "Come, let's cook!"],
  te: ["రండి, వంట చేద్దాం!", "Come, let's cook!"],
  pa: ["ਆਓ, ਖਾਣਾ ਬਣਾਈਏ!", "Come, let's cook!"],
  ur: ["چلیں، کھانا بناتے ہیں!", "Let's cook!"],
  ar: ["هيا نطبخ!", "Let's cook!"],
  bn: ["চলো, রান্না করি!", "Let's cook!"],
};

const duration = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const part = (n: number, unit: string) => (n ? `${n} ${unit}${n > 1 ? "s" : ""}` : "");
  return [part(h, "hour"), part(m, "minute"), part(sec, "second")].filter(Boolean).join(" ");
};

const QUIET_NUDGE_MS = 6 * 60_000;
/** A turn Ink started but never ended (a dropped event) stops holding the mic open after this. */
const TURN_MAX_MS = 30_000;
/** Each kid's answer to the read-aloud offer, so a dropped socket doesn't greet and ask again (per instance). */
const answered = new Map<string, { at: number; reading: boolean }>();
const ANSWER_TTL_MS = 3 * 3600_000;
function remember(key: string, reading: boolean) {
  const now = Date.now();
  for (const [k, a] of answered) if (now - a.at > ANSWER_TTL_MS) answered.delete(k);
  answered.set(key, { at: now, reading });
}

export class Cooking {
  private session!: convex.CookSession;
  private step = 1;
  private ink?: Stt;
  private agent?: Pick<TurnAgent, "turn">;
  private speaking: AbortController | null = null;
  private lastSpoken = { text: "", until: 0 };
  /** When the phone finishes playing our last line. */
  private playingUntil = 0;
  /** When Ink last said the kid started talking (0 = no turn open). See `hearing`. */
  private turnOpenSince = 0;
  /** While the cook's clip plays, the mic hears her too: only plain commands count until then. */
  private clipUntil = 0;
  /** The phone says a video is playing (the kid's own tap on a step video, or ours). */
  private videoOn = false;
  /** Unprompted lines waiting for the video to stop, one after another. */
  private waitingLines: Promise<void> = Promise.resolve();
  /** Bumped by every new clip or step, so a translation still waiting for its clip to end is dropped. */
  private clipSeq = 0;
  private turns: Promise<void> = Promise.resolve();
  /** Counts what we've sent the phone besides transcripts: a turn that moves it on isn't a quiet one. */
  private answers = 0;
  /** A spoken piece that ended mid-sentence, waiting for the rest (heard). */
  private held: { text: string; timer: ReturnType<typeof setTimeout> } | null = null;
  private closed = false;
  /** Steps are read aloud only after the kid says yes to the offer. */
  private reading = false;
  /** The kid said no to reading: steps stay silent this visit ("repeat" still reads the one they're on). */
  private declined = false;
  private offer: { read: true } | { story: convex.Memory } | null = null;
  /** The kind of app-only homie moment up on the phone (answer, story, ask, help), or null. */
  private moment: string | null = null;
  private storiesOffered = new Set<convex.Memory>();
  private timers = new Map<string, NodeJS.Timeout>();
  private timerSeq = 0;
  private lastActivity = Date.now();
  private quietNudged = new Set<number>();
  private quietCheck?: NodeJS.Timeout;

  constructor(
    private ws: WebSocket,
    private token: string,
    private recipeId: string,
    private audio: AudioFormat,
    private deps: CookingDeps = LIVE,
  ) {}

  private get cook() {
    return this.session.cook?.name ?? "the cook";
  }
  private get readerKey() {
    return `${this.session.kid.id}:${this.session.recipe.id}`;
  }

  async start() {
    try {
      this.session = await this.deps.convex.startSession(this.token, this.recipeId);
    } catch (err) {
      const unauthorized = err instanceof convex.Unauthorized;
      const notFound = err instanceof convex.NotFound;
      const message = unauthorized ? "session expired" : notFound ? "recipe isn't ready" : "couldn't load the recipe";
      this.send({ type: "error", message });
      this.ws.close(unauthorized ? 4401 : notFound ? 4404 : 1011);
      if (!unauthorized && !notFound) console.error(err);
      return;
    }
    if (this.closed) return;
    const { recipe, cook, mossIndex } = this.session;
    this.step = this.session.stepOrder ?? 1;
    void this.deps.warm(mossIndex);
    this.agent = this.deps.agent(this.session, this.actions);
    this.ink = this.deps.listen(
      {
        onTurnStart: () => void (this.turnOpenSince = Date.now()),
        onPartial: (text) => this.send({ type: "transcript", text, final: false }),
        onTurnEnd: (text) => {
          this.turnOpenSince = 0;
          this.heard(text);
        },
        onError: (message) => console.warn(`ink: ${message}`),
      },
      [recipe.title, ...(cook ? [cook.name] : [])],
    );
    this.send({ type: "ready", recipe: { id: recipe.id, title: recipe.title, steps: recipe.steps.length } });
    this.send({ type: "go_to_step", stepOrder: this.step });
    this.quietCheck = setInterval(() => void this.nudgeIfQuiet(), 30_000);
    const prior = answered.get(this.readerKey);
    const returning = prior && prior.at > Date.now() - ANSWER_TTL_MS ? prior : null;
    console.log(
      `cook start: ${recipe.title}, step ${this.step}, cook ${cook?.language ?? "language unset"}, returning=${!!returning}${returning && !returning.reading ? " (said no to reading)" : ""}, stub=${convex.usingStub}`,
    );
    if (returning?.reading) this.reading = true;
    else if (returning) this.declined = true;
    else void this.greet().catch((err) => console.warn("greet", err.message));
  }

  /** The hello in the cook's language, then one offer to read the recipe out loud (never over an app moment). */
  private async greet() {
    const language = this.session.cook?.language ?? "en";
    const hello = GREETINGS[language];
    if (hello) await this.say(hello[0], "greeting", { textEn: hello[1], language });
    else await this.say("Ready? Let's cook!", "greeting");
    await this.played(true);
    if (this.closed || this.reading || this.declined || !env.readOffer) return;
    this.offer = { read: true };
    await this.say(`Want me to read ${this.cook}'s recipe out loud? Just say yes or no.`, "offer");
  }

  /**
   * Half duplex, the server's half: while our own line plays on the phone, its mic only hears us (an echo), and
   * Ink would bill for every second of it. Never mid-turn, though: Ink needs the audio after the kid stops to end
   * the turn (a turn whose end never came stops counting after 30 s). The phone stops sending then too; this is
   * the backup. The cook's clips stay the phone's to mute: we don't know when one really ends.
   */
  private hearing(): boolean {
    if (this.turnOpenSince && Date.now() - this.turnOpenSince < TURN_MAX_MS) return true;
    return !this.speaking && Date.now() >= this.playingUntil;
  }

  /** From the app: binary = mic audio, text = a JSON message. */
  onMessage(data: WebSocket.RawData, isBinary: boolean) {
    if (isBinary) {
      if (this.hearing()) this.ink?.send(data as Buffer);
      return;
    }
    let msg: { type?: string; stepOrder?: number; text?: unknown; open?: unknown; kind?: unknown; playing?: unknown };
    try {
      // `?? {}`: "null" is valid JSON, and reading .type off it used to end the whole process.
      msg = JSON.parse(data.toString()) ?? {};
    } catch {
      return;
    }
    if (msg.type === "step" && Number.isInteger(msg.stepOrder)) {
      this.step = msg.stepOrder!;
      this.touch();
      this.persistStep();
    } else if (msg.type === "text" && typeof msg.text === "string" && msg.text) {
      // Typed or push-to-talk input, or the app answering the offer ("yes", "no"): the same path as a spoken
      // turn. It's the app's own answer, so an open moment doesn't hold it.
      this.heard(msg.text.slice(0, 1000), false);
    } else if (msg.type === "moment" && typeof msg.open === "boolean") {
      // One of the app's own homie moments opened or closed on the phone.
      this.moment = msg.open ? (typeof msg.kind === "string" && msg.kind ? msg.kind.slice(0, 20) : "moment") : null;
    } else if (msg.type === "video" && typeof msg.playing === "boolean") {
      // A video started or stopped on the phone. Watching counts as activity (no quiet nudge after it).
      this.videoOn = msg.playing;
      this.touch();
    }
  }

  close() {
    this.closed = true;
    this.ink?.close();
    this.speaking?.abort();
    clearInterval(this.quietCheck);
    for (const t of this.timers.values()) clearTimeout(t);
    if (this.held) clearTimeout(this.held.timer);
    this.held = null;
  }

  /**
   * Ink sometimes ends a turn mid-sentence ("How do I know when the sugar is" … "ready?"). A spoken piece with no
   * end punctuation waits up to HOLD_MS for the rest, so the kid's question is one turn, not two. A plain command
   * or a word or two ("next step", "yes") goes at once.
   */
  private heard(text: string, spoken = true) {
    if (!text || !this.agent) return;
    if (!spoken) return this.act(text, false);
    if (this.held) {
      clearTimeout(this.held.timer);
      text = `${this.held.text} ${text}`;
      this.held = null;
    }
    const short = normalize(text).split(" ").length <= 2;
    if (!/[.?!…]["')\]]*$/.test(text.trim()) && !short && !FAST.some(([re]) => re.test(command(text)))) {
      const piece = text;
      this.held = { text: piece, timer: setTimeout(() => ((this.held = null), this.act(piece, true)), HOLD_MS) };
      return;
    }
    this.act(text, true);
  }

  private act(text: string, spoken: boolean) {
    if (!text || !this.agent || this.closed) return;
    const ignore = !spoken
      ? ""
      : notLatin(text)
        ? "not English"
        : Date.now() < this.lastSpoken.until && isEcho(text, this.lastSpoken.text)
          ? "echo"
          : Date.now() < this.clipUntil && !FAST.some(([re]) => re.test(command(text)))
            ? "during clip"
            : "";
    if (ignore) {
      console.log(`ignored (${ignore}): ${text}`);
      return;
    }
    this.send({ type: "transcript", text, final: true });
    this.touch();
    // A moment the app has up hears the kid's yes or no itself (from that transcript): it isn't ours to act on.
    // What the kid says after the no is still ours ("No, next step.", "No, I'm out of ginger. Can I skip it?").
    const inMoment = spoken && this.moment !== null;
    const answer = inMoment ? yesNo(text) : null;
    if (answer === "yes" || (answer === "no" && !afterNo(text).more)) {
      console.log(`kid (to the app's ${this.moment} moment): ${text}`);
      return;
    }
    console.log(`kid: ${text}`);
    // Said while the app's "ask" moment is up (the kid tapped homie to ask): for homie, whatever the words.
    const addressed = inMoment && this.moment === "ask";
    // A turn that throws anyway must not break the chain: every later turn would be skipped.
    this.turns = this.turns.then(() => this.turn(text, inMoment, addressed)).catch((err) => console.error("turn:", err));
  }

  /** One turn. `inMoment`: said while an app moment was up, so its yes or no is the moment's, never our offer's. */
  private async turn(text: string, inMoment = false, addressed = false) {
    if (this.closed) return;
    this.clipSeq++; // the kid moved on: drop a translation still waiting
    const before = this.answers;
    try {
      const answer = inMoment || this.offer ? yesNo(text) : null;
      if (answer === "no") {
        const to = inMoment ? "what's on their screen" : this.offer && "read" in this.offer ? "having the recipe read out loud" : `hearing ${this.cook}'s story`;
        if (!inMoment) this.declineOffer();
        return await this.afterNoTurn(text, to);
      }
      if (answer === "yes" && !inMoment) return await this.acceptOffer();
      if (!(await this.plain(text))) await this.agent!.turn(text, undefined, addressed);
    } catch (err) {
      console.error("turn failed:", (err as Error).message);
      this.send({ type: "error", message: "turn failed" });
      await this.say("Sorry, I missed that. Can you say it again?", "reply").catch(() => {});
    } finally {
      // Nothing done or said (not for homie, or a no with nothing after it): the phone stops "thinking".
      if (!this.closed && this.answers === before) this.send({ type: "quiet" });
    }
  }

  /**
   * The rest of a no, once the no itself is handled: a plain command right after it runs ("No, next step." moves the
   * step, silently), anything more goes to Claude as the whole sentence, told what the no was to ("No, I'm out of
   * ginger. Can I skip it?"), and more no is nothing. Never the words after the no alone: cutting the no can flip
   * what's left ("No point in reading it." → "in reading it", and Claude would read the step).
   */
  private async afterNoTurn(text: string, to: string) {
    const { more, fastTail } = afterNo(text);
    if (!more || (await this.plain(fastTail, true))) return;
    const note = `They just said no to ${to}, and that's done. Act only on anything else they said, and never read a step aloud unless they asked for it; if there's nothing else, reply with an empty message.`;
    await this.agent!.turn(text, note);
  }

  /**
   * Plain commands (FAST, and timers with digits) without Claude; false when `text` isn't one. `exact` (after a
   * no): a timer only as the whole ask (TIMER_FIRST).
   */
  private async plain(text: string, exact = false): Promise<boolean> {
    const fast = FAST.find(([re]) => re.test(command(text)))?.[1];
    const timer = exact && !TIMER_FIRST.test(command(text)) ? null : timerAsk(text);
    if (timer) await this.actions.setTimer(timer.seconds, timer.label);
    else if (fast === "next") await this.nextStep();
    else if (fast === "previous") await this.actions.goToStep(Math.max(1, this.step - 1));
    else if (fast === "repeat") await this.actions.goToStep(this.step, true);
    else return false;
    return true;
  }

  private async acceptOffer() {
    const offer = this.offer;
    // Yes to reading: goToStep turns it on (offer_closed, accepted) and reads the step they're on.
    if (offer && "read" in offer) return this.actions.goToStep(this.step, true);
    this.offer = null;
    if (offer && "story" in offer) {
      const { moment, text } = offer.story;
      return this.actions.playClip(moment.startS, moment.endS, { caption: text });
    }
  }

  /** "No" or "not now" to an open offer closes it, and nothing is said. To reading: steps stay silent this visit. */
  private declineOffer() {
    const offer = this.offer;
    this.offer = null;
    if (!offer || !("read" in offer)) return;
    this.declined = true;
    remember(this.readerKey, false);
    this.send({ type: "offer_closed", accepted: false });
  }

  /** Reading on (a yes, or "repeat" before any answer): every step is read from now on. */
  private startReading() {
    this.reading = true;
    remember(this.readerKey, true);
    if (this.offer && "read" in this.offer) {
      this.offer = null;
      this.send({ type: "offer_closed", accepted: true });
    }
  }

  private async nextStep() {
    if (this.step >= this.session.recipe.steps.length) return this.say("That was the last step. Enjoy it!", "reply");
    await this.actions.goToStep(this.step + 1);
  }

  /**
   * After a step is read: "Grandma has a story about this one." once per story (only stories she shared).
   * It waits for the step to finish playing without holding up the kid's next turn, which cancels it.
   */
  private async offerStory(order: number, seq: number) {
    const story = this.session.recipe.memories.find((m) => m.kind === "story" && m.stepOrder === order && !this.storiesOffered.has(m));
    if (!story || this.closed) return;
    await this.played(true);
    await this.untilPaused();
    if (seq !== this.clipSeq || this.step !== order || this.closed) return;
    this.storiesOffered.add(story);
    this.offer = { story };
    await this.say(`${this.cook} has a story about this one. Want to hear it?`, "nudge");
  }

  /** Quiet on one step for a long time: one gentle check per step (not while a video, a timer or an app moment is up). */
  private async nudgeIfQuiet() {
    if (!this.reading || this.closed || this.timers.size || this.speaking || this.moment || this.videoPlaying()) return;
    if (Date.now() - this.lastActivity < QUIET_NUDGE_MS || this.quietNudged.has(this.step)) return;
    this.quietNudged.add(this.step);
    this.touch();
    await this.say(`Still on step ${this.step}? No rush. Say "next" when you're ready.`, "nudge");
  }

  private touch() {
    this.lastActivity = Date.now();
  }

  private persistStep() {
    this.deps.convex.setStep(this.token, this.recipeId, this.step).catch((err) => console.warn("voice/step", err.message));
  }

  private async askCookWith(question: string, line: string) {
    const { questionId } = await this.deps.convex.logQuestion(this.token, this.recipeId, this.step, question);
    this.send({ type: "asked_cook", questionId, text: question });
    await this.say(line, "reply");
  }

  private async timerDone(id: string, label: string) {
    this.timers.delete(id);
    if (this.closed) return;
    this.send({ type: "timer_done", id, label });
    this.touch();
    await this.say(label === "timer" ? "Hey, your timer is done." : `Hey, the ${label} timer is done.`, "timer");
  }

  private actions: Actions = {
    currentStep: () => this.step,
    goToStep: async (order, read = false) => {
      const step = this.session.recipe.steps.find((s) => s.order === order);
      if (!step) return;
      this.step = order;
      this.clipUntil = 0;
      this.clipSeq++;
      if (this.offer && "story" in this.offer) this.offer = null;
      if (read && !this.reading && !this.declined) this.startReading();
      this.touch();
      this.send({ type: "go_to_step", stepOrder: order });
      this.persistStep();
      // Until the kid says yes, steps change silently; after a no, only "repeat" reads one.
      if (!this.reading && !read) return;
      await this.say(`Step ${order}. ${step.text}`, "step");
      if (this.reading) void this.offerStory(order, this.clipSeq).catch((err) => console.warn("story offer", err.message));
    },
    findMoment: (query, waitMs) => this.deps.findMoments(this.session.mossIndex, this.session.recipe.id, query, waitMs),
    playClip: async (startS, endS, { question, stepOrder, caption }) => {
      this.speaking?.abort();
      this.touch();
      const seq = ++this.clipSeq;
      const clipEnds = Date.now() + (endS - startS) * 1000;
      this.clipUntil = clipEnds + 1000;
      // The caption: her own words for this moment, plus English when she spoke another language.
      const step = this.session.recipe.steps.find((s) => s.order === stepOrder);
      const own = step && (!question || question.quote === step.quote || question.quote === step.text);
      const english = question?.quote ?? caption ?? step?.quote;
      const original = own ? step.quoteOriginal : undefined;
      const words = original ? { quote: original, quoteEn: english } : english ? { quote: english } : {};
      this.send({ type: "play_clip", startS, endS, ...words });
      if (!question) return;
      // Her words in English, once the clip has finished (she isn't talked over). Skipped only for a cook we know
      // speaks English; an unknown language gets Claude's translation, as before languages were recorded.
      const language = this.session.cook?.language;
      if (language !== "en") {
        const quote = question.quote;
        const short = language !== undefined && !notLatin(quote) && quote.split(/\s+/).length <= 30;
        void (short ? Promise.resolve(quote) : this.deps.translateQuote(quote))
          .then(async (english) => {
            await new Promise((r) => setTimeout(r, Math.max(0, clipEnds + 500 - Date.now())));
            if (english && seq === this.clipSeq && !this.closed) {
              await this.say(`${this.cook} says: ${english}`, "translation", { translation: true });
            }
          })
          .catch((err) => console.warn("translate", err.message));
      }
      await this.deps.convex
        .logQuestion(this.token, this.recipeId, this.step, question.text, { startS, endS, quote: question.quote })
        .catch((err) => console.warn("voice/question", err.message));
    },
    askCook: (question) => this.askCookWith(question, `Good question. I'll ask ${this.cook}.`),
    // One step, with no second Claude call: the question goes to Convex while the hint is spoken, then asked_cook,
    // and "I'll ask Grandma too." once the hint has played.
    giveHint: async (hint, question) => {
      const logged = this.deps.convex.logQuestion(this.token, this.recipeId, this.step, question);
      // Handled now, thrown below (like ask_cook's): a write that fails while the hint plays used to go unhandled.
      logged.catch(() => {});
      const text = /didn['’]?t say/i.test(hint) ? hint : `${this.cook} didn't say. ${hint}`;
      await this.say(text, "hint");
      const { questionId } = await logged;
      this.send({ type: "asked_cook", questionId, text: question });
      await this.played();
      await this.say(`I'll ask ${this.cook} too.`, "reply");
    },
    setTimer: async (seconds, label) => {
      const name = label.trim().toLowerCase().replace(/^the /, "").slice(0, 40) || "timer";
      const id = `timer-${++this.timerSeq}`;
      this.send({ type: "timer", id, seconds, label: name, endsAt: Date.now() + seconds * 1000 });
      this.timers.set(id, setTimeout(() => void this.timerDone(id, name), seconds * 1000));
      await this.say(`Okay, ${duration(seconds)}${name === "timer" ? "" : ` for the ${name}`}. I'll tell you when it's done.`, "reply");
    },
    say: (text) => this.say(text, "reply"),
  };

  /** Waits until the phone has played what we last said; with `noMoment`, also until no app moment is up. */
  private async played(noMoment = false) {
    while (!this.closed && (this.speaking || Date.now() < this.playingUntil || (noMoment && this.moment))) {
      await new Promise((r) => setTimeout(r, Math.max(50, Math.min(500, this.playingUntil - Date.now()))));
    }
  }

  /** A video plays on the phone: the kid's (the app says so) or the clip we asked it to play. */
  private videoPlaying(): boolean {
    return this.videoOn || Date.now() < this.clipUntil;
  }

  /** Waits until no video plays and our last line has finished (a video can start again meanwhile). */
  private async untilPaused() {
    do {
      while (!this.closed && this.videoPlaying()) await new Promise((r) => setTimeout(r, 250));
      await this.played();
    } while (!this.closed && this.videoPlaying());
  }

  /**
   * Speaks in homie's voice: a `say` message, the audio as binary frames, then `say_end`. Cuts off any line
   * still playing. `textEn` and `language` are for a line that isn't English (the greeting). A line homie
   * says on its own (UNPROMPTED) while a video plays waits for the next pause, in turn with any other.
   */
  private async say(text: string, kind: SayKind, extra: { textEn?: string; language?: string; translation?: true } = {}) {
    if (this.closed) return; // the phone hung up mid-turn: nobody to say it to, so no Sonic call
    if (UNPROMPTED.has(kind) && this.videoPlaying()) {
      const turn = this.waitingLines.then(() => this.untilPaused());
      this.waitingLines = turn;
      await turn;
      if (this.closed) return;
    }
    this.speaking?.abort();
    const ctrl = new AbortController();
    this.speaking = ctrl;
    this.lastSpoken = { text, until: Date.now() + 60_000 }; // narrowed below once we know the audio's length
    this.playingUntil = Date.now() + 60_000;
    const { language, ...fields } = extra;
    this.send({ type: "say", text, kind, ai: true, ...fields, audio: { format: this.audio, encoding: "pcm_s16le", sampleRate: SONIC_SAMPLE_RATE } });
    let bytes = 0;
    let firstAt = 0;
    try {
      await this.deps.speak(
        text,
        this.audio,
        ctrl.signal,
        (chunk) => {
          firstAt ||= Date.now();
          bytes += chunk.length;
          if (this.ws.readyState === WebSocket.OPEN) this.ws.send(chunk);
        },
        { voice: env.homieVoice, language, kind },
      );
    } catch (err) {
      if (!ctrl.signal.aborted) console.warn("sonic", (err as Error).message);
    }
    // The phone plays as audio arrives, so it finishes about one audio-length after the first byte.
    const playMs = (bytes / 2 / SONIC_SAMPLE_RATE) * 1000;
    this.playingUntil = ctrl.signal.aborted ? Date.now() : (firstAt || Date.now()) + playMs;
    // Ignore our own voice coming back until a little after that.
    this.lastSpoken = { text, until: Math.max(Date.now(), this.playingUntil) + 1500 };
    this.send({ type: "say_end", interrupted: ctrl.signal.aborted });
    if (this.speaking === ctrl) this.speaking = null;
  }

  private send(msg: { type: string; [field: string]: unknown }) {
    if (msg.type !== "transcript") this.answers++;
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
