// homie while a cook records (/record, STACK.md "homie while recording"). The phone by the stove
// streams the mic; we transcribe it in her language (stt.ts), and every few seconds, when the pacing
// allows and she's quiet, homie decides whether to ask one short question (homie.ts). Phases:
// intro (the hello) → recording ({type:"start"}) → wrapping_up ({type:"done"}: how many questions are left, the
// last questions and the stories opt-in back to back, the plate photo, goodbye) → ended. Status and every line
// homie says go to Convex (/live/*).
// What homie knows about a recording (pacing, what it asked, what she said, the hello) is kept per
// recording, so a dropped socket picks up where it left off instead of starting over. A recording the
// app ended while it couldn't reach us (live.endRecording) ends its socket quietly at the next Convex write.
// Filmed in the app (`{type:"start", camera:true}`, STACK.md "homie while recording"): the socket stays open
// while the phone's camera films. The phone sends a small still about every 5 s ({type:"frame", jpeg}) in
// place of the glasses' picture; {type:"pause"} when the camera stopped (she left the app, a call, the lock:
// homie goes quiet) and {type:"resume", gapS} when it films again, so every atS stays on the video's clock
// (wall time minus the seconds the video doesn't have). At the end homie asks for a photo of the plate
// ({type:"ask", kind:"plate"}); the phone takes it and answers {type:"plate", ok}. Each line homie says is
// saved with `said` (when its voice played), so the pipeline can lower or cut it in the video.
// The wrap-up waits for her (Caleb, Oct 24: "you have to give time for the person to actually respond"): homie never
// starts a line while she talks, her answer is every turn until she's been quiet a while (listen), "not now" (the
// card's tap, or said) skips just that question, and a question she doesn't answer gets one "still there?" and then
// a kind let-off, after which homie asks nothing more. Every wait counts from when the phone has played the line.
// homie first says how many questions it has (Caleb, Oct 25: so she "can expect how long they need to stay"), and the
// app keeps homie big in the middle until they're over ({type:"hold"}: "homie should STAY in center expanded view
// until all questions are finished").
import WebSocket from "ws";
import * as convex from "./convex.js";
import { env } from "./env.js";
import { callOf } from "./family.js";
import { HomieAgent, isNotNow, translate, type AskKind, type Heard, type Line, type Who } from "./homie.js";
import { rms, VOICE_RMS } from "./inkWhisper.js";
import { countLine, fixedLine, scriptedOf, scriptedQuestion } from "./lines.js";
import { DEMO, NORMAL, Pacer, SCRIPTED, type PaceRules } from "./pacing.js";
import { SONIC_SAMPLE_RATE, type AudioFormat } from "./sonic.js";
import { createStt, speak, speakingSeconds } from "./speech.js";
import { sttEngine, type Stt, type SttEngine } from "./stt.js";

/** `loading` is ours only (the app never sees it): messages wait until the recording is read. */
type Phase = "loading" | "intro" | "recording" | "wrapping_up" | "ended";
type Pending = { promptId: string; line: Line; dropTimer?: NodeJS.Timeout };

const TICK_MS = 2000;
const QUIET_MS = 3000; // never ask while she's talking
const DECIDE_EVERY_MS = 15_000;
const STORY_CHECK_WORDS = 25; // outside the ask window, a long turn may be a story worth a reaction
const DROP_MS = 10_000;
const INTRO_WAIT_MS = 7000; // then the hand-written hello
const FRAME_EVERY_MS = 5000;
const FRAME_FRESH_MS = 20_000; // an older picture isn't shown to Claude
const FRAME_MAX_BYTES = 800_000;
const PLATE_WAIT_MS = 75_000; // for the phone's plate photo (or her "not now")
const MAX_GAP_S = 4 * 3600;
const HEARTBEAT_MS = 10 * 60_000; // Convex abandons a recording nobody touched for 2 h
const MEMORY_TTL_MS = 3 * 3600_000;

// ---- the wrap-up's turn-taking (listen, untilQuiet) ----
/**
 * After a wrap-up question has finished playing on the phone: this long with no word from her and homie checks she's
 * still there; as long again after that line has played and homie lets her off (Caleb's 5 s and 5 s, Oct 24).
 */
export const SILENT_MS = 5000;
/**
 * Her answer is over once no new words have come for this long and no turn is still open, so several turns join into
 * one answer and a pause to think doesn't end it. Counted from her last words as the speech-to-text shows them, so it
 * depends on the engine's lag. Ink 2 (English) shows words ~0.3 s after she says them: 3.5 s ≈ 3.8 s of real quiet,
 * room for the 2–3 s an older cook stops to think mid-answer (an Oct 24 live run with 3 s cut a 3 s pause: her
 * resumed voice reached the mic 0.15 s too late). ink-whisper's pieces come up to ~1.3 s late, but its turn stays
 * open while the mic still hears her (inkWhisper.ts), so 3.5 s holds there too. Gemini Live (Odia; Marathi until Oct 26) shows her
 * last words ~1.2 s after she stops (its turn ends 1.5 s after that: the 2.7 s measured end to end) and the first
 * words of a resumed sentence ~1 s late, so it gets 4 s: ~5.2 s of real quiet, room for a ~4 s pause.
 */
export const ANSWER_GAP_MS: Record<SttEngine, number> = { "ink-2": 3500, "ink-whisper": 3500, "gemini-live": 4000 };
export const answerGapMs = (language: string) => ANSWER_GAP_MS[sttEngine(language)];
/** A turn the speech-to-text opened and never closed (a dropped stream) stops holding her answer after this long. */
const STUCK_TURN_MS = 6000;
/** Sound on the mic holds the answer (and the nudge) this long: her words may still be on their way. */
const SOUND_HOLD_MS = 1500;
/**
 * ...but this long with sound, or with turns the speech-to-text opens and ends empty, and no words is the kitchen
 * (a fan, the sink), not her: it stops holding. The trade-off: during a run of empty turns (Ink on the range hood),
 * a real turn of hers that starts within it gets no hold until its first words show (~0.3 s on Ink).
 */
