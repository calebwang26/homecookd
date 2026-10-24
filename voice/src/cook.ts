// One kid cooking one recipe: a WebSocket from the app, an Ink stream for their voice, Claude for
// what they want, Sonic (homie's voice) for what we say. Messages are the "App ↔ voice service" contract
// in STACK.md, with the Oct 24 kid-side additions: every `say` has a `kind`; after `ready`, homie greets in
// the cook's language and offers to read the recipe out loud, and until the kid says yes, steps change
// silently; timers; labelled hints; and two nudges (a step with a story, a long quiet on one step).
import WebSocket from "ws";
import { TurnAgent, type Actions } from "./agent.js";
import * as convex from "./convex.js";
import { env } from "./env.js";
import { InkStream } from "./ink.js";
import { findMoments, warm } from "./moss.js";
import { SONIC_SAMPLE_RATE, speak, type AudioFormat } from "./sonic.js";
import { translateQuote } from "./translate.js";

type SayKind = "step" | "reply" | "hint" | "translation" | "nudge" | "offer" | "greeting" | "timer";

// Plain commands skip Claude: they're most of what a kid says, and this saves a model call.
const FAST: [RegExp, "next" | "previous" | "repeat"][] = [
  [/^(next|next step|next one|what'?s next|done|go on)$/, "next"],
  [/^(go back|back|previous|previous step|last step|step back)$/, "previous"],
  [/^(repeat|repeat that|again|say that again|one more time|what)$/, "repeat"],
];
/** "Yes" to an open offer (read it out loud, hear a story). Anything else goes the usual way. */
const YES = /^(yes|yeah|yep|yup|sure|ok|okay|please|go ahead|read it|read it out loud|do it|let'?s hear it)( .*)?$/;
const normalize = (t: string) => t.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
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
const isYes = (t: string) => {
  const c = normalize(t);
  return YES.test(c) && !FAST.some(([re]) => re.test(command(t)));
};

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
const GREETINGS: Record<string, [string, string]> = {
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
};

const duration = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const part = (n: number, unit: string) => (n ? `${n} ${unit}${n > 1 ? "s" : ""}` : "");
  return [part(h, "hour"), part(m, "minute"), part(sec, "second")].filter(Boolean).join(" ");
};

const QUIET_NUDGE_MS = 6 * 60_000;
/** Kids who already said yes to reading, so a dropped socket doesn't greet and ask again (per instance). */
const readers = new Map<string, number>();
const READER_TTL_MS = 3 * 3600_000;

export class Cooking {
  private session!: convex.CookSession;
  private step = 1;
  private ink?: InkStream;
  private agent?: TurnAgent;
  private speaking: AbortController | null = null;
  private lastSpoken = { text: "", until: 0 };
  /** When the phone finishes playing our last line. */
  private playingUntil = 0;
  /** While the cook's clip plays, the mic hears her too: only plain commands count until then. */
  private clipUntil = 0;
  /** Bumped by every new clip or step, so a translation still waiting for its clip to end is dropped. */
  private clipSeq = 0;
  private turns: Promise<void> = Promise.resolve();
  private closed = false;
  /** Steps are read aloud only after the kid says yes to the offer. */
  private reading = false;
  private offer: { read: true } | { story: convex.Memory } | null = null;
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
  ) {}

  private get cook() {
    return this.session.cook?.name ?? "the cook";
  }
  private get readerKey() {
    return `${this.session.kid.id}:${this.session.recipe.id}`;
  }

  async start() {
    try {
      this.session = await convex.startSession(this.token, this.recipeId);
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
    void warm(mossIndex);
    this.agent = new TurnAgent(this.session, this.actions);
    this.ink = new InkStream(
      {
        onTurnStart: () => {},
        onPartial: (text) => this.send({ type: "transcript", text, final: false }),
        onTurnEnd: (text) => this.heard(text),
        onError: (message) => console.warn(`ink: ${message}`),
      },
      [recipe.title, ...(cook ? [cook.name] : [])],
    );
    this.send({ type: "ready", recipe: { id: recipe.id, title: recipe.title, steps: recipe.steps.length } });
    this.send({ type: "go_to_step", stepOrder: this.step });
    this.quietCheck = setInterval(() => void this.nudgeIfQuiet(), 30_000);
    const returning = (readers.get(this.readerKey) ?? 0) > Date.now() - READER_TTL_MS;
    console.log(`cook start: ${recipe.title}, step ${this.step}, cook ${cook?.language ?? "language unset"}, returning=${returning}, stub=${convex.usingStub}`);
    if (returning) this.reading = true;
    else void this.greet().catch((err) => console.warn("greet", err.message));
  }

  /** The hello in the cook's language, then one offer to read the recipe out loud. */
  private async greet() {
    const language = this.session.cook?.language ?? "en";
    const hello = GREETINGS[language];
    if (hello) await this.say(hello[0], "greeting", { textEn: hello[1], language });
    else await this.say("Ready? Let's cook!", "greeting");
    await this.played();
    if (this.closed || this.reading) return;
    this.offer = { read: true };
    await this.say(`Want me to read ${this.cook}'s recipe out loud? Say yes, or tap here.`, "offer");
  }

  /** From the app: binary = mic audio, text = a JSON message. */
  onMessage(data: WebSocket.RawData, isBinary: boolean) {
    if (isBinary) return this.ink?.send(data as Buffer);
    let msg: { type?: string; stepOrder?: number; text?: string };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === "step" && Number.isInteger(msg.stepOrder)) {
      this.step = msg.stepOrder!;
      this.touch();
      this.persistStep();
    } else if (msg.type === "text" && msg.text) {
      // Typed or push-to-talk input, or a tap on the offer ("yes"): the same path as a spoken turn.
      this.heard(msg.text, false);
    }
  }

  close() {
    this.closed = true;
    this.ink?.close();
    this.speaking?.abort();
    clearInterval(this.quietCheck);
    for (const t of this.timers.values()) clearTimeout(t);
  }

  private heard(text: string, spoken = true) {
    if (!text || !this.agent) return;
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
    console.log(`kid: ${text}`);
    this.touch();
    this.turns = this.turns.then(() => this.turn(text));
  }

  private async turn(text: string) {
    if (this.closed) return;
    this.clipSeq++; // the kid moved on: drop a translation still waiting
    try {
      if (this.offer && isYes(text)) return await this.acceptOffer();
      const fast = FAST.find(([re]) => re.test(command(text)))?.[1];
      const timer = timerAsk(text);
      if (timer) await this.actions.setTimer(timer.seconds, timer.label);
      else if (fast === "next") await this.nextStep();
      else if (fast === "previous") await this.actions.goToStep(Math.max(1, this.step - 1));
      else if (fast === "repeat") await this.actions.goToStep(this.step, true);
      else await this.agent!.turn(text);
    } catch (err) {
      console.error("turn failed:", (err as Error).message);
      this.send({ type: "error", message: "turn failed" });
      await this.say("Sorry, can you say that again?", "reply").catch(() => {});
    }
  }

  private async acceptOffer() {
    const offer = this.offer;
    this.offer = null;
    if (offer && "read" in offer) return this.actions.goToStep(this.step, true);
    if (offer && "story" in offer) {
      const { moment, text } = offer.story;
      return this.actions.playClip(moment.startS, moment.endS, { caption: text });
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
    await this.played();
    if (seq !== this.clipSeq || this.step !== order || this.closed) return;
    this.storiesOffered.add(story);
    this.offer = { story };
    await this.say(`${this.cook} has a story about this one. Want to hear it?`, "nudge");
  }

  /** Quiet on one step for a long time: one gentle check per step (not while a clip or timer runs). */
  private async nudgeIfQuiet() {
    if (!this.reading || this.closed || this.timers.size || this.speaking || Date.now() < this.clipUntil) return;
    if (Date.now() - this.lastActivity < QUIET_NUDGE_MS || this.quietNudged.has(this.step)) return;
    this.quietNudged.add(this.step);
    this.touch();
    await this.say(`Still on step ${this.step}? Say "next" when you're ready.`, "nudge");
  }

  private touch() {
    this.lastActivity = Date.now();
  }

  private persistStep() {
    convex.setStep(this.token, this.recipeId, this.step).catch((err) => console.warn("voice/step", err.message));
  }

  private async askCookWith(question: string, line: string) {
    const { questionId } = await convex.logQuestion(this.token, this.recipeId, this.step, question);
    this.send({ type: "asked_cook", questionId, text: question });
    await this.say(line, "reply");
  }

  private async timerDone(id: string, label: string) {
    this.timers.delete(id);
    if (this.closed) return;
    this.send({ type: "timer_done", id, label });
    this.touch();
    await this.say(label === "timer" ? "Your timer is done." : `The ${label} timer is done.`, "timer");
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
      if (read && !this.reading) {
        this.reading = true;
        this.offer = null;
        readers.set(this.readerKey, Date.now());
      }
      this.touch();
      this.send({ type: "go_to_step", stepOrder: order });
      this.persistStep();
      if (!this.reading) return; // until the kid says yes, steps change silently
      await this.say(`Step ${order}. ${step.text}`, "step");
      void this.offerStory(order, this.clipSeq).catch((err) => console.warn("story offer", err.message));
    },
    findMoment: (query, waitMs) => findMoments(this.session.mossIndex, this.session.recipe.id, query, waitMs),
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
        void (short ? Promise.resolve(quote) : translateQuote(quote))
          .then(async (english) => {
            await new Promise((r) => setTimeout(r, Math.max(0, clipEnds + 500 - Date.now())));
            if (english && seq === this.clipSeq && !this.closed) {
              await this.say(`${this.cook} says: ${english}`, "translation", { translation: true });
            }
          })
          .catch((err) => console.warn("translate", err.message));
      }
      await convex
        .logQuestion(this.token, this.recipeId, this.step, question.text, { startS, endS, quote: question.quote })
        .catch((err) => console.warn("voice/question", err.message));
    },
    askCook: (question) => this.askCookWith(question, `Good question. I'll ask ${this.cook}.`),
    giveHint: async (hint, question) => {
      const logged = convex.logQuestion(this.token, this.recipeId, this.step, question);
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
      await this.say(`Okay, ${duration(seconds)}${name === "timer" ? "" : ` for the ${name}`}.`, "reply");
    },
    say: (text) => this.say(text, "reply"),
  };

  /** Waits until the phone has played what we last said. */
  private async played() {
    while (!this.closed && (this.speaking || Date.now() < this.playingUntil)) {
      await new Promise((r) => setTimeout(r, Math.max(50, Math.min(500, this.playingUntil - Date.now()))));
    }
  }

  /**
   * Speaks in homie's voice: a `say` message, the audio as binary frames, then `say_end`. Cuts off any line
   * still playing. `textEn` and `language` are for a line that isn't English (the greeting).
   */
  private async say(text: string, kind: SayKind, extra: { textEn?: string; language?: string; translation?: true } = {}) {
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
      await speak(
        text,
        this.audio,
        ctrl.signal,
        (chunk) => {
          firstAt ||= Date.now();
          bytes += chunk.length;
          if (this.ws.readyState === WebSocket.OPEN) this.ws.send(chunk);
        },
        { voice: env.homieVoice, language },
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

  private send(msg: object) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
