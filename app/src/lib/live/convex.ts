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

import { getSession } from '@/lib/session';
import { secretGet } from '@/lib/storage';

const URL = (process.env.EXPO_PUBLIC_CONVEX_URL ?? '').trim();
const client = URL ? new ConvexClient(URL) : null;

export type JobSource = 'phone' | 'glasses';
export type JobStage = 'queued' | 'preparing' | 'understanding' | 'writing' | 'indexing' | 'done' | 'failed';
export type LiveJob = { _id: string; uploadPath: string; source: JobSource; stage: JobStage; progress: number; error?: string; recipeId?: string };
export type CookQuestion = {
  _id: string;
  _creationTime: number;
  recipeId: string;
  stepOrder?: number;
  text: string;
  askedByName?: string;
  recipeTitle?: string;
};

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

/** Runs `name` on Convex, or `fallback` while stubbed (or once Convex says the function isn't there). */
async function call<T>(type: 'mutation' | 'action' | 'query', name: string, args: Record<string, unknown>, fallback: () => T | Promise<T>): Promise<T> {
  if (stubbed || !client) return fallback();
  try {
    if (type === 'mutation') return await client.mutation(ref<'mutation'>(name), args);
    if (type === 'action') return await client.action(ref<'action'>(name), args);
    return await client.query(ref<'query'>(name), args);
  } catch (e) {
    if (signedOut(e)) session = null;
    if (!isMissing(e)) throw e;
    goStub(e);
    return fallback();
  }
}

// ---------------------------------------------------------------------------
// Session: sessions.start({ deviceKey, profileId }), once per phone + person

type ConvexSession = { sessionToken: string; familyId: string; personId: string; role: 'cook' | 'kid' };
let session: { key: string; run: Promise<ConvexSession | null> } | null = null;

/** This phone's Convex session for the current person, or null before sign-in. */
export async function convexSession(): Promise<string | null> {
  const profileId = getSession()?.me?.id;
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

/** A live query with the session token; `fallback` is the stub's live value. */
function useLive<T>(name: string, initial: T, fallback: (onData: (v: T) => void) => () => void, enabled = true): T {
  const [value, setValue] = useState<T>(initial);
  const isStub = useConvexStubbed();
  const meId = getSession()?.me?.id;
  useEffect(() => {
    if (!enabled) return;
    if (isStub || !client) return fallback(setValue);
    let off: (() => void) | null = null;
    let alive = true;
    void convexSession().then((sessionToken) => {
      if (!alive || !sessionToken) return;
      off = client.onUpdate(ref<'query'>(name), { sessionToken }, (v) => setValue(v as T), (e) => (isMissing(e) ? goStub(e) : console.warn(`[convex] ${name}`, String(e))));
    });
    return () => {
      alive = false;
      off?.();
    };
    // `fallback` is a stable module function per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, isStub, meId, enabled]);
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

async function token(): Promise<string> {
  const t = await convexSession();
  if (!t) throw new Error('Sign in first.');
  return t;
}

/** jobs.create for a signer upload: `uploadPath` is "<job_id>/", the folder in the uploads bucket. */
export async function createJob(uploadPath: string, source: JobSource): Promise<void> {
  const sessionToken = await token();
  await call('mutation', 'jobs:create', { sessionToken, uploadPath, source }, () => stub.createJob(uploadPath, source));
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

/** The Convex recipe for a library dish (recipes.libraryId) and its cook; the library id while stubbed. */
async function convexRecipe(libraryId: string): Promise<RecipeRef> {
  const sessionToken = stubbed ? null : await convexSession();
  if (!sessionToken) return { recipeId: libraryId, cookId: null };
  recipes ??= call<{ _id: string; libraryId?: string; cookId: string }[]>('query', 'recipes:list', { sessionToken }, () => [])
    .then((rows) => new Map(rows.filter((r) => r.libraryId).map((r) => [r.libraryId!, { recipeId: r._id, cookId: r.cookId }])))
    .catch(() => {
      recipes = null;
      return new Map();
    });
  return (await recipes).get(libraryId) ?? { recipeId: libraryId, cookId: null };
}

export async function convexRecipeId(libraryId: string): Promise<string> {
  return (await convexRecipe(libraryId)).recipeId;
}

// ---------------------------------------------------------------------------
// The stub (same shapes as Track A). In memory: a relaunch starts empty.

const stub = (() => {
  let jobs: LiveJob[] = [];
  let questions: CookQuestion[] = [];
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
  };
})();

/** The voice stub's ask_cook lands here, so the cook's side can be tried on one phone. */
export const stubAskCook = stub.ask;