const NOISE_MS = 4000;
/** One answer ends by this long after the question played, at the latest: under the app's 120 s wrap-up stall. */
const ANSWER_MAX_MS = 100_000;
/** Before each wrap-up line homie waits for her to stop talking (she may be talking to family), at most this long. */
const QUIET_MAX_MS = 30_000;
/** Her speech-to-text has shown nothing at all (no key, an error): no "still there?", just this long a wait. */
const NO_STT_WAIT_MS = 15_000;
const POLL_MS = 100;
/**
 * The phone plays a line only once it has all of it (say_end: lib/live/homie.ts flushSay writes a WAV and loads
 * the player), so it starts about this long after say_end, not with the first chunk.
 */
export const PLAYER_LOAD_MS = 250;

/**
 * One wrap-up question's answer while homie waits on it (listen). The card's tap counts from the ask on; a spoken turn
 * counts only if its words came after the question `played` (the mic is muted while homie speaks, so a turn ending
 * during the line is talk from before it: an afterthought, family).
 */
type Answer = { turns: string[]; from: number; to: number; notNow: boolean; played: number };

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
  /** The hello's voice, wall-clock ms (logged with the hello once t0 is known). */
  introSaid?: { start: number; end: number };
  reactedAt: number;
  /** The end questions, written once (a reconnect asks the rest of these, so the count line stays true). */
  endPlan?: { kind: AskKind; line: Line }[];
  endAsked: number;
  /** The wrap-up's count line has been said (a reconnect doesn't say it again). */
  counted: boolean;
  /** The opt-in was asked and its wait is over (answered, skipped or not): it isn't asked again. */
  optInDone: boolean;
  /** She didn't answer a wrap-up question even after "still there?": homie asks nothing more (the plate is a tap). */
  letOff: boolean;
  /** Her speech-to-text has shown something in this recording (a turn, words): it works. */
  sttHeard: boolean;
  /** Filmed with the phone's camera in the app: it sends frames, can pause, and takes the plate photo. */
  camera: boolean;
  /** Seconds of wall time since t0 that the video doesn't have (paused, between clips): off every atS. */
  gapS: number;
  /** The camera is stopped right now (she left the app): homie asks nothing. */
  paused: boolean;
  plateDone: boolean;
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
  const m: Memory = {
    pacer: new Pacer(rules),
    asked: [],
    heard: [],
    intro: old?.intro,
    introLogged: false,
    reactedAt: 0,
    endAsked: 0,
    counted: false,
    optInDone: false,
    letOff: false,
    sttHeard: old?.sttHeard ?? false,
    camera: false,
    gapS: 0,
    paused: false,
    plateDone: false,
    usedAt: now,
  };
  memories.set(recordingId, m);
  return m;
}

/**
 * What the wrap-up's count line counts (lines.ts countLine): the spoken questions left, `endLeft` end questions and then
 * the stories opt-in (none after a let-off), and whether the plate photo comes (filmed in the app, not taken yet).
 */
export function wrapUpCount(endLeft: number, m: Pick<Memory, "optInDone" | "letOff" | "camera" | "plateDone">) {
  return { questions: m.letOff ? 0 : endLeft + (m.optInDone ? 0 : 1), photo: m.camera && !m.plateDone };
}

/** What a Recording talks to. Tests pass fakes. */
export type RecordingDeps = {
  convex: Pick<typeof convex, "recordingSession" | "setRecordingStatus" | "touchRecording" | "logPrompt" | "updatePrompt" | "promptSaid" | "setOptIn">;
  createStt: typeof createStt;
  speak: typeof speak;
  agent: (who: Who) => Pick<HomieAgent, "intro" | "decide" | "endQuestions" | "yesNo" | "setWho">;
  translate: typeof translate;
  rules: PaceRules;
  /** HOMIE_SCRIPTED: when the pacing allows a question, ask the next fixed one instead of asking Claude. */
  scripted?: boolean;
  glasses?: { url: string; secret: string };
};

