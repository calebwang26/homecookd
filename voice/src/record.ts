// homie while a cook records (/record, STACK.md "homie while recording"). The phone by the stove
// streams the mic; we transcribe it in her language (stt.ts), and every few seconds, when the pacing
// allows and she's quiet, homie decides whether to ask one short question (homie.ts). Phases:
// intro (the hello) → recording ({type:"start"}) → wrapping_up ({type:"done"}: last questions, the
// stories opt-in, goodbye) → ended. Status and every line homie says go to Convex (/live/*).
// What homie knows about a recording (pacing, what it asked, what she said, the hello) is kept per
// recording, so a dropped socket picks up where it left off instead of starting over. A recording the
// app ended while it couldn't reach us (live.endRecording) ends its socket quietly at the next Convex write.
import WebSocket from "ws";
import * as convex from "./convex.js";
import { env } from "./env.js";
import { HomieAgent, isNotNow, translate, type AskKind, type Heard, type Line, type Who } from "./homie.js";
import { fixedLine } from "./lines.js";
import { DEMO, NORMAL, Pacer, type PaceRules } from "./pacing.js";
import { SONIC_SAMPLE_RATE, type AudioFormat } from "./sonic.js";
import { createStt, speak } from "./speech.js";
import type { Stt } from "./stt.js";

/** `loading` is ours only (the app never sees it): messages wait until the recording is read. */
type Phase = "loading" | "intro" | "recording" | "wrapping_up" | "ended";
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
const HEARTBEAT_MS = 10 * 60_000; // Convex abandons a recording nobody touched for 2 h
const MEMORY_TTL_MS = 3 * 3600_000;

/** What homie keeps about one recording across reconnects (Cloud Run's session affinity sends her back here). */
type Memory = {
  pacer: Pacer;
  /** Every question homie has said, in English. */
  asked: string[];
  heard: Heard[];
  /** The hello, so a reconnect says the same one; when it was last said; whether it's in Convex yet. */
  intro?: Line;
  introAt?: number;
  introLogged: boolean;
  /** t0 for every atS: Convex's startedAt, or (if she ends before starting) the moment she ended. */
  t0?: number;
  reactedAt: number;
  endAsked: number;
  optInDone: boolean;
  usedAt: number;
};
const memories = new Map<string, Memory>();
/** The Recording serving each recording now: a newer socket replaces an older one. */
const open = new Map<string, Recording>();

/** This recording's memory. `fresh` (she hasn't started yet) keeps only the hello. Old ones expire. */
function memoryOf(recordingId: string, rules: PaceRules, fresh: boolean): Memory {
  const now = Date.now();
  for (const [id, m] of memories) if (now - m.usedAt > MEMORY_TTL_MS) memories.delete(id);
  const old = memories.get(recordingId);
  if (old && !fresh) {
    old.usedAt = now;
    return old;
  }
  const m: Memory = { pacer: new Pacer(rules), asked: [], heard: [], intro: old?.intro, introLogged: false, reactedAt: 0, endAsked: 0, optInDone: false, usedAt: now };
  memories.set(recordingId, m);
  return m;
}

/** What a Recording talks to. Tests pass fakes. */
export type RecordingDeps = {
  convex: Pick<typeof convex, "recordingSession" | "setRecordingStatus" | "touchRecording" | "logPrompt" | "updatePrompt" | "setOptIn">;
  createStt: typeof createStt;
  speak: typeof speak;
  agent: (who: Who) => Pick<HomieAgent, "intro" | "decide" | "endQuestions" | "yesNo" | "setWho">;
  translate: typeof translate;
  rules: PaceRules;
  glasses?: { url: string; secret: string };
};

