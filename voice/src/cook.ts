// One kid cooking one recipe: a WebSocket from the app, an Ink stream for their voice, Claude for
// what they want, Sonic for what we say. Messages are the "App ↔ voice service" contract in STACK.md.
import WebSocket from "ws";
import { TurnAgent, type Actions } from "./agent.js";
import * as convex from "./convex.js";
import { InkStream } from "./ink.js";
import { findMoments, warm } from "./moss.js";
import { SONIC_SAMPLE_RATE, speak, type AudioFormat } from "./sonic.js";

// Plain commands skip Claude: they're most of what a kid says, and this saves a model call.
const FAST: [RegExp, "next" | "previous" | "repeat"][] = [
  [/^(next|next step|next one|what'?s next|done|go on)$/, "next"],
  [/^(go back|back|previous|previous step|last step|step back)$/, "previous"],
  [/^(repeat|repeat that|again|say that again|one more time|what)$/, "repeat"],
];
const normalize = (t: string) => t.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
/** "Um, wait, go back please" → "go back". */
const command = (t: string) =>
  normalize(t)
    .replace(/^((um|uh|wait|okay|ok|so|hey|alright|and|now) )+/, "")
    .replace(/( (please|thanks|thank you))+$/, "");

/** True when `heard` is mostly words we just said: our own voice coming back through the mic. */
function isEcho(heard: string, spoken: string): boolean {
  const said = new Set(normalize(spoken).split(" "));
  const words = normalize(heard).split(" ").filter(Boolean);
  if (words.length < 3) return false;
  return words.filter((w) => said.has(w)).length / words.length > 0.7;
}

export class Cooking {
  private session!: convex.CookSession;
  private step = 1;
  private ink?: InkStream;
  private agent?: TurnAgent;
  private speaking: AbortController | null = null;
  private lastSpoken = { text: "", until: 0 };
  private turns: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private ws: WebSocket,
    private token: string,
    private recipeId: string,
    private audio: AudioFormat,
  ) {}

  async start() {
    try {
      this.session = await convex.startSession(this.token, this.recipeId);
    } catch (err) {
      const unauthorized = err instanceof convex.Unauthorized;
      this.send({ type: "error", message: unauthorized ? "session expired" : "couldn't load the recipe" });
      this.ws.close(unauthorized ? 4401 : 1011);
      if (!unauthorized) console.error(err);
      return;
    }
    if (this.closed) return;
    const { recipe, cook, familyId } = this.session;
    this.step = this.session.stepOrder ?? 1;
    void warm(familyId);
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
    console.log(`cook start: ${recipe.title}, step ${this.step}, stub=${convex.usingStub}`);
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
      this.persistStep();
    } else if (msg.type === "text" && msg.text) {
      // Typed or push-to-talk input: the same path as a spoken turn.
      this.heard(msg.text);
    }
  }

  close() {
    this.closed = true;
    this.ink?.close();
    this.speaking?.abort();
  }

  private heard(text: string) {
    if (!text || !this.agent) return;
    if (Date.now() < this.lastSpoken.until && isEcho(text, this.lastSpoken.text)) {
      console.log(`ignored echo: ${text}`);
      return;
    }
    this.send({ type: "transcript", text, final: true });
    console.log(`kid: ${text}`);
    this.turns = this.turns.then(() => this.turn(text));
  }

  private async turn(text: string) {
    if (this.closed) return;
    try {
      const fast = FAST.find(([re]) => re.test(command(text)))?.[1];
      if (fast === "next") await this.nextStep();
      else if (fast === "previous") await this.actions.goToStep(Math.max(1, this.step - 1));
      else if (fast === "repeat") await this.actions.goToStep(this.step);
      else await this.agent!.turn(text);
    } catch (err) {
      console.error("turn failed:", (err as Error).message);
      this.send({ type: "error", message: "turn failed" });
      await this.actions.say("Sorry, can you say that again?").catch(() => {});
    }
  }

  private async nextStep() {
    if (this.step >= this.session.recipe.steps.length) return this.actions.say("That was the last step. Enjoy it!");
    await this.actions.goToStep(this.step + 1);
  }

  private persistStep() {
    convex.setStep(this.token, this.recipeId, this.step).catch((err) => console.warn("voice/step", err.message));
  }

  private actions: Actions = {
    currentStep: () => this.step,
    goToStep: async (order) => {
      const step = this.session.recipe.steps.find((s) => s.order === order);
      if (!step) return;
      this.step = order;
      this.send({ type: "go_to_step", stepOrder: order });
      this.persistStep();
      await this.say(`Step ${order}. ${step.text}`);
    },
    findMoment: (query, waitMs) => findMoments(this.session.familyId, this.session.recipe.id, query, waitMs),
    playClip: async (startS, endS, question) => {
      this.speaking?.abort();
      this.send({ type: "play_clip", startS, endS });
      if (question) {
        await convex
          .logQuestion(this.token, this.recipeId, this.step, question.text, { moment: { startS, endS }, quote: question.quote })
          .catch((err) => console.warn("voice/question", err.message));
      }
    },
    askCook: async (question) => {
      const { questionId } = await convex.logQuestion(this.token, this.recipeId, this.step, question);
      this.send({ type: "asked_cook", questionId, text: question });
      await this.say(`Good question. I'll ask ${this.session.cook?.name ?? "the cook"}.`);
    },
    say: (text) => this.say(text),
  };

  /** Speaks with Sonic: a `say` message, the audio as binary frames, then `say_end`. Cuts off any line still playing. */
  private async say(text: string) {
    this.speaking?.abort();
    const ctrl = new AbortController();
    this.speaking = ctrl;
    this.lastSpoken = { text, until: Date.now() + 60_000 }; // narrowed below once we know the audio's length
    this.send({ type: "say", text, ai: true, audio: { format: this.audio, encoding: "pcm_s16le", sampleRate: SONIC_SAMPLE_RATE } });
    let bytes = 0;
    try {
      await speak(text, this.audio, ctrl.signal, (chunk) => {
        bytes += chunk.length;
        if (this.ws.readyState === WebSocket.OPEN) this.ws.send(chunk);
      });
    } catch (err) {
      if (!ctrl.signal.aborted) console.warn("sonic", (err as Error).message);
    }
    // Playback runs about this long after the last byte; ignore our own voice coming back until then.
    const playMs = (bytes / 2 / SONIC_SAMPLE_RATE) * 1000;
    this.lastSpoken = { text, until: Date.now() + playMs + 1500 };
    this.send({ type: "say_end", interrupted: ctrl.signal.aborted });
    if (this.speaking === ctrl) this.speaking = null;
  }

  private send(msg: object) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
