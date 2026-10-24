// homie while a cook records (/record, STACK.md "homie while recording"). The phone by the stove
// streams the mic; we transcribe it in her language (stt.ts), and every few seconds, when the pacing
// allows and she's quiet, homie decides whether to ask one short question (homie.ts). Phases:
// intro (the hello) → recording ({type:"start"}) → wrapping_up ({type:"done"}: last questions, the
// stories opt-in, goodbye) → ended. Status and every line homie says go to Convex (/live/*).
import WebSocket from "ws";
import * as convex from "./convex.js";
import { env } from "./env.js";
import { HomieAgent, isNotNow, translate, type AskKind, type Heard, type Line, type Who } from "./homie.js";
import { fixedLine } from "./lines.js";
import { DEMO, NORMAL, Pacer } from "./pacing.js";
import { SONIC_SAMPLE_RATE, speak, type AudioFormat } from "./sonic.js";
import { createStt, type Stt } from "./stt.js";

type Phase = "intro" | "recording" | "wrapping_up" | "ended";
type Pending = { promptId: string; line: Line; dropTimer?: NodeJS.Timeout };

const TICK_MS = 2000;
const QUIET_MS = 3000; // never ask while she's talking
const DECIDE_EVERY_MS = 15_000;
const STORY_CHECK_WORDS = 25; // outside the ask window, a long turn may be a story worth a reaction
const DROP_MS = 10_000;
const END_ANSWER_MS = 15_000;
const MUTE_AFTER_MS = 300;
const INTRO_WAIT_MS = 7000; // then the hand-written hello
const FRAME_EVERY_MS = 5000;

const intros = new Map<string, Line>(); // per recording, so a reconnect says the same hello
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