const LIVE: RecordingDeps = {
  convex,
  createStt,
  speak,
  agent: (who) => new HomieAgent(who),
  translate,
  rules: env.homieDemo ? DEMO : NORMAL,
  glasses: env.glassesUrl && env.glassesSecret ? { url: env.glassesUrl, secret: env.glassesSecret } : undefined,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Waits `ms`, or less if `signal` aborts. */
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

export class Recording {
  private s!: convex.RecordingSession;
  private who!: Who;
  /** The same, with the names as written in English (for textEn). */
  private whoLatin!: Who;
  private homie!: ReturnType<RecordingDeps["agent"]>;
  private stt?: Stt;
  private mem!: Memory;
  private phase: Phase = "loading";
  /** Text messages that arrived while loading, handled once the recording is read. */
  private early: string[] = [];
  /** She tapped start and Convex is saving it: a second start does nothing, and the hello isn't said. */
  private starting = false;
  private wrapStarted = false;
  /** Her and the kid's names in her script, for the fixed lines (lines.ts). */
  private names: Promise<void> = Promise.resolve();
  private lastSpeechAt = 0;
  private turnStartedAt = 0;
  private storyInProgress = false;
  private lastDecideAt = 0;
  private decidedThrough = 0; // heard length at the last decision
  private deciding = false;
  private pending?: Pending;
  /** The end flow waits on her next turn through this. */
  private waiter?: (text: string | null) => void;
  private speaking: AbortController | null = null;
  /** The last line, while the phone plays it. */
  private playing?: AbortController;
  private muteUntil = 0;
  private frame?: Buffer;
  private timers: NodeJS.Timeout[] = [];
  private heartbeat?: NodeJS.Timeout;
  private flows: Promise<void> = Promise.resolve();
  private statuses: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(
    private ws: WebSocket,
    private token: string,
    private recordingId: string,
    private audio: AudioFormat,
    private deps: RecordingDeps = LIVE,
  ) {}

  private get pacer() {
    return this.mem.pacer;
  }

  async start() {
    try {
      this.s = await this.deps.convex.recordingSession(this.token, this.recordingId);
    } catch (err) {
      const unauthorized = err instanceof convex.Unauthorized;
      const notFound = err instanceof convex.NotFound;
      this.send({ type: "error", message: unauthorized ? "session expired" : notFound ? "no such recording" : "couldn't load the recording" });
      this.ws.close(unauthorized ? 4401 : notFound ? 4404 : 1011);
      if (!unauthorized && !notFound) console.error(err);
      return;
    }
    if (this.closed) return;
    const { recording, cook, kid } = this.s;
    if (recording.status === "ended" || recording.status === "abandoned") {
      memories.delete(this.recordingId);
      // An older socket may still think it's live (the app ended it with live.endRecording while cut off).
      open.get(this.recordingId)?.endedUnderneath();
      this.send({ type: "error", message: "this recording has ended" });
      this.ws.close(4404);
      return;
    }
    // Her token owns this recording (Convex checked), so this socket takes over from any older one.
    open.get(this.recordingId)?.replaced();
    open.set(this.recordingId, this);
    this.mem = memoryOf(this.recordingId, this.deps.rules, recording.status === "intro");
    this.decidedThrough = this.mem.heard.length; // what she said before a reconnect was already weighed

    const call = cook.relation && !cook.name.includes(cook.relation) ? `${cook.name} ${cook.relation}` : cook.name;
    const dish = this.s.dish ?? recording.dish;
    this.who = this.whoLatin = { language: recording.language, call, kid: kid?.name.split(" ")[0], dish };
    this.homie = this.deps.agent(this.who);
    this.names = this.who.language === "en" ? Promise.resolve() : this.nativeNames();
    this.stt = this.deps.createStt(recording.language, {
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
    this.heartbeat = setInterval(() => void this.touch(), HEARTBEAT_MS);

    if (recording.status === "intro") {
      this.setPhase("intro");
      this.flow(() => this.intro());
    } else {
      this.mem.t0 = recording.startedAt ?? this.mem.t0 ?? Date.now();
      if (recording.status === "recording") {
        // Back after a drop: listen a while before deciding anything.
        this.lastDecideAt = Date.now();
        this.enterRecording();
      } else {
        this.setPhase("wrapping_up");
        this.flow(() => this.wrapUp());
      }
    }
    for (const text of this.early.splice(0)) this.control(text);
  }

  /** From the app: binary = mic audio, text = a JSON message. */
  onMessage(data: WebSocket.RawData, isBinary: boolean) {
    if (isBinary) {
      // Half duplex: homie never hears itself (the phone sends silence then too).
      if (!this.speaking && Date.now() >= this.muteUntil) this.stt?.send(data as Buffer);
      return;
    }
    if (this.phase !== "loading") this.control(data.toString());
    else if (this.early.length < 20) this.early.push(data.toString());
  }

  private control(raw: string) {
    let msg: { type?: string; text?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "start") void this.begin();
    else if (msg.type === "done") this.done();
    else if (msg.type === "text" && typeof msg.text === "string" && msg.text) {
      this.turnStartedAt = Date.now();
      this.heard(msg.text);
    } else if (msg.type === "not_now" && this.pending) this.drop("not_now");
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (open.get(this.recordingId) === this) open.delete(this.recordingId);
    if (this.mem) this.mem.usedAt = Date.now();
    this.stt?.close();
    this.speaking?.abort();
    this.playing?.abort();
    for (const t of this.timers) clearInterval(t);
    clearInterval(this.heartbeat);
    if (this.pending?.dropTimer) clearTimeout(this.pending.dropTimer);
    this.waiter?.(null);
  }

  /** A newer socket for the same recording took over (this one was most likely already dead). */
  private replaced() {
    this.send({ type: "error", message: "this recording was opened on another connection" });
    this.ws.close(4409);
    this.close();
  }

  /**
   * Convex says the recording is over while this socket still serves it: the app ended it with
   * live.endRecording while it couldn't reach us (or it was abandoned). Stop now and quietly: nothing more
   * is said or written, the phone gets phase "ended", and the socket closes with 4404.
   */
  private endedUnderneath() {
    if (this.closed || this.phase === "ended") return;
    memories.delete(this.recordingId);
    this.hush();
    if (this.pending?.dropTimer) clearTimeout(this.pending.dropTimer);
    this.pending = undefined;
    this.setPhase("ended");
    this.state("quiet");
    this.ws.close(4404);
    this.close();
  }

  /** For a failed Convex write: a recording that's over ends this socket; anything else is only logged. */
  private failed(what: string) {
    return (err: unknown) => {
      if (err instanceof convex.Ended) this.endedUnderneath();
      else console.warn(what, (err as Error).message);
    };
  }

  // ---- phases ----

  private async intro() {
    this.state("thinking");
    let line = this.mem.intro;
    if (!line) {
      // Claude writes the names in her script itself; the hand-written fallback waits for them.
      const written = this.homie.intro().catch((err) => (console.warn("intro", err.message), null));
      line = (await Promise.race([written, sleep(INTRO_WAIT_MS).then(() => null)])) ?? (await this.names, await fixedLine("intro", this.who, this.whoLatin));
      this.mem.intro = line;
    }
    // She may have tapped start or done while it was being written: then there's no hello.
    if (this.closed || this.phase !== "intro" || this.starting) return;
    this.mem.introAt = Date.now();
    await this.say(line, "intro");
    if (this.phase === "intro" && !this.starting) this.state("quiet");
  }

  /** Names in her script ("रजनी आजी"), so Sonic says them the way she does. */
  private async nativeNames() {
    const [call, kid] = await Promise.all([
      this.deps.translate(this.who.call, this.who.language).catch(() => ""),
      this.who.kid ? this.deps.translate(this.who.kid, this.who.language).catch(() => "") : Promise.resolve(""),
    ]);
    this.who = { ...this.who, call: call || this.who.call, kid: kid || this.who.kid };
    this.homie.setWho(this.who);
  }

  private async begin() {
    // Checked and set before the first await, so a second start (or one after done) does nothing.
    if (this.phase !== "intro" || this.starting) return;
    this.starting = true;
    this.hush(); // she's ready: stop the hello
    let startedAt: number | undefined;
    try {
      ({ startedAt } = await this.saveStatus("recording"));
    } catch (err) {
      this.failed("live/status")(err);
    }
    // Done while that was saving went straight to the end; a closed socket (or an ended recording) stops here.
    if (this.closed || this.phase !== "intro") return;
    this.mem.t0 = startedAt ?? Date.now();
    this.enterRecording();
  }

  private enterRecording() {
    this.setPhase("recording");
    this.state("quiet");
    this.logIntro();
    this.timers.push(setInterval(() => void this.tick(), TICK_MS));
    if (this.deps.glasses) this.timers.push(setInterval(() => void this.pullFrame(), FRAME_EVERY_MS));
  }

  /** The hello is logged once filming starts (once per recording), so its atS (negative) is on the video's clock. */
  private logIntro() {
    const { intro, introAt, t0 } = this.mem;
    if (!intro || introAt === undefined || t0 === undefined || this.mem.introLogged) return;
    this.mem.introLogged = true;
    void this.log("intro", intro, "spoken", (introAt - t0) / 1000);
  }

  /** "I'm done": stop what homie is saying and drop its question now, then the end flow. */
  private done() {
    if (this.phase !== "intro" && this.phase !== "recording") return;
    this.setPhase("wrapping_up");
    this.hush();
    if (this.pending) this.drop("ignored");
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.mem.t0 ??= Date.now();
    this.logIntro();
    void this.saveStatus("wrapping_up").catch(this.failed("live/status"));
    this.flow(() => this.wrapUp());
  }

  /**
   * The last questions, the stories opt-in and the goodbye. If the socket closes partway, it stops without
   * writing anything more and leaves Convex at wrapping_up; her reconnect finishes what's left.
   */
  private async wrapUp() {
    if (this.wrapStarted || this.closed) return;
    this.wrapStarted = true;
    this.state("thinking");
    await this.names;
    const first = this.mem.endAsked === 0;
    const questions = await this.homie
      .endQuestions(this.mem.heard, this.mem.asked, this.pacer.rules.maxEnd - this.mem.endAsked)
      .catch((err) => (console.warn("end questions", err.message), []));
    for (const [i, q] of questions.entries()) {
      let line = q.line;
      if (i === 0 && first) {
        const pre = await fixedLine(questions.length > 1 ? "beforeYouGo2" : "beforeYouGo1", this.who, this.whoLatin);
        line = { text: `${pre.text} ${line.text}`, textEn: `${pre.textEn} ${line.textEn}` };
      }
      await this.askAndWait("end", line);
      if (this.closed) return;
    }

    if (!this.mem.optInDone) {
      const optIn = await fixedLine("optIn", this.who, this.whoLatin);
      const reply = await this.askAndWait("optin", optIn);
      if (this.closed && !reply) return;
      const yes = reply ? await this.homie.yesNo(reply).catch(() => null) : null;
      if (yes !== null) {
        // Her answer counts even if the socket closed while we read it.
        this.mem.optInDone = true;
        await this.deps.convex.setOptIn(this.token, this.recordingId, yes).catch((err) => console.warn("live/optin", err.message));
      }
      if (this.closed) return;
    }

    const closing = await fixedLine("closing", this.who, this.whoLatin);
    if (this.closed) return;
    await this.say(closing, "closing");
    if (this.closed) return; // she may not have heard the goodbye: a reconnect says it again
    void this.log("closing", closing, "spoken");
    this.setPhase("ended");
    this.state("quiet");
    this.stt?.close();
    clearInterval(this.heartbeat);
    memories.delete(this.recordingId);
    // Already ended underneath (the app's stop button) is fine: that's where this was going.
    await this.saveStatus("ended").catch(this.failed("live/status"));
  }

  /** An end question: ask, wait for her next turn (or ~15 s), log the answer. Returns her words. */
  private async askAndWait(kind: "end" | "optin", line: Line): Promise<string | null> {
    if (this.closed) return null;
    const promptId = await this.log(kind, line, "spoken");
    if (this.closed || !promptId) {
      // The socket closed while it was being saved: she never heard it. (No id: the recording was over.)
      if (promptId) void this.deps.convex.updatePrompt(this.token, promptId, "ignored").catch(() => {});
      return null;
    }
    if (kind === "end") {
      this.mem.endAsked++;
      this.mem.asked.push(line.textEn);
    }
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
    if (this.closed) return null; // no answer because the socket closed: nothing to record
    this.send({ type: "drop", promptId });
    void this.deps.convex.updatePrompt(this.token, promptId, reply ? "not_now" : "ignored").catch(() => {});
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
    this.lastSpeechAt = this.mem.usedAt = Date.now();
    this.send({ type: "transcript", text, final: true });
    this.mem.heard.push({ atS: this.atS(this.turnStartedAt || Date.now()), text });
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
    const transcriptEn = this.who.language === "en" ? undefined : await this.deps.translate(transcript, "en").catch(() => undefined);
    await this.deps.convex
      .updatePrompt(this.token, promptId, "answered", { transcript, transcriptEn: transcriptEn || undefined, atS, endS })
      .catch((err) => console.warn("live/prompt-update", err.message));
  }

  // ---- deciding ----

  private async tick() {
    if (this.phase !== "recording" || this.deciding || this.speaking || this.pending || this.closed) return;
    const now = Date.now();
    if (now - this.lastSpeechAt < QUIET_MS || now - this.lastDecideAt < DECIDE_EVERY_MS) return;
    const nowS = this.atS(now);
    // Never ask while she's telling a story: that rule is code, like the rest of the pacing.
    const mayAsk = this.pacer.mayAsk(nowS) && !this.storyInProgress;
    const fresh = this.mem.heard.slice(this.decidedThrough);
    const maybeStory = this.storyInProgress || fresh.reduce((n, h) => n + words(h.text), 0) >= STORY_CHECK_WORDS;
    if (!mayAsk && !maybeStory) return;
    this.deciding = true;
    this.lastDecideAt = now;
    this.decidedThrough = this.mem.heard.length;
    try {
      const d = await this.homie.decide({
        heard: this.mem.heard,
        asked: this.mem.asked,
        nowS,
        mayAsk,
        mayReact: maybeStory && now - this.mem.reactedAt > 90_000,
        frame: this.frame,
      });
      console.log(`homie decide at ${nowS.toFixed(0)}s (mayAsk=${mayAsk}): ${d.action}${d.action === "quiet" ? ` story=${d.storyInProgress}` : ` ${d.line.textEn}`}`);
      // She may have started talking (or said she's done) while we thought; then stay quiet.
      if (this.closed || this.phase !== "recording" || Date.now() - this.lastSpeechAt < QUIET_MS) return;
      if (d.action === "quiet") this.storyInProgress = d.storyInProgress;
      else if (d.action === "react") {
        this.storyInProgress = false;
        this.mem.reactedAt = Date.now();
        this.flow(async () => {
          if (this.closed || this.phase !== "recording") return;
          await this.say(d.line, "reaction");
          if (!this.closed) void this.log("reaction", d.line, "spoken");
        });
      } else this.flow(() => this.ask(d.kind, d.line));
    } catch (err) {
      console.warn("homie decide", (err as Error).message);
    } finally {
      this.deciding = false;
    }
  }

  private async ask(kind: AskKind, line: Line) {
    if (this.closed || this.phase !== "recording") return;
    this.pacer.onAsk(this.atS(Date.now()));
    this.mem.asked.push(line.textEn);
    const promptId = await this.log(kind, line, "spoken");
    if (this.closed || this.phase !== "recording" || !promptId) {
      // The socket closed, or she said she's done, while it was being saved: it's never said.
      if (this.mem.asked.at(-1) === line.textEn) this.mem.asked.pop();
      if (promptId) void this.deps.convex.updatePrompt(this.token, promptId, "ignored").catch(() => {});
      return;
    }
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
    void this.deps.convex.updatePrompt(this.token, p.promptId, status).catch((err) => console.warn("live/prompt-update", err.message));
  }

  private async pullFrame() {
    const glasses = this.deps.glasses;
    if (!glasses) return;
    try {
      const res = await fetch(`${glasses.url}/frame/latest?recording=${encodeURIComponent(this.recordingId)}`, {
        headers: { "x-glasses-secret": glasses.secret },
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

  // ---- speaking, Convex and the socket ----

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
      await this.deps.speak(line.text, this.audio, ctrl.signal, (chunk) => {
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
    // The phone is still playing it; hush() can cut that short too.
    this.playing = ctrl;
    await pause(playEnd - Date.now(), ctrl.signal);
    if (this.playing === ctrl) this.playing = undefined;
    if (!this.speaking) this.state(this.phase === "ended" ? "quiet" : "listening");
  }

  /** Stop homie now: the line Sonic is still making, or the one the phone is still playing (an extra say_end). */
  private hush() {
    if (this.playing && !this.playing.signal.aborted && Date.now() < this.muteUntil) this.send({ type: "say_end", interrupted: true });
    this.speaking?.abort();
    this.playing?.abort();
    this.muteUntil = 0;
  }

  /** Saves one of homie's lines; null when Convex says the recording is over (this socket then ends). */
  private log(kind: convex.PromptKind, line: Line, status: convex.PromptStatus, atS = this.atS(Date.now())): Promise<string | null> {
    return this.deps.convex
      .logPrompt(this.token, this.recordingId, { kind, text: line.text, textEn: line.textEn, atS, status })
      .then((r) => r.promptId)
      .catch((err) => {
        if (err instanceof convex.Ended) return (this.endedUnderneath(), null);
        console.warn("live/prompt", err.message);
        return `unsaved-${Date.now()}`;
      });
  }

  /** Status writes go out one at a time, in order, so "recording" can't land after "wrapping_up". */
  private saveStatus(status: "recording" | "wrapping_up" | "ended") {
    const write = this.statuses.then(() => this.deps.convex.setRecordingStatus(this.token, this.recordingId, status));
    this.statuses = write.catch(() => {});
    return write;
  }

  /** The heartbeat: a long cook isn't idle. */
  private async touch() {
    this.mem.usedAt = Date.now();
    await this.deps.convex.touchRecording(this.token, this.recordingId).catch(this.failed("live/status touch"));
  }

  private atS(ms: number) {
    return this.mem.t0 === undefined ? 0 : Math.round((ms - this.mem.t0) / 100) / 10;
  }

  private setPhase(phase: Exclude<Phase, "loading">) {
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
