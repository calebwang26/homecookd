// Track A boundary: every call the app makes to Convex (docs/build/STACK.md "App → Convex").
//
//   const token = await convexSession();                 sessions.start with this phone's device key
//   useLiveJobs()                                        jobs.forFamily, live (parent progress)
//   useCookQuestions()                                   questions.openForCook, live
//   await createJob(uploadPath, source)                  jobs.create
//   await answerQuestion(id, { audioUri })               files.uploadUrl + questions.answer
//   const shared = await sharePhoto(libraryId, photoUri) -> { draft, … } (Muse's note; nothing sent yet)
//   await sendPhoto(shared, text)                        messages.send: the photo + the kid's note, to the cook
//   await convexRecipeId(libraryId)                      the recipe's Convex _id (the voice socket needs it)
//   invalidateConvexRecipes()                            after the family's recipe list changes (lib/recipes.ts)
//   const { recordingId } = await startRecording({ dish, forKidId, language?, source })   live.startRecording
//   useRecording(recordingId)                            live.recording, live (the recording screen)
//   await endRecording(recordingId)                      live.endRecording: the stop button with no voice line
//   useLiveLog(recordingId)                              liveEvents.forRecording, live (what the glasses' live pass saw)
//   useLiveFrame(recordingId)                            liveEvents.frame, live (the glasses' newest picture)
//   await cancelLiveJob(jobId)                           jobs.cancel: stops a job (queued or mid-way) for good
//   useGlassesVideos()                                   glasses.videos, live (the laptop's saved full videos)
//   useMe()  /  await setLanguage('mr')                  people.me (live) / people.setLanguage
//   await convexPersonIdByName('Shreya')                 a family member's Convex id, from rows that name them
//   await libraryIdOf(recipeId)                          a Convex recipe's library id (recipes.list)
//
// The reads added for the Oct 24 tracks (live.recording, people.me) are "soft": until those functions
// are deployed, Convex's "Could not find public function" gives their stub value without moving every
// other call to the stub. The writes (live.startRecording, people.setLanguage) are "strict": a missing
// function throws, so the screen says it didn't work instead of pretending (a stub recording has no
// glasses video behind it, and a stub language isn't saved anywhere). live.endRecording is soft, but
// its stub only ends a stub recording: a live one answers "not ended", and the stop button falls back.
//
// Functions are called by name, so the app builds before Track A's convex/ code exists. Until it is
// deployed (no EXPO_PUBLIC_CONVEX_URL, or Convex says "Could not find public function"), every call
// falls back to the stub at the bottom of this file, with the same shapes: the screens work and can
// be demoed on one phone. The stub never pretends to be the cook: its questions are only the ones
// this phone's voice stub asked.
import { ConvexClient } from 'convex/browser';
import { makeFunctionReference, type FunctionType } from 'convex/server';
import { File, UploadType } from 'expo-file-system';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { getSession, useSession } from '@/lib/session';
import { secretGet } from '@/lib/storage';

const URL = (process.env.EXPO_PUBLIC_CONVEX_URL ?? '').trim();
const client = URL ? new ConvexClient(URL) : null;

export type JobSource = 'phone' | 'glasses';
export type JobStage = 'uploading' | 'queued' | 'preparing' | 'understanding' | 'writing' | 'indexing' | 'done' | 'failed';
export type LiveJob = { _id: string; _creationTime?: number; uploadPath: string; source: JobSource; stage: JobStage; progress: number; error?: string; recipeId?: string; title?: string };
export type CookQuestion = {
  _id: string;
  _creationTime: number;
  recipeId: string;
  stepOrder?: number;
  text: string;
  askedByName?: string;
  recipeTitle?: string;
  /** The kid's Convex person id. */
  askedBy?: string;
  /** The question in the cook's language, when it isn't English (Track F translates it). */
  textForCook?: string;
  /**
   * Unset: a kid's cooking question. 'share' (Community, convex/shareRequests.ts): someone in the
   * family asks her to put `shareRecipeId` on the map; only her clear yes shares it. Any other value
   * from a newer server reads as a plain question.
   */
  kind?: string;
  shareRecipeId?: string;
  answer?: { translation?: string };
};