export class Recording {
  private s!: convex.RecordingSession;
  private who!: Who;
  /** The same, with the names as written in English (for textEn). */
  private whoLatin!: Who;
  private homie!: HomieAgent;
  private stt?: Stt;
  private pacer = new Pacer(env.homieDemo ? DEMO : NORMAL);
  private phase: Phase = "intro";
  /** t0 for every atS: Convex's startedAt, or (if she ends before starting) the moment she ended. */
  private t0?: number;
  private introAt = 0;
  private introLine?: Line;
  /** Her and the kid's names in her script, for the fixed lines (lines.ts). */
  private names: Promise<void> = Promise.resolve();
  private heardLog: Heard[] = [];
  private asked: string[] = [];
  private lastSpeechAt = 0;
  private turnStartedAt = 0;
  private storyInProgress = false;
  private lastDecideAt = 0;
  private decidedThrough = 0; // heardLog length at the last decision
  private reactedAt = 0;
  private deciding = false;
  private pending?: Pending;
  /** The end flow waits on her next turn through this. */
  private waiter?: (text: string | null) => void;
  private speaking: AbortController | null = null;
  private muteUntil = 0;
  private frame?: Buffer;
  private timers: NodeJS.Timeout[] = [];
  private flows: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private ws: WebSocket,
    private token: string,
    private recordingId: string,
    private audio: AudioFormat,
  ) {}

  async start() {
    try {
      this.s = await convex.recordingSession(this.token, this.recordingId);
    } catch (err) {
      const unauthorized = err instanceof convex.Unauthorized;
      const notFound = err instanceof convex.NotFound;
      this.send({ type: "error", message: unauthorized ? "session expired" : notFound ? "no such recording" : "couldn't load the recording" });
      this.ws.close(unauthorized ? 4401 : notFound ? 4404 : 1011);
      if (!unauthorized && !notFound) console.error(err);
      return;
    }
    const { recording, cook, kid } = this.s;
    if (recording.status === "ended" || recording.status === "abandoned") {
      this.send({ type: "error", message: "this recording has ended" });
      this.ws.close(4404);
      return;
    }
    if (this.closed) return;
    const call = cook.relation && !cook.name.includes(cook.relation) ? `${cook.name} ${cook.relation}` : cook.name;
    const dish = this.s.dish ?? recording.dish;
    this.who = this.whoLatin = { language: recording.language, call, kid: kid?.name.split(" ")[0], dish };
    this.homie = new HomieAgent(this.who);
    this.names = this.who.language === "en" ? Promise.resolve() : this.nativeNames();
    this.stt = createStt(recording.language, {
      onTurnStart: () => this.onTurnStart(),
      onPartial: (text) => {
        this.lastSpeechAt = Date.now();
        this.send({ type: "transcript", text, final: false });
      },
      onTurnEnd: (text) => this.heard(text),
      onError: (message) => console.warn(`stt: ${message}`),
    }, [dish, cook.name, kid?.name].filter((x): x is string => !!x));
    this.send({ type: "ready", recording: { id: recording._id, language: recording.language, cookName: call, kidName: this.who.kid, dish } });
    console.log(`record start: ${call}, ${recording.language}, ${recording.status}, stub=${convex.usingStub}, demo=${env.homieDemo}`);

    if (recording.status === "intro") {
      this.setPhase("intro");
      this.flow(() => this.intro());
    } else {
      this.t0 = recording.startedAt ?? Date.now();
      if (recording.status === "recording") this.enterRecording();
      else this.flow(() => this.wrapUp());
    }
  }

  /** From the app: binary = mic audio, text = a JSON message. */
  onMessage(data: WebSocket.RawData, isBinary: boolean) {
    if (isBinary) {
      // Half duplex: homie never hears itself (the phone sends silence then too).
      if (!this.speaking && Date.now() >= this.muteUntil) this.stt?.send(data as Buffer);
      return;
    }
    let msg: { type?: string; text?: string };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === "start" && this.phase === "intro") void this.begin();
    else if (msg.type === "done" && (this.phase === "intro" || this.phase === "recording")) this.flow(() => this.wrapUp());
    else if (msg.type === "text" && msg.text) {
      this.turnStartedAt = Date.now();
      this.heard(msg.text);
    } else if (msg.type === "not_now" && this.pending) this.drop("not_now");
  }

  close() {
    this.closed = true;
    this.stt?.close();
    this.speaking?.abort();
    for (const t of this.timers) clearInterval(t);
    if (this.pending?.dropTimer) clearTimeout(this.pending.dropTimer);
    this.waiter?.(null);
  }

  // ---- phases ----

  private async intro() {
    this.state("thinking");
    this.introAt = Date.now();
    let line = intros.get(this.recordingId);
    if (!line) {
      // Claude writes the names in her script itself; the hand-written fallback waits for them.
      const written = this.homie.intro().catch((err) => (console.warn("intro", err.message), null));
      line = (await Promise.race([written, sleep(INTRO_WAIT_MS).then(() => null)])) ?? (await this.names, await fixedLine("intro", this.who, this.whoLatin));
      intros.set(this.recordingId, line);
    }
    this.introLine = line;
    if (this.phase === "intro") await this.say(line, "intro");
    this.state("quiet");
  }

  /** Names in her script ("रजनी आजी"), so Sonic says them the way she does. */
  private async nativeNames() {
    const [call, kid] = await Promise.all([
      translate(this.who.call, this.who.language).catch(() => ""),
      this.who.kid ? translate(this.who.kid, this.who.language).catch(() => "") : Promise.resolve(""),
    ]);
    this.who = { ...this.who, call: call || this.who.call, kid: kid || this.who.kid };
    this.homie.setWho(this.who);
  }

  private async begin() {
    // She's ready: stop the hello, even if it's only still playing on the phone.
    if (!this.speaking && Date.now() < this.muteUntil) this.send({ type: "say_end", interrupted: true });
    this.speaking?.abort();
    this.muteUntil = 0;
    try {
      const { startedAt } = await convex.setRecordingStatus(this.token, this.recordingId, "recording");
      this.t0 = startedAt ?? Date.now();
    } catch (err) {
      console.warn("live/status", (err as Error).message);
      this.t0 = Date.now();
    }
    this.enterRecording();
  }

  private enterRecording() {
    this.setPhase("recording");
    this.state("quiet");
    this.logIntro();
    this.timers.push(setInterval(() => void this.tick(), TICK_MS));
    if (env.glassesUrl && env.glassesSecret) {
      this.timers.push(setInterval(() => void this.pullFrame(), FRAME_EVERY_MS));
    }
  }

  /** The hello is logged once filming starts, so its atS (negative) is on the video's clock. */
  private logIntro() {
    const line = this.introLine;
    if (!line || this.t0 === undefined) return;
    this.introLine = undefined;
    void this.log("intro", line, "spoken", (this.introAt - this.t0) / 1000);
  }

  private async wrapUp() {
    if (this.phase === "wrapping_up" || this.phase === "ended") return;
    this.speaking?.abort();
    this.t0 ??= Date.now();
    this.logIntro();
    this.setPhase("wrapping_up");
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.pending) this.drop("ignored");
    void convex.setRecordingStatus(this.token, this.recordingId, "wrapping_up").catch((err) => console.warn("live/status", err.message));

    this.state("thinking");
    await this.names;
    const questions = await this.homie
      .endQuestions(this.heardLog, this.asked, this.pacer.rules.maxEnd)
      .catch((err) => (console.warn("end questions", err.message), []));
    for (const [i, q] of questions.entries()) {
      let line = q.line;
      if (i === 0) {
        const pre = await fixedLine(questions.length > 1 ? "beforeYouGo2" : "beforeYouGo1", this.who, this.whoLatin);
        line = { text: `${pre.text} ${line.text}`, textEn: `${pre.textEn} ${line.textEn}` };
      }
      await this.askAndWait("end", line);
    }

    const optIn = await fixedLine("optIn", this.who, this.whoLatin);
    const reply = await this.askAndWait("optin", optIn);
    const yes = reply ? await this.homie.yesNo(reply).catch(() => null) : null;
    if (yes !== null) await convex.setOptIn(this.token, this.recordingId, yes).catch((err) => console.warn("live/optin", err.message));

    const closing = await fixedLine("closing", this.who, this.whoLatin);
    await this.say(closing, "closing");
    void this.log("closing", closing, "spoken");
    this.setPhase("ended");
    this.state("quiet");
    this.stt?.close();
    await convex.setRecordingStatus(this.token, this.recordingId, "ended").catch((err) => console.warn("live/status", err.message));
  }

  /** An end question: ask, wait for her next turn (or ~15 s), log the answer. Returns her words. */
  private async askAndWait(kind: "end" | "optin", line: Line): Promise<string | null> {
    const promptId = await this.log(kind, line, "spoken");
    this.send({ type: "ask", promptId, text: line.text, textEn: line.textEn, kind });
    await this.say(line, kind);
    const reply = await new Promise<string | null>((resolve) => {
      if (this.closed) return resolve(null);
      const timer = setTimeout(() => resolve(null), END_ANSWER_MS);
      this.waiter = (text) => {
        clearTimeout(timer);
        resolve(text);
      };
    });
    this.waiter = undefined;
    if (reply && !isNotNow(reply)) {
      this.send({ type: "answered", promptId });
      void this.saveAnswer(promptId, reply);
      return reply;
    }
    this.send({ type: "drop", promptId });
    void convex.updatePrompt(this.token, promptId, reply ? "not_now" : "ignored").catch(() => {});
    return null;
  }

  // ---- listening ----

  private onTurnStart() {
    this.lastSpeechAt = this.turnStartedAt = Date.now();
    this.state("listening");
    // She's answering: don't fade the question while she talks.
    if (this.pending?.dropTimer) {
      clearTimeout(this.pending.dropTimer);
      this.pending.dropTimer = undefined;
    }
  }

  private heard(text: string) {
    if (this.closed || this.phase === "ended") return;
    this.lastSpeechAt = Date.now();
    this.send({ type: "transcript", text, final: true });
    this.heardLog.push({ atS: this.atS(this.turnStartedAt || Date.now()), text });
    console.log(`cook: ${text}`);
    if (this.waiter) return this.waiter(text);
    if (this.pending) {
      if (isNotNow(text)) return this.drop("not_now");
      const { promptId } = this.pending;
      clearTimeout(this.pending.dropTimer);
      this.pending = undefined;
      this.pacer.answered();
      this.send({ type: "answered", promptId });
      void this.saveAnswer(promptId, text);
    }
    if (this.phase === "recording") this.state("quiet");
  }

  private async saveAnswer(promptId: string, transcript: string) {
    const atS = this.atS(this.turnStartedAt || Date.now());
    const endS = this.atS(Date.now());
    const transcriptEn = this.who.language === "en" ? undefined : await translate(transcript, "en").catch(() => undefined);
    await convex
      .updatePrompt(this.token, promptId, "answered", { transcript, transcriptEn: transcriptEn || undefined, atS, endS })
      .catch((err) => console.warn("live/prompt-update", err.message));
  }

  // ---- deciding ----

  private async tick() {
    if (this.phase !== "recording" || this.deciding || this.speaking || this.pending || this.closed) return;
    const now = Date.now();
    if (now - this.lastSpeechAt < QUIET_MS || now - this.lastDecideAt < DECIDE_EVERY_MS) return;
    const nowS = this.atS(now);
    const mayAsk = this.pacer.mayAsk(nowS);
    const fresh = this.heardLog.slice(this.decidedThrough);
    const maybeStory = this.storyInProgress || fresh.reduce((n, h) => n + words(h.text), 0) >= STORY_CHECK_WORDS;
    if (!mayAsk && !maybeStory) return;
    this.deciding = true;
    this.lastDecideAt = now;
    this.decidedThrough = this.heardLog.length;
    try {
      const d = await this.homie.decide({
        heard: this.heardLog,
        asked: this.asked,
        nowS,
        mayAsk,
        mayReact: maybeStory && now - this.reactedAt > 90_000,
        frame: this.frame,
      });
      console.log(`homie decide at ${nowS.toFixed(0)}s (mayAsk=${mayAsk}): ${d.action}${d.action === "quiet" ? ` story=${d.storyInProgress}` : ` ${d.line.textEn}`}`);
      // She may have started talking while we thought; then stay quiet.
      if (this.phase !== "recording" || Date.now() - this.lastSpeechAt < QUIET_MS) return;
      if (d.action === "quiet") this.storyInProgress = d.storyInProgress;
      else if (d.action === "react") {
        this.storyInProgress = false;
        this.reactedAt = Date.now();
        this.flow(async () => {
          await this.say(d.line, "reaction");
          void this.log("reaction", d.line, "spoken");
        });
      } else this.flow(() => this.ask(d.kind, d.line));
    } catch (err) {
      console.warn("homie decide", (err as Error).message);
    } finally {
      this.deciding = false;
    }
  }

  private async ask(kind: AskKind, line: Line) {
    if (this.phase !== "recording") return;
    this.pacer.onAsk(this.atS(Date.now()));
    this.asked.push(line.textEn);
    const promptId = await this.log(kind, line, "spoken");
    const pending: Pending = { promptId, line };
    this.pending = pending;
    this.send({ type: "ask", promptId, text: line.text, textEn: line.textEn, kind });
    await this.say(line, kind);
    // ~10 s after she heard it with no answer, the card fades (her starting to talk holds it).
    if (this.pending === pending) pending.dropTimer = setTimeout(() => this.pending === pending && this.drop("ignored"), DROP_MS);
  }

  private drop(status: "ignored" | "not_now") {
    const p = this.pending;
    if (!p) return;
    clearTimeout(p.dropTimer);
    this.pending = undefined;
    this.pacer.ignored();
    this.send({ type: "drop", promptId: p.promptId });
    void convex.updatePrompt(this.token, p.promptId, status).catch((err) => console.warn("live/prompt-update", err.message));
  }

  private async pullFrame() {
    try {
      const res = await fetch(`${env.glassesUrl}/frame/latest?recording=${encodeURIComponent(this.recordingId)}`, {
        headers: { "x-glasses-secret": env.glassesSecret },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok && (res.headers.get("content-type") ?? "").includes("image/jpeg")) {
        const jpeg = Buffer.from(await res.arrayBuffer());
        if (jpeg.length < 4_000_000) this.frame = jpeg;
      }
    } catch {
      // No glasses frame: homie just listens.
    }
  }

  // ---- speaking and the socket ----

  /** Run one speaking flow after the ones before it (never two at once). */
  private flow(fn: () => Promise<void>) {
    this.flows = this.flows.then(fn).catch((err) => {
      console.error("record flow:", (err as Error).message);
      this.send({ type: "error", message: "homie had a problem" });
    });
  }

  /** Speaks in her language with homie's voice; resolves once the phone should have finished playing it. */
  private async say(line: Line, kind: string): Promise<void> {
    if (this.closed) return;
    this.speaking?.abort();
    const ctrl = new AbortController();
    this.speaking = ctrl;
    this.state("speaking");
    this.send({ type: "say", text: line.text, textEn: line.textEn, kind, ai: true, audio: { format: this.audio, encoding: "pcm_s16le", sampleRate: SONIC_SAMPLE_RATE } });
    const t0 = Date.now();
    let first = 0;
    let bytes = 0;
    try {
      await speak(line.text, this.audio, ctrl.signal, (chunk) => {
        if (!first) {
          first = Date.now();
          console.log(`sonic first audio ${first - t0}ms (${kind})`);
        }
        bytes += chunk.length;
        if (this.ws.readyState === WebSocket.OPEN) this.ws.send(chunk);
      }, { language: this.who.language, voice: env.homieVoice, speed: 0.9 });
    } catch (err) {
      if (!ctrl.signal.aborted) console.warn("sonic", (err as Error).message);
    }
    const playEnd = ctrl.signal.aborted ? Date.now() : (first || Date.now()) + (bytes / 2 / SONIC_SAMPLE_RATE) * 1000;
    this.muteUntil = playEnd + MUTE_AFTER_MS;
    this.send({ type: "say_end", interrupted: ctrl.signal.aborted });
    if (this.speaking === ctrl) this.speaking = null;
    await sleep(Math.max(0, playEnd - Date.now()));
    if (!this.speaking) this.state(this.phase === "ended" ? "quiet" : "listening");
  }

  private log(kind: convex.PromptKind, line: Line, status: convex.PromptStatus, atS = this.atS(Date.now())): Promise<string> {
    return convex
      .logPrompt(this.token, this.recordingId, { kind, text: line.text, textEn: line.textEn, atS, status })
      .then((r) => r.promptId)
      .catch((err) => {
        console.warn("live/prompt", err.message);
        return `unsaved-${Date.now()}`;
      });
  }

  private atS(ms: number) {
    return this.t0 === undefined ? 0 : Math.round((ms - this.t0) / 100) / 10;
  }

  private setPhase(phase: Phase) {
    this.phase = phase;
    this.send({ type: "phase", phase });
  }

  private state(state: "listening" | "thinking" | "speaking" | "quiet") {
    this.send({ type: "state", state });
  }

  private send(msg: object) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