const LIVE: RecordingDeps = {
  convex,
  createStt,
  speak,
  agent: (who) => new HomieAgent(who, { fallback: scriptedOf }),
  translate,
  rules: env.homieScripted ? SCRIPTED : env.homieDemo ? DEMO : NORMAL,
  scripted: env.homieScripted,
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
  /** Her speech-to-text's last event of any kind (a turn starting, its words so far, its end). */
  private lastSpeechAt = 0;
  private turnStartedAt = 0;
  /** A turn has started and not ended; `turnWords` = its words so far. */
  private turnOpen = false;
  private turnWords = "";
  /** When her last words showed up (a partial, or a turn that had none); the wrap-up counts its quiet from this. */
  private lastWordsAt = 0;
  /** Since when the speech-to-text has opened turns with no words in them (0: it showed words since). */
  private noiseSince = 0;
  /** The speech-to-text's last event, and its last error: an error with nothing after it means it's down. */
  private sttAt = 0;
  private sttErrorAt = 0;
  /** In the wrap-up: the mic's last loud chunk, and when that stretch of sound began. */
  private soundAt = 0;
  private soundSince = 0;
  /** The mic's loudest chunk (RMS) in this wait: logged, so phone runs can tune VOICE_RMS. */
  private loudest = 0;
  /** homie's "still there?" and let-off in her language, made once per wrap-up. */
  private spare?: Promise<{ stillThere: Line; letOff: Line }>;
  /** This socket told the app to keep homie big in the middle ({type:"hold", on:true}) while the questions run. */
  private holding = false;
  /** Quiet after her last words that ends a wrap-up answer, for her speech-to-text (ANSWER_GAP_MS). */
  private gapMs = ANSWER_GAP_MS["ink-2"];
  private storyInProgress = false;
  private lastDecideAt = 0;
  private decidedThrough = 0; // heard length at the last decision
  private deciding = false;
  private pending?: Pending;
  /** While a wrap-up question is up (from its ask), every turn she finishes goes in here (listen). */
  private answer?: Answer;
  private speaking: AbortController | null = null;
  /** The last line, while the phone plays it. */
  private playing?: AbortController;
  /** The mic is ignored until then; the phone should be playing homie's last line until `playingUntil`. */
  private muteUntil = 0;
  private playingUntil = 0;
  private frame?: Buffer;
  private frameAt = 0;
  /** The plate step waits on the phone's {type:"plate"} through this. */
  private plateWaiter?: (ok: boolean) => void;
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

    const call = callOf(cook.name, cook.relation) ?? cook.name;
    const dish = this.s.dish ?? recording.dish;
    this.who = this.whoLatin = { language: recording.language, call, kid: kid?.name.split(" ")[0], dish };
    this.homie = this.deps.agent(this.who);
    this.names = this.who.language === "en" ? Promise.resolve() : this.nativeNames();
    this.gapMs = answerGapMs(recording.language);
    this.stt = this.deps.createStt(recording.language, {
      onTurnStart: () => this.onTurnStart(),
      onPartial: (text) => this.onPartial(text),
      onTurnEnd: (text) => this.onTurnEnd(text),
      onError: (message) => {
        this.sttErrorAt = Date.now();
        console.warn(`stt: ${message}`);
      },
    }, [dish, cook.name, kid?.name].filter((x): x is string => !!x));
    this.send({ type: "ready", recording: { id: recording._id, language: recording.language, cookName: call, kidName: this.who.kid, dish } });
    console.log(`record start: ${call}, ${recording.language}, ${recording.status}, met before=${this.s.metBefore === true}, stub=${convex.usingStub}, demo=${env.homieDemo}`);
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
        this.holdForQuestions(); // back in the middle of the questions: homie stays big from the first message
        this.flow(() => this.wrapUp());
      }
    }
    for (const text of this.early.splice(0)) this.control(text);
  }

  /** From the app: binary = mic audio, text = a JSON message. */
  onMessage(data: WebSocket.RawData, isBinary: boolean) {
    if (isBinary) {
      // Half duplex: homie never hears itself (the phone sends silence then too).
      if (this.speaking || Date.now() < this.muteUntil) return;
      this.stt?.send(data as Buffer);
      if (this.phase === "wrapping_up") this.onSound(data as Buffer);
      return;
    }
    if (this.phase !== "loading") this.control(data.toString());
    else if (this.early.length < 20) this.early.push(data.toString());
  }

  private control(raw: string) {
    let msg: { type?: string; text?: unknown };
    try {
      msg = JSON.parse(raw) ?? {}; // "null" parses, and reading .type off it used to end the whole process
    } catch {
      return;
    }
    if (msg.type === "start") {
      if ((msg as { camera?: unknown }).camera === true) this.mem.camera = true;
      void this.begin();
    } else if (msg.type === "done") this.done();
    else if (msg.type === "frame") this.onFrame((msg as { jpeg?: unknown }).jpeg);
    else if (msg.type === "pause") this.pauseFilming();
    else if (msg.type === "resume") this.resumeFilming((msg as { gapS?: unknown }).gapS);
    else if (msg.type === "plate") this.plateWaiter?.((msg as { ok?: unknown }).ok === true);
    else if (msg.type === "text" && typeof msg.text === "string" && msg.text) {
      // Typed (the app's "not now" tap on a wrap-up question is sent this way): words, but not speech.
      this.heard(msg.text, Date.now(), true);
    } else if (msg.type === "not_now") {
      if (this.answer) this.skipAsk();
      else if (this.pending) this.drop("not_now");
    }
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
    this.plateWaiter?.(false);
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
    this.hold(false);
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
      // Claude writes the names in her script itself; the hand-written fallback waits for them. A cook
      // homie has recorded with before gets a welcome back, not the introduction again.
      const again = this.s.metBefore === true;
      const written = this.homie.intro(again).catch((err) => (console.warn("intro", err.message), null));
      line = (await Promise.race([written, sleep(INTRO_WAIT_MS).then(() => null)])) ?? (await this.names, await fixedLine(again ? "introAgain" : "intro", this.who, this.whoLatin, this.deps.translate));
      this.mem.intro = line;
    }
    // She may have tapped start or done while it was being written: then there's no hello.
    if (this.closed || this.phase !== "intro" || this.starting) return;
    this.mem.introAt = Date.now();
    const said = await this.say(line, "intro");
    if (said) this.mem.introSaid = said;
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
    const { intro, introAt, introSaid, t0 } = this.mem;
    if (!intro || introAt === undefined || t0 === undefined || this.mem.introLogged) return;
    this.mem.introLogged = true;
    void this.log("intro", intro, "spoken", (introAt - t0) / 1000, introSaid && this.span(introSaid));
  }

  /** "I'm done": stop what homie is saying and drop its question now, then the end flow. */
  private done() {
    if (this.phase !== "intro" && this.phase !== "recording") return;
    this.setPhase("wrapping_up");
    this.hush();
    this.holdForQuestions(); // before the live card's drop, so homie never shrinks and grows again
    if (this.pending) this.drop("ignored");
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.mem.t0 ??= Date.now();
    this.logIntro();
    void this.saveStatus("wrapping_up").catch(this.failed("live/status"));
    this.flow(() => this.wrapUp());
  }

  /**
   * The end, in this order: the count line ("Before we send it, two quick questions and a photo of your plate."), the
   * end questions and the stories opt-in back to back, then (filmed in the app) the plate photo, and the goodbye. The
   * app keeps homie big in the middle from just before the count line until the next line after the last question
   * (hold). If the socket closes partway, it stops without writing anything more and leaves Convex at wrapping_up; her
   * reconnect finishes what's left (the same questions, with no second count line). After a let-off (she didn't
   * answer, even after "still there?") homie asks nothing more: the plate photo (a tap), then goodbye.
   */
  private async wrapUp() {
    if (this.wrapStarted || this.closed) return;
    this.wrapStarted = true;
    this.state("thinking");
    await this.names;
    // Made now (translated, in most languages) so homie never goes deaf to make one, and the count line for every
    // number it may come to, while Claude writes the questions.
    void this.spareLines();
    const optInLine = fixedLine("optIn", this.who, this.whoLatin, this.deps.translate);
    const { questions: most, photo } = wrapUpCount(this.pacer.rules.maxEnd - this.mem.endAsked, this.mem);
    const counts = new Map<number, Promise<Line | null>>();
    for (let n = 1; n <= most && !this.mem.counted; n++) counts.set(n, countLine(n, photo, this.who, this.whoLatin, this.deps.translate));
    const questions = await this.endLeft();
    if (this.closed) return;
    const spoken = wrapUpCount(questions.length, this.mem).questions;
    if (spoken) this.hold(true); // already on since done (holdForQuestions)
    if (!this.mem.counted) {
      const count = await (counts.get(spoken) ?? countLine(spoken, photo, this.who, this.whoLatin, this.deps.translate));
      if (count) {
        await this.untilQuiet();
        await this.sayFixed(count);
        if (this.closed) return; // she may not have heard it: a reconnect says it again
      }
      this.mem.counted = true;
    }

    for (const q of questions) {
      await this.askAndWait("end", q.line);
      if (this.closed) return;
      if (this.mem.letOff) break;
    }

    // Unanswered (a let-off included), the opt-in stays unset.
    if (!this.mem.optInDone && !this.mem.letOff) {
      const reply = await this.askAndWait("optin", await optInLine);
      if (this.closed && !reply) return; // she may not have heard it: a reconnect asks again
      // Asked: a reconnect never asks it again (that would be one more than the count line said).
      this.mem.optInDone = true;
      // Her answer counts even if the socket closed while we read it.
      const yes = reply ? await this.homie.yesNo(reply).catch(() => null) : null;
      if (yes !== null) await this.deps.convex.setOptIn(this.token, this.recordingId, yes).catch((err) => console.warn("live/optin", err.message));
      if (this.closed) return;
    }

    // The questions are over; the hold ends with the next line. Filmed in the app: a photo of the plate for the
    // cover. The phone takes it; she can skip it.
    if (photo) {
      await this.plate();
      if (this.closed) return;
    }

    const closing = await fixedLine("closing", this.who, this.whoLatin, this.deps.translate);
    await this.untilQuiet();
    if (this.closed) return;
    this.hold(false);
    const closingSaid = await this.say(closing, "closing");
    if (this.closed) return; // she may not have heard the goodbye: a reconnect says it again
    void this.log("closing", closing, "spoken", undefined, closingSaid && this.span(closingSaid));
    this.setPhase("ended");
    this.state("quiet");
    this.stt?.close();
    clearInterval(this.heartbeat);
    memories.delete(this.recordingId);
    // Already ended underneath (the app's stop button) is fine: that's where this was going.
    await this.saveStatus("ended").catch(this.failed("live/status"));
  }

  /**
   * The end questions still to ask. Claude writes them once per recording (mem.endPlan), so a reconnect asks the rest
   * of the same ones and what the count line said stays true. None after a let-off.
   */
  private async endLeft() {
    if (this.mem.letOff) return [];
    if (!this.mem.endPlan) {
      const plan = await this.homie
        .endQuestions(this.mem.heard, this.mem.asked, this.pacer.rules.maxEnd - this.mem.endAsked)
        .catch((err) => (console.warn("end questions", err.message), []));
      if (this.closed) return []; // the reconnect writes its own
      this.mem.endPlan = plan;
    }
    return this.mem.endPlan.slice(this.mem.endAsked);
  }

  /**
   * {type:"hold"}: on, the app keeps homie big in the middle through the wrap-up's spoken questions, back to back
   * (Caleb, Oct 25: "homie should STAY in center expanded view until all questions are finished"); off, it goes back to
   * its corner. Never sent between a say and its say_end (an older app ends a line's audio on any other message).
   */
  private hold(on: boolean) {
    if (this.holding === on) return;
    this.holding = on;
    this.send({ type: "hold", on });
  }

  /**
   * Holds from the wrap-up's first message ("I'm done", or a reconnect into it) when a spoken question is still to
   * come: the opt-in, at least, since it comes after the end questions and only a let-off skips it. So homie doesn't
   * shrink to the corner while Claude writes the end questions.
   */
  private holdForQuestions() {
    if (!this.mem.letOff && !this.mem.optInDone) this.hold(true);
  }

  /**
   * A wrap-up question: once she isn't talking, ask, then wait for her whole answer (listen) and log it. From the ask
   * on (the card is up while homie still asks) her turns are collected, and a "not now" (the card's tap, or her first
   * words) skips this question at once. No word for SILENT_MS after it played: homie checks she's still there and
   * gives her as long again; still nothing, and homie lets her off kindly (mem.letOff: nothing more is asked). With a
   * speech-to-text that has shown nothing at all, just a plain NO_STT_WAIT_MS wait. Returns her words, or null.
   */
  private async askAndWait(kind: "end" | "optin", line: Line): Promise<string | null> {
    if (this.closed) return null;
    await this.untilQuiet();
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
    const a: Answer = { turns: [], from: 0, to: 0, notNow: false, played: 0 };
    this.answer = a;
    try {
      this.send({ type: "ask", promptId, text: line.text, textEn: line.textEn, kind });
      this.markSaid(promptId, await this.say(line, kind));
      const played = (a.played = Date.now());
      let got = await this.listen(a, this.sttWorks() ? SILENT_MS : NO_STT_WAIT_MS);
      // "Still there?" only once she's quiet; the let-off only after she has heard it. A wait that ended while she
      // may be talking (her words came meanwhile, or sound held it to its cap) is waited again, a few times at most.
      let nudged = false;
      for (let tries = 0; got === "silent" && !nudged && this.sttWorks() && tries < 3; tries++) {
        const { stillThere } = await this.spareLines();
        if (!this.closed && !a.notNow && !a.turns.length && !this.talking(Date.now())) {
          console.log(`cook quiet ${SILENT_MS / 1000}s after the ${kind} question: still there?`);
          await this.sayFixed(stillThere);
          nudged = true;
        }
        got = await this.listen(a, SILENT_MS);
      }
      if (got === "silent" && !nudged && !this.sttWorks() && Date.now() - played < NO_STT_WAIT_MS) {
        // Her speech-to-text just failed: homie can't tell whether she's talking, so it only waits.
        got = await this.listen(a, NO_STT_WAIT_MS - (Date.now() - played));
      }
      if (got === null || this.closed) return null; // the socket closed: nothing to record
      if (got === "answered") {
        this.send({ type: "answered", promptId });
        const text = a.turns.join(" ");
        void this.saveAnswer(promptId, text, a.from, a.to);
        return text;
      }
      this.send({ type: "drop", promptId });
      void this.deps.convex.updatePrompt(this.token, promptId, got === "skipped" ? "not_now" : "ignored").catch(() => {});
      if (got === "skipped") console.log(`cook said not now to the ${kind} question: skipped`);
      else if (nudged && this.sttWorks()) {
        console.log(`cook quiet after "still there?" too: letting her off`);
        this.mem.letOff = true;
        this.answer = undefined; // nothing she says now answers this question
        await this.sayFixed((await this.spareLines()).letOff);
      }
      return null;
    } finally {
      if (this.answer === a) this.answer = undefined;
    }
  }

  /** The card's "not now" (or {type:"not_now"}) while a wrap-up question is up: stop asking, skip it now. */
  private skipAsk() {
    if (!this.answer || this.answer.notNow) return;
    this.answer.notNow = true;
    this.hush();
  }

  /** homie's "still there?" and let-off in her language, made once (a translation for most languages). */
  private spareLines() {
    this.spare ??= Promise.all([fixedLine("stillThere", this.who, this.whoLatin, this.deps.translate), fixedLine("letOff", this.who, this.whoLatin, this.deps.translate)]).then(
      ([stillThere, letOff]) => ({ stillThere, letOff }),
    );
    return this.spare;
  }

  /** One of homie's own wrap-up lines, said and then saved as a reaction (no answer expected). */
  private async sayFixed(line: Line) {
    if (this.closed) return;
    const said = await this.say(line, "reaction");
    if (!this.closed) void this.log("reaction", line, "spoken", undefined, said && this.span(said));
  }

  /**
   * After homie's line has finished playing on the phone, waits for her whole answer in `a`: every turn from her first
   * words until she has been quiet for the engine's gap (talking()), so a pause to think doesn't end it and homie
   * never moves on while she talks. "silent" when she hasn't said a word in `silentMs` (sound or an open turn that may
   * be her first words holds that a little, at most NOISE_MS); "skipped" on a "not now"; null when the socket closed.
   */
  private async listen(a: Answer, silentMs: number): Promise<"answered" | "silent" | "skipped" | null> {
    const start = Date.now();
    this.loudest = 0;
    try {
      for (;; await sleep(POLL_MS)) {
        if (this.closed) return null;
        if (a.notNow) return "skipped";
        const now = Date.now();
        if (a.turns.length || this.lastWordsAt >= a.played) {
          // She has started: wait until she's done.
          if (this.talking(now) && now - start < ANSWER_MAX_MS) continue;
          // A turn the speech-to-text never closed still counts with the words it had (since the question).
          if (this.turnOpen && this.turnWords && this.lastWordsAt >= a.played) {
            a.turns.push(this.turnWords);
            a.to = this.lastWordsAt;
            this.turnWords = "";
          }
          if (a.turns.length) {
            const n = a.turns.length;
            console.log(`cook answered (${n} turn${n > 1 ? "s" : ""}): homie waited ${((now - this.lastWordsAt) / 1000).toFixed(1)}s after her last words`);
            return "answered";
          }
          // Words that came to nothing (a cough, the pan): as if she hadn't started.
        }
        const holding = this.turnHolds(now) || this.soundHolds(now);
        if (now - start >= silentMs && (!holding || now - start >= silentMs + NOISE_MS)) return "silent";
      }
    } finally {
      if (this.phase === "wrapping_up") {
        const db = (v: number) => (v > 0 ? (20 * Math.log10(v / 32768)).toFixed(1) : "-inf");
        console.log(`wrap-up mic: loudest ${Math.round(this.loudest)} rms (${db(this.loudest)} dBFS), voice above ${VOICE_RMS} (${db(VOICE_RMS)} dBFS)`);
      }
    }
  }

  /** Before each wrap-up line: wait while she's talking (at most QUIET_MAX_MS), so homie never starts over her. */
  private async untilQuiet() {
    const start = Date.now();
    while (!this.closed && this.talking(Date.now()) && Date.now() - start < QUIET_MAX_MS) await sleep(POLL_MS);
  }

  /** She's talking, or may be: a turn still open, sound on the mic, or words in the last ANSWER_GAP_MS. */
  private talking(now: number) {
    return this.turnHolds(now) || this.soundHolds(now) || now - this.lastWordsAt < this.gapMs;
  }

  /**
   * An open turn holds while its words keep coming (a stuck one stops after STUCK_TURN_MS); turns with no words yet,
   * one after another (Ink opening them on kitchen noise), hold only NOISE_MS in all.
   */
  private turnHolds(now: number) {
    if (!this.turnOpen) return false;
    return this.turnWords ? now - this.lastSpeechAt < STUCK_TURN_MS : now - this.noiseSince < NOISE_MS;
  }

  private soundHolds(now: number) {
    return now - this.soundAt < SOUND_HOLD_MS && now - Math.max(this.lastWordsAt, this.soundSince) < NOISE_MS;
  }

  /** Her speech-to-text works: it showed something in this recording, and no error since its last event. */
  private sttWorks() {
    return this.mem.sttHeard && this.sttErrorAt <= this.sttAt;
  }

  /** The mic in the wrap-up: a loud chunk may be her voice before the speech-to-text shows its words. */
  private onSound(pcm: Buffer) {
    const level = rms(pcm);
    this.loudest = Math.max(this.loudest, level);
    if (level <= VOICE_RMS) return;
    const now = Date.now();
    if (now - this.soundAt > SOUND_HOLD_MS) this.soundSince = now;
    this.soundAt = now;
  }

  /**
   * "Show me the plate": homie asks, the phone shows its camera big and takes the photo (it uploads it to
   * Convex itself, live.setCover), then sends {type:"plate", ok}, which counts from the ask on (a tap while
   * homie still talks stops the line). No answer within PLATE_WAIT_MS after the line, or "not now", is a
   * skip; a closed socket asks again on the reconnect; once answered it isn't asked again.
   */
  private async plate() {
    const line = await fixedLine("plate", this.who, this.whoLatin, this.deps.translate);
    await this.untilQuiet();
    if (this.closed) return;
    const promptId = await this.log("plate", line, "spoken");
    if (this.closed || !promptId) return;
    this.hold(false); // the questions are over: homie goes back to its corner as the camera comes up
    // The phone shows its shutter with the ask: a photo (or "not now") counts from now, even mid-line.
    let timer: NodeJS.Timeout | undefined;
    const answer = new Promise<boolean | null>((resolve) => {
      this.plateWaiter = (got) => {
        clearTimeout(timer);
        this.plateWaiter = undefined;
        if (!this.closed) this.hush();
        resolve(this.closed ? null : got);
      };
    });
    this.send({ type: "ask", promptId, text: line.text, textEn: line.textEn, kind: "plate" });
    this.markSaid(promptId, await this.say(line, "plate"));
    if (this.plateWaiter && !this.closed) timer = setTimeout(() => this.plateWaiter?.(false), PLATE_WAIT_MS);
    const ok = this.closed && this.plateWaiter ? null : await answer;
    this.plateWaiter = undefined;
    if (ok === null) return; // the socket closed: a reconnect asks again
    this.mem.plateDone = true;
    this.send({ type: ok ? "answered" : "drop", promptId });
    void this.deps.convex.updatePrompt(this.token, promptId, ok ? "answered" : "ignored").catch(() => {});
    // A spoken "not now" may be the start of more ("not now, I'll send one later"): the next line waits for the rest.
    if (!ok) return;
    const thanks = await fixedLine("plateThanks", this.who, this.whoLatin, this.deps.translate);
    await this.untilQuiet();
    if (!this.closed) await this.say(thanks, "reaction");
  }

  // ---- filming in the app ----

  /** A still from the phone's camera (base64 JPEG): homie's look at the stove, like the glasses' frame. */
  private onFrame(jpeg: unknown) {
    if (typeof jpeg !== "string" || jpeg.length > (FRAME_MAX_BYTES * 4) / 3 + 4) return;
    const buf = Buffer.from(jpeg, "base64");
    // A JPEG starts FF D8.
    if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) return;
    this.frame = buf;
    this.frameAt = Date.now();
  }

  /** The phone's camera stopped (she left the app, a call, the lock): homie stops talking and waits. */
  private pauseFilming() {
    if (this.phase !== "recording" || this.mem.paused) return;
    this.mem.paused = true;
    this.hush();
    if (this.pending) this.drop("ignored");
    this.frame = undefined;
    this.state("quiet");
    console.log(`record paused at ${this.atS(Date.now()).toFixed(0)}s`);
  }

  /** The camera films again; `gapS` = seconds since the last clip that the video doesn't have. */
  private resumeFilming(gapS: unknown) {
    if (this.phase !== "recording" && this.phase !== "intro") return;
    if (typeof gapS === "number" && Number.isFinite(gapS) && gapS > 0) this.mem.gapS = Math.min(MAX_GAP_S, this.mem.gapS + gapS);
    if (this.mem.paused) {
      this.mem.paused = false;
      this.lastDecideAt = Date.now(); // listen a while before deciding anything
      console.log(`record resumed (video is ${this.mem.gapS.toFixed(1)}s behind the clock)`);
      if (this.phase === "recording") this.state("listening");
    }
  }

  // ---- listening ----

  private onTurnStart() {
    const now = Date.now();
    // A run of turns with no words starts here, unless one is already going (it ends when words come).
    if (!this.noiseSince || now - this.lastSpeechAt > NOISE_MS) this.noiseSince = now;
    this.lastSpeechAt = this.turnStartedAt = this.sttAt = now;
    this.mem.sttHeard = true;
    this.turnOpen = true;
    this.turnWords = "";
    this.state("listening");
    // She's answering: don't fade the question while she talks.
    if (this.pending?.dropTimer) {
      clearTimeout(this.pending.dropTimer);
      this.pending.dropTimer = undefined;
    }
  }

  private onPartial(text: string) {
    this.lastSpeechAt = this.sttAt = Date.now();
    this.mem.sttHeard = true;
    if (text.trim()) {
      this.lastWordsAt = this.lastSpeechAt;
      this.turnWords = text.trim();
      this.noiseSince = 0;
    }
    this.send({ type: "transcript", text, final: false });
  }

  private onTurnEnd(text: string) {
    this.lastSpeechAt = this.sttAt = Date.now();
    this.mem.sttHeard = true;
    if (text.trim()) {
      // A turn with words but no partials (a quick "yes"): its end is the best time we have for them.
      if (!this.turnWords) this.lastWordsAt = this.lastSpeechAt;
      this.noiseSince = 0;
    } else if (this.pending && !this.pending.dropTimer) this.armDrop(this.pending); // a cough: the card fades again
    this.turnOpen = false;
    this.turnWords = "";
    this.heard(text);
  }

  /** One finished turn of hers (`typed`: a text message, such as the card's "not now" on a wrap-up question). */
  private heard(raw: string, startedAt = this.turnStartedAt, typed = false) {
    const text = raw.trim();
    // A turn with no words (a cough, the pan; Ink can end one empty) is nothing she said: it answers nothing.
    if (this.closed || this.phase === "ended" || !text) return;
    const now = Date.now();
    this.lastSpeechAt = this.mem.usedAt = now;
    this.send({ type: "transcript", text, final: true });
    this.mem.heard.push({ atS: this.atS(startedAt || now), text });
    console.log(`cook: ${text}`);
    const a = this.answer;
    // A spoken turn whose words came before the question had played is talk from before it: it answers nothing.
    if (a && (typed || (a.played && this.lastWordsAt >= a.played))) {
      // The card's tap is final; said, "not now" skips the question only as her first words (not "…later" at the end).
      if (isNotNow(text) && (typed || !a.turns.length)) return this.skipAsk();
      a.from ||= startedAt || now;
      a.to = typed ? now : this.lastWordsAt;
      a.turns.push(text);
      return;
    }
    // "Not now" while homie waits for the plate photo skips it.
    if (this.plateWaiter && isNotNow(text)) return this.plateWaiter(false);
    if (this.pending) {
      if (isNotNow(text)) return this.drop("not_now");
      const { promptId } = this.pending;
      clearTimeout(this.pending.dropTimer);
      this.pending = undefined;
      this.pacer.answered();
      this.send({ type: "answered", promptId });
      void this.saveAnswer(promptId, text, startedAt);
    }
    if (this.phase === "recording") this.state("quiet");
  }

  /** `from`/`to` = when her answer began and her last words came (a wrap-up answer can be several turns). */
  private async saveAnswer(promptId: string, transcript: string, from = this.turnStartedAt, to = Date.now()) {
    const atS = this.atS(from || Date.now());
    const endS = Math.max(atS, this.atS(to || Date.now()));
    const transcriptEn = this.who.language === "en" ? undefined : await this.deps.translate(transcript, "en").catch(() => undefined);
    await this.deps.convex
      .updatePrompt(this.token, promptId, "answered", { transcript, transcriptEn: transcriptEn || undefined, atS, endS })
      .catch((err) => console.warn("live/prompt-update", err.message));
  }

  // ---- deciding ----

  private async tick() {
    if (this.phase !== "recording" || this.mem.paused || this.deciding || this.speaking || this.pending || this.closed) return;
    const now = Date.now();
    if (now - this.lastSpeechAt < QUIET_MS || now - this.lastDecideAt < DECIDE_EVERY_MS) return;
    const nowS = this.atS(now);
    if (this.deps.scripted) {
      // The filmed demo: the next fixed question, on the clock. No Claude, so no stories or reactions.
      if (!this.pacer.mayAsk(nowS)) return;
      this.deciding = true;
      this.lastDecideAt = now;
      try {
        const q = await scriptedQuestion(this.mem.asked.length, this.who, this.whoLatin, this.deps.translate);
        console.log(`homie scripted at ${nowS.toFixed(0)}s: ${q.line.textEn}`);
        if (this.closed || this.phase !== "recording" || Date.now() - this.lastSpeechAt < QUIET_MS) return;
        this.flow(() => this.ask(q.kind, q.line));
      } finally {
        this.deciding = false;
      }
      return;
    }
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
        frame: this.frame && now - this.frameAt < FRAME_FRESH_MS ? this.frame : undefined,
      });
      console.log(`homie decide at ${nowS.toFixed(0)}s (mayAsk=${mayAsk}): ${d.action}${d.action === "quiet" ? ` story=${d.storyInProgress}` : ` ${d.line.textEn}`}`);
      // She may have started talking (or said she's done) while we thought; then stay quiet.
      if (this.closed || this.phase !== "recording" || this.mem.paused || Date.now() - this.lastSpeechAt < QUIET_MS) return;
      if (d.action === "quiet") this.storyInProgress = d.storyInProgress;
      else if (d.action === "react") {
        this.storyInProgress = false;
        this.mem.reactedAt = Date.now();
        this.flow(async () => {
          if (this.closed || this.phase !== "recording") return;
          const said = await this.say(d.line, "reaction");
          if (!this.closed) void this.log("reaction", d.line, "spoken", undefined, said && this.span(said));
        });
      } else this.flow(() => this.ask(d.kind, d.line));
    } catch (err) {
      console.warn("homie decide", (err as Error).message);
    } finally {
      this.deciding = false;
    }
  }

  private async ask(kind: AskKind, line: Line) {
    if (this.closed || this.phase !== "recording" || this.mem.paused) return;
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
    this.markSaid(promptId, await this.say(line, kind));
    // ~10 s after she heard it with no answer, the card fades (her starting to talk holds it).
    if (this.pending === pending) this.armDrop(pending);
  }

  /** The live question's card fades DROP_MS from now unless she answers. */
  private armDrop(p: Pending) {
    clearTimeout(p.dropTimer);
    p.dropTimer = setTimeout(() => this.pending === p && this.drop("ignored"), DROP_MS);
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
        if (jpeg.length < 4_000_000) {
          this.frame = jpeg;
          this.frameAt = Date.now();
        }
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
      this.hold(false);
      this.send({ type: "error", message: "homie had a problem" });
    });
  }

  /**
   * Speaks in her language with homie's voice; resolves once the phone should have finished playing it, with
   * when its voice played on the phone (wall-clock ms; cut short if it was stopped while playing), or nothing when
   * the phone never played it.
   */
  private async say(line: Line, kind: string): Promise<{ start: number; end: number } | undefined> {
    if (this.closed) return;
    if (this.speaking) this.hush(); // never two at once (flows run one by one); the old line gets its say_end
    const ctrl = new AbortController();
    this.speaking = ctrl;
    this.state("speaking");
    this.send({ type: "say", text: line.text, textEn: line.textEn, kind, ai: true, audio: { format: this.audio, encoding: "pcm_s16le", sampleRate: SONIC_SAMPLE_RATE } });
    const t0 = Date.now();
    let first = 0;
    let bytes = 0;
    let failed = false;
    try {
      await this.deps.speak(line.text, this.audio, ctrl.signal, (chunk) => {
        if (!first) {
          first = Date.now();
          console.log(`sonic first audio ${first - t0}ms (${kind})`);
        }
        bytes += chunk.length;
        if (this.ws.readyState === WebSocket.OPEN && !ctrl.signal.aborted) this.ws.send(chunk);
      }, { language: this.who.language, voice: env.homieVoice, kind });
    } catch (err) {
      if (!ctrl.signal.aborted) console.warn("sonic", (err as Error).message);
      failed = !first && !ctrl.signal.aborted;
    }
    // The phone plays a line only once it has all of it (say_end), after loading it into its player; an interrupted
    // one it never plays. A line no voice could make, it says in its own voice (say_end `failed`), about this long.
    const aborted = ctrl.signal.aborted;
    const sayEnd = Date.now();
    const length = aborted ? 0 : failed ? speakingSeconds(line.text) * 1000 : !first ? 0 : (bytes / 2 / SONIC_SAMPLE_RATE) * 1000;
    const playStart = sayEnd + PLAYER_LOAD_MS;
    const playEnd = length ? playStart + length : sayEnd;
    this.playingUntil = playEnd;
    // The phone sends silence while it plays, so this mute is only a backup. It ends when the phone can first have
    // finished (no load time), so a quick "yes" right after the line isn't cut.
    this.muteUntil = sayEnd + length;
    // A stopped line had its say_end from hush() (or its socket closed).
    if (!aborted) this.send({ type: "say_end", interrupted: false, ...(failed ? { failed: true } : {}) });
    if (this.speaking === ctrl) this.speaking = null;
    // The phone is still playing it; hush() can cut that short too.
    this.playing = ctrl;
    await pause(playEnd - Date.now(), ctrl.signal);
    if (this.playing === ctrl) this.playing = undefined;
    if (!this.speaking) this.state(this.phase === "ended" ? "quiet" : "listening");
    const end = Math.min(playEnd, Date.now());
    return first && !aborted && end > playStart ? { start: playStart, end } : undefined;
  }

  /** A wall-clock span as `said` on the recording's clock. */
  private span(s: { start: number; end: number }): convex.Said {
    return { atS: this.atS(s.start), endS: this.atS(s.end) };
  }

  /** Saves when a question's voice played (it was logged before it was said). */
  private markSaid(promptId: string, said: { start: number; end: number } | undefined) {
    if (!said || promptId.startsWith("unsaved-") || this.mem.t0 === undefined) return;
    void this.deps.convex.promptSaid(this.token, promptId, this.span(said)).catch((err) => console.warn("live/prompt-said", (err as Error).message));
  }

  /**
   * Stop homie now: the line Sonic is still making (its say_end goes now, so nothing else is sent between its say and
   * say_end), or the one the phone is still playing (an extra say_end).
   */
  private hush() {
    const making = this.speaking && !this.speaking.signal.aborted;
    if (making || (this.playing && !this.playing.signal.aborted && Date.now() < this.playingUntil)) this.send({ type: "say_end", interrupted: true });
    this.speaking?.abort();
    this.playing?.abort();
    this.muteUntil = this.playingUntil = 0;
  }

  /** Saves one of homie's lines; null when Convex says the recording is over (this socket then ends). */
  private log(kind: convex.PromptKind, line: Line, status: convex.PromptStatus, atS = this.atS(Date.now()), said?: convex.Said): Promise<string | null> {
    return this.deps.convex
      .logPrompt(this.token, this.recordingId, { kind, text: line.text, textEn: line.textEn, atS, status, ...(said ? { said } : {}) })
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

  /** Seconds into the video: from t0, less the time the video doesn't have (in-app pauses). */
  private atS(ms: number) {
    return this.mem.t0 === undefined ? 0 : Math.round((ms - this.mem.t0 - this.mem.gapS * 1000) / 100) / 10;
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