export type RecordingSource = 'phone' | 'glasses';
export type RecordingStatus = 'intro' | 'recording' | 'wrapping_up' | 'ended' | 'abandoned';
export type LiveRecording = {
  _id: string;
  source: RecordingSource;
  status: RecordingStatus;
  language: string;
  dish?: string;
  forKidId?: string;
  startedAt?: number;
  endedAt?: number;
  jobId?: string;
};
/** The glasses' live analysis (glasses/BRIDGE.md): what it saw so far, oldest first; `at` is wall-clock ms. */
export type LiveLogEvent = { at: number; kind: 'step' | 'ingredient' | 'cue' | 'quote' | 'story' | 'marker'; title: string; text: string; saidAs?: string };
export type LiveLog = { events: LiveLogEvent[]; windows: { analysed: number; missed: number } };
export type Me = { personId: string; name: string; role: 'cook' | 'kid'; language: string; relation?: string };
/** Who a stub people.me is for (useSession's `me`). */
type StubPerson = { id: string; name: string; role: string; relation: string | null } | null | undefined;

// ---------------------------------------------------------------------------
// Live or stub

let stubbed = !client;
const modeListeners = new Set<() => void>();
const isMissing = (e: unknown) => /could not find public function/i.test(String(e));
/** Track A's words when a session is no longer valid: sign in again. */
const signedOut = (e: unknown) => /this phone was signed out/i.test(String(e));

function goStub(e: unknown) {
  if (stubbed) return;
  console.warn('[convex] using the local stub until Track A deploys:', String(e).slice(0, 160));
  stubbed = true;
  for (const l of modeListeners) l();
}

/** True while Convex calls go to the local stub. */
export function useConvexStubbed(): boolean {
  return useSyncExternalStore(
    (l) => {
      modeListeners.add(l);
      return () => modeListeners.delete(l);
    },
    () => stubbed,
  );
}

const ref = <T extends FunctionType>(name: string) => makeFunctionReference<T>(name);

/**
 * Runs `name` on Convex, or `fallback` while stubbed (or once Convex says the function isn't there).
 * `soft`: a missing function gives `fallback` for this call only (a function not deployed yet).
 * `strict`: a missing function throws (a write that must really happen).
 */
export async function call<T>(
  type: 'mutation' | 'action' | 'query',
  name: string,
  args: Record<string, unknown>,
  fallback: () => T | Promise<T>,
  opts: { soft?: boolean; strict?: boolean } = {},
): Promise<T> {
  if (stubbed || !client) return fallback();
  try {
    if (type === 'mutation') return await client.mutation(ref<'mutation'>(name), args);
    if (type === 'action') return await client.action(ref<'action'>(name), args);
    return await client.query(ref<'query'>(name), args);
  } catch (e) {
    if (signedOut(e)) session = null;
    if (!isMissing(e)) throw e;
    if (opts.strict) throw new Error(`${name} isn't on the server yet.`);
    if (opts.soft) {
      console.warn(`[convex] ${name} isn't deployed yet; using its stub`);
      return fallback();
    }
    goStub(e);
    return fallback();
  }
}

// ---------------------------------------------------------------------------
// Session: sessions.start({ deviceKey, profileId }), once per phone + person

type ConvexSession = { sessionToken: string; familyId: string; personId: string; role: 'cook' | 'kid' };
let session: { key: string; run: Promise<ConvexSession | null> } | null = null;

/**
 * This phone's Convex session for the current person, or null before sign-in. Hooks pass `profileId`
 * from useSession(): the module snapshot (getSession) is published in SessionProvider's effect, which
 * runs after its children's effects, so a screen's first effect would still see nobody signed in.
 */
export async function convexSession(profileId = getSession()?.me?.id): Promise<string | null> {
  const deviceKey = await secretGet('deviceKey');
  if (!profileId || !deviceKey) return stubbed ? 'stub' : null;
  const key = `${deviceKey}:${profileId}`;
  if (session?.key !== key) {
    const run = call<ConvexSession | null>('action', 'sessions:start', { deviceKey, profileId }, () => stub.session()).catch((e) => {
      console.warn('[convex] sessions.start failed', String(e).slice(0, 160));
      if (session?.run === run) session = null; // try again next time
      return null;
    });
    session = { key, run };
  }
  return (await session.run)?.sessionToken ?? null;
}

const LIVE_RETRIES = 3;
const LIVE_RETRY_MS = 10_000;

/** A live query with the session token (plus `args`); `fallback` is the stub's live value. */
export function useLive<T>(
  name: string,
  initial: T,
  fallback: (onData: (v: T) => void) => () => void,
  enabled = true,
  args: Record<string, unknown> = {},
  /** A missing function falls back for this hook only (see `call`'s `soft`). */
  soft = false,
): T {
  const [value, setValue] = useState<T>(initial);
  const isStub = useConvexStubbed();
  // A new person or a new device key (a sign-in) starts a new session and subscription.
  const { me, credentialVersion } = useSession();
  const meId = me?.id;
  const argsKey = JSON.stringify(args);
  useEffect(() => {
    if (!enabled) return;
    if (isStub || !client) return fallback(setValue);
    let off: (() => void) | null = null;
    let offStub: (() => void) | null = null;
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    // No session yet (a failed sessions.start, a dropped connection): try again a few times.
    const subscribe = (tries: number) =>
      void convexSession(meId).then((sessionToken) => {
        if (!alive) return;
        if (!sessionToken) {
          if (tries < LIVE_RETRIES) retry = setTimeout(() => subscribe(tries + 1), LIVE_RETRY_MS);
          return;
        }
        off = client.onUpdate(ref<'query'>(name), { ...args, sessionToken }, (v) => setValue(v as T), (e) => {
          if (!isMissing(e)) return console.warn(`[convex] ${name}`, String(e));
          if (!soft) return goStub(e);
          if (alive && !offStub) offStub = fallback(setValue);
        });
      });
    subscribe(0);
    return () => {
      alive = false;
      if (retry) clearTimeout(retry);
      off?.();
      offStub?.();
    };
    // `fallback` is a stable module function per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, isStub, meId, credentialVersion, enabled, argsKey]);
  return value;
}

// ---------------------------------------------------------------------------
// Calls

export function useLiveJobs(enabled = true): LiveJob[] {
  return useLive<LiveJob[]>('jobs:forFamily', [], stub.watchJobs, enabled);
}

export function useCookQuestions(enabled = true): CookQuestion[] {
  return useLive<CookQuestion[]>('questions:openForCook', [], stub.watchQuestions, enabled);
}

export async function token(): Promise<string> {
  const t = await convexSession();
  if (!t) throw new Error('Sign in first.');
  return t;
}

export type JobExtras = { title?: string; language?: string; forKidId?: string; recordingId?: string };

/** Drops unset and empty fields (Convex validators refuse `undefined`-only noise and empty ids). */
const present = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/**
 * jobs.create for a signer upload: `uploadPath` is "<job_id>/", the folder in the uploads bucket.
 * `extras` (the dish, the cook's language, the kid, homie's recording) need Track F's jobs.create; an
 * older deployment refuses fields it doesn't know, so the job is then made without them.
 */
export async function createJob(uploadPath: string, source: JobSource, extras: JobExtras = {}): Promise<void> {
  const sessionToken = await token();
  const extra = present(extras);
  const run = (more: Record<string, unknown>) => call('mutation', 'jobs:create', { sessionToken, uploadPath, source, ...more }, () => stub.createJob(uploadPath, source));
  try {
    await run(extra);
  } catch (e) {
    if (!Object.keys(extra).length || !/extra field|validator/i.test(String(e))) throw e;
    console.warn('[convex] jobs.create without the new fields:', String(e).slice(0, 160));
    await run({});
  }
}

/**
 * homie's live session while a cook records (Track E). It starts in `intro`. Without `language` the
 * server uses her people.language (send one only when she picked it or it loaded).
 */
export async function startRecording(input: { dish?: string; forKidId?: string; language?: string; source: RecordingSource }): Promise<{ recordingId: string }> {
  const sessionToken = await token();
  return call('mutation', 'live:startRecording', { sessionToken, ...present(input) }, () => stub.startRecording(input), { strict: true });
}

/**
 * live.endRecording: ends her recording without the voice service ('recording' or 'wrapping_up' ->
 * 'ended'), so the glasses' computer finishes and uploads the video even when homie's line is down.
 * Idempotent. True once Convex says so; false when it couldn't (offline, not deployed yet, refused).
 * A stub recording ends on the stub.
 */
export async function endRecording(recordingId: string): Promise<boolean> {
  try {
    const sessionToken = await token();
    const r = await call<{ ok: boolean }>('mutation', 'live:endRecording', { sessionToken, recordingId }, () => stub.endRecording(recordingId), { soft: true });
    return !!r?.ok;
  } catch (e) {
    console.warn('[convex] live.endRecording', String(e).slice(0, 160));
    return false;
  }
}

/** The recording, live: null while it loads, or when it isn't this family's. */
export function useRecording(recordingId: string | null | undefined): LiveRecording | null {
  const id = recordingId ?? '';
  return useLive<LiveRecording | null>('live:recording', null, stubRecordingWatcher(id), !!id, { recordingId: id }, true);
}

// One stub watcher per id, so useLive's effect isn't redone on every render.
const stubRecordingWatchers = new Map<string, (onData: (v: LiveRecording | null) => void) => () => void>();
function stubRecordingWatcher(id: string) {
  let w = stubRecordingWatchers.get(id);
  if (!w) {
    w = (onData) => stub.watchRecording(id, onData);
    stubRecordingWatchers.set(id, w);
  }
  return w;
}

/** The live pass's log for a glasses recording; null while it loads, without the laptop bridge, or on the stub. */
export function useLiveLog(recordingId: string | null | undefined): LiveLog | null {
  const id = recordingId ?? '';
  return useLive<LiveLog | null>('liveEvents:forRecording', null, noLiveLog, !!id, { recordingId: id }, true);
}

const noLiveLog = (onData: (v: LiveLog | null) => void) => {
  onData(null);
  return () => {};
};

/** What the glasses see now: the laptop bridge's newest frame (about one a second) and when it came (ms). */
export type LiveFrame = { url: string; at: number };

export function useLiveFrame(recordingId: string | null | undefined): LiveFrame | null {
  const id = recordingId ?? '';
  return useLive<LiveFrame | null>('liveEvents:frame', null, noLiveFrame, !!id, { recordingId: id }, true);
}

const noLiveFrame = (onData: (v: LiveFrame | null) => void) => {
  onData(null);
  return () => {};
};

/** Stops one of her family's jobs on Convex (the worker's later reports are ignored). True once stopped. */
export async function cancelLiveJob(jobId: string): Promise<boolean> {
  const sessionToken = await token();
  return call<boolean>('mutation', 'jobs:cancel', { sessionToken, jobId }, () => true, { soft: true });
}

/** A glasses recording's full video, saved by the laptop for her to put in Photos and send herself. */
export type GlassesVideo = { recordingId: string; videoUrl: string; dish?: string; at: number };

export function useGlassesVideos(enabled = true): GlassesVideo[] {
  return useLive<GlassesVideo[]>('glasses:videos', [], noGlassesVideos, enabled, {}, true);
}

const noGlassesVideos = (onData: (v: GlassesVideo[]) => void) => {
  onData([]);
  return () => {};
};

/** Who this is on Convex, with their language ('en' when unset). Null until it loads. */
export function useMe(enabled = true): Me | null {
  // The stub's value comes from the hook's own person (useSession), not the module snapshot, which
  // isn't published yet right after sign-in; useLive subscribes again when that person changes.
  const { me } = useSession();
  const fallback = (onData: (v: Me | null) => void) => stub.watchMe(me, onData);
  return useLive<Me | null>('people:me', null, fallback, enabled, {}, true);
}

/**
 * Sets the person's language (an ISO 639-1 code). Pass `profileId` right after sign-in (see
 * convexSession). 'saved' once Convex has it; 'stub' while the app runs on the local stub (kept on
 * this phone until it closes). Throws when it didn't save.
 */
export async function setLanguage(language: string, profileId?: string): Promise<'saved' | 'stub'> {
  const sessionToken = await convexSession(profileId);
  if (!sessionToken) throw new Error('Sign in first.');
  let viaStub = false;
  const onStub = () => {
    viaStub = true;
    stub.setLanguage(language);
  };
  await call('mutation', 'people:setLanguage', { sessionToken, language }, onStub, { strict: true });
  return viaStub ? 'stub' : 'saved';
}

/**
 * A family member's Convex id, found by name in the rows that carry one: a kid's open questions, who
 * is cooking now, the family's messages (names are unique in a family). Null when no row names them.
 * (No public query lists the family's people yet.)
 */
export async function convexPersonIdByName(name: string | null | undefined): Promise<string | null> {
  const want = name?.trim().toLowerCase();
  if (!want || stubbed) return null;
  const sessionToken = await convexSession().catch(() => null);
  if (!sessionToken) return null;
  const read = <T,>(fn: string) => call<T[]>('query', fn, { sessionToken }, () => [], { soft: true }).catch(() => [] as T[]);
  const [questions, cooking, messages] = await Promise.all([
    read<{ askedBy?: string; askedByName?: string }>('questions:openForCook'),
    read<{ kidId: string; kidName: string }>('cooking:current'),
    read<{ from: string; fromName: string }>('messages:list'),
  ]);
  const named: { id?: string; name?: string }[] = [
    ...questions.map((q) => ({ id: q.askedBy, name: q.askedByName })),
    ...cooking.map((c) => ({ id: c.kidId, name: c.kidName })),
    ...messages.map((m) => ({ id: m.from, name: m.fromName })),
  ];
  return named.find((p) => p.id && p.name?.trim().toLowerCase() === want)?.id ?? null;
}

/** Uploads a local file to Convex storage; returns its storage id. */
async function uploadFile(uri: string, contentType: string): Promise<string> {
  const sessionToken = await token();
  if (stubbed) return `stub-file-${Date.now()}`;
  const url = await call<string>('mutation', 'files:uploadUrl', { sessionToken }, () => '');
  if (!url) return `stub-file-${Date.now()}`;
  const res = await new File(uri).createUploadTask(url, { httpMethod: 'POST', headers: { 'Content-Type': contentType }, uploadType: UploadType.BINARY_CONTENT }).uploadAsync();
  if (res.status < 200 || res.status >= 300) throw new Error('The upload didn’t go through. Try again.');
  return (JSON.parse(res.body) as { storageId: string }).storageId;
}

/** The cook's answer: a voice note (push to talk), or typed words. */
export async function answerQuestion(questionId: string, answer: { audioUri: string; contentType: string } | { text: string }): Promise<void> {
  const sessionToken = await token();
  const audioId = 'audioUri' in answer ? await uploadFile(answer.audioUri, answer.contentType) : undefined;
  const text = 'text' in answer ? answer.text : undefined;
  await call('mutation', 'questions:answer', { sessionToken, questionId, text, audioId }, () => stub.answer(questionId));
}

export type SharedPhoto = { draft: string; fileId: string; recipeId: string; cookId: string | null };

/** The kid's dish photo: stored, and Muse drafts a note to the cook. Nothing is sent yet. */
export async function sharePhoto(libraryId: string, photoUri: string): Promise<SharedPhoto> {
  const sessionToken = await token();
  const { recipeId, cookId } = await convexRecipe(libraryId);
  const fileId = await uploadFile(photoUri, 'image/jpeg');
  const { draft } = await call<{ draft: string }>('action', 'messages:sharePhoto', { sessionToken, recipeId, fileId }, () => stub.draft());
  return { draft, fileId, recipeId, cookId };
}

/** Sends the photo with the kid's words. It stays "AI-drafted" even if they edited Muse's draft. */
export async function sendPhoto(shared: SharedPhoto, text: string): Promise<void> {
  const sessionToken = await token();
  const { fileId, recipeId, cookId } = shared;
  const to = cookId ?? undefined;
  await call('mutation', 'messages:send', { sessionToken, kind: 'photo', fileId, recipeId, to, text, aiDrafted: !!shared.draft }, () => undefined);
}

type RecipeRef = { recipeId: string; cookId: string | null };
let recipes: Promise<Map<string, RecipeRef>> | null = null;

/** library id -> the Convex recipe and its cook (recipes.list), read once until invalidated. Null while stubbed. */
async function recipeMap(): Promise<Map<string, RecipeRef> | null> {
  const sessionToken = stubbed ? null : await convexSession();
  if (!sessionToken) return null;
  recipes ??= call<{ _id: string; libraryId?: string; cookId: string }[]>('query', 'recipes:list', { sessionToken }, () => [])
    .then((rows) => new Map(rows.filter((r) => r.libraryId).map((r) => [r.libraryId!, { recipeId: r._id, cookId: r.cookId }])))
    .catch(() => {
      recipes = null;
      return new Map();
    });
  return recipes;
}

/** The Convex recipe for a library dish (recipes.libraryId) and its cook; the library id while stubbed. */
async function convexRecipe(libraryId: string): Promise<RecipeRef> {
  return (await recipeMap())?.get(libraryId) ?? { recipeId: libraryId, cookId: null };
}

/**
 * The library id of a Convex recipe (a finished job's `recipeId`), or null while recipes.list doesn't
 * list it yet. The map is read again whenever the family's recipes change (invalidateConvexRecipes).
 */
export async function libraryIdOf(recipeId: string): Promise<string | null> {
  for (const [libraryId, r] of (await recipeMap()) ?? []) if (r.recipeId === recipeId) return libraryId;
  return null;
}

export async function convexRecipeId(libraryId: string): Promise<string> {
  return (await convexRecipe(libraryId)).recipeId;
}

/** Forgets the library id → recipe map, so the next lookup reads recipes.list again (the library
 *  calls it when the family's recipe list changes: a new dish, or another family signed in). */
export function invalidateConvexRecipes(): void {
  recipes = null;
}

// ---------------------------------------------------------------------------
// The stub (same shapes as Track A). In memory: a relaunch starts empty.

const stub = (() => {
  let jobs: LiveJob[] = [];
  let questions: CookQuestion[] = [];
  let language = 'en';
  const recordings = new Map<string, LiveRecording>();
  const recL = new Map<string, Set<(v: LiveRecording | null) => void>>();
  // Each people.me watcher, with the person its hook is for.
  const meL = new Map<(v: Me | null) => void, StubPerson>();
  const stubMe = (me: StubPerson): Me | null =>
    me ? { personId: me.id, name: me.name, role: me.role === 'cook' ? 'cook' : 'kid', language, relation: me.relation ?? undefined } : null;
  const jobL = new Set<(v: LiveJob[]) => void>();
  const qL = new Set<(v: CookQuestion[]) => void>();
  const watch = <T>(set: Set<(v: T) => void>, get: () => T) => (onData: (v: T) => void) => {
    set.add(onData);
    onData(get());
    return () => void set.delete(onData);
  };
  const emitJobs = () => jobL.forEach((l) => l(jobs));
  const emitQs = () => qL.forEach((l) => l(questions));
  // A stub job walks the stages a few seconds apart, so the progress row can be seen moving.
  const STAGES: JobStage[] = ['queued', 'preparing', 'understanding', 'writing', 'indexing', 'done'];
  const setRecordingStatus = (id: string, status: RecordingStatus) => {
    const r = recordings.get(id);
    if (!r) return;
    const now = Date.now();
    const next: LiveRecording = { ...r, status, startedAt: r.startedAt ?? (status === 'recording' ? now : undefined), endedAt: status === 'ended' ? now : r.endedAt };
    recordings.set(id, next);
    recL.get(id)?.forEach((l) => l(next));
  };
  return {
    session: (): ConvexSession => ({ sessionToken: 'stub', familyId: 'stub', personId: getSession()?.me?.id ?? 'stub', role: getSession()?.me?.role === 'cook' ? 'cook' : 'kid' }),
    watchJobs: watch(jobL, () => jobs),
    watchQuestions: watch(qL, () => questions),
    createJob(uploadPath: string, source: JobSource) {
      const _id = `stub-job-${Date.now()}`;
      jobs = [{ _id, uploadPath, source, stage: 'queued', progress: 0 }, ...jobs];
      emitJobs();
      STAGES.forEach((stage, i) =>
        setTimeout(() => {
          jobs = jobs.map((j) => (j._id === _id ? { ...j, stage, progress: i / (STAGES.length - 1) } : j));
          emitJobs();
        }, i * 4000),
      );
    },
    /** Called by the voice stub's ask_cook (lib/live/voice.ts). */
    ask(recipeId: string, text: string, stepOrder?: number): string {
      const _id = `stub-q-${Date.now()}`;
      questions = [{ _id, _creationTime: Date.now(), recipeId, stepOrder, text, askedByName: getSession()?.me?.name }, ...questions];
      emitQs();
      return _id;
    },
    answer(questionId: string) {
      questions = questions.filter((q) => q._id !== questionId);
      emitQs();
    },
    draft: () => ({ draft: 'I made it! It tasted like home. Thank you for teaching me.' }),
    startRecording(input: { dish?: string; forKidId?: string; language?: string; source: RecordingSource }) {
      const _id = `stub-rec-${Date.now()}`;
      recordings.set(_id, { _id, source: input.source, status: 'intro', language: input.language ?? language, dish: input.dish, forKidId: input.forKidId });
      return { recordingId: _id };
    },
    watchRecording(id: string, onData: (v: LiveRecording | null) => void) {
      const set = recL.get(id) ?? new Set<(v: LiveRecording | null) => void>();
      recL.set(id, set);
      set.add(onData);
      onData(recordings.get(id) ?? null);
      return () => void set.delete(onData);
    },
    setRecordingStatus,
    /**
     * live.endRecording on the stub: a filming or wrapping-up stub recording ends (again: still ok).
     * A live recording isn't here (the function isn't deployed yet): not ok, so the app falls back.
     */
    endRecording(id: string): { ok: boolean } {
      const r = recordings.get(id);
      // A stub recording opened by its link (web screenshots) has no row to move.
      if (!r) return { ok: id.startsWith('stub-') };
      if (r.status === 'recording' || r.status === 'wrapping_up') setRecordingStatus(id, 'ended');
      return { ok: recordings.get(id)?.status === 'ended' };
    },
    watchMe: (me: StubPerson, onData: (v: Me | null) => void) => {
      meL.set(onData, me);
      onData(stubMe(me));
      return () => void meL.delete(onData);
    },
    setLanguage(code: string) {
      language = code;
      meL.forEach((me, l) => l(stubMe(me)));
    },
  };
})();

/** The voice stub's ask_cook lands here, so the cook's side can be tried on one phone. */
export const stubAskCook = stub.ask;
/** The /record stub (lib/live/homie.ts) moves its recording along, as the voice service would. */
export const stubRecordingStatus = stub.setRecordingStatus;
