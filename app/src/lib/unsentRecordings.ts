// Recordings filmed or picked but not yet fully handed to the worker, so that if the app dies on the way
// the next launch can carry on. One note per recording in Paths.document/unsent-recordings.json, rules
// in lib/unsentLogic:
//   - While she films in the app (Oct 26): each saved 5-minute file updates a 'filming' note
//     (app/recording.tsx, saveFilming). If the app dies before "I'm done" (a crash, iOS, the battery),
//     nothing is sent by itself: her Home asks "Your recording stopped early. Send what was filmed?"
//     (components/record/StoppedEarlyCard: Send it, or Delete).
//   - At "I'm done" the note is being sent (saveUnsent): it gets the upload job once the signer made
//     one, and goes once Convex has the job and every file is uploaded (components/record/sendDraft),
//     or when she stops or clears its row on Home. The next launch sends what's left in the background,
//     as that cook, whoever is in (components/record/useResendUnsent).
//   - A send from the Send screen ("Videos I already took", Oct 26) gets the same kind of note
//     (components/record/sendKept), with its own id (`local`): the picked videos are copied out of
//     ImagePicker's cache into documents/sends/<id>/ first, and those copies go with the note.
// The in-app videos stay in documents/recordings/<recordingId>/ (only Delete on Home removes them).
//
//   saveUnsent({ recordingId, cookId, familyId, clips, dish, language, forKids, everyone, requestFrom })
//   saveFilming(same)   filmingOnScreen(recordingId, on)   startSending(recordingId)   deleteRecording(note)
//   markUnsentJob(recordingId, jobId)   dropUnsent(recordingId)   dropUnsentFor(row)   countResend(recordingId)
//   markUnsentDidntSend(recordingId)    a resend that failed with no upload row left: Home shows its own row
//   loadUnsent()   stillUnsent(recordingId)   savedHere(recordingId)   clipsHere(note)   unsentUri(clip)
//   recordingFilesHere(recordingId)     an in-app recording's own files are still in documents/recordings/
//   await keepForSend(clips, noteId)   subscribeUnsent(listener) / unsentVersion()   (Home's card)
//   cleanOrphanCopies()   once a launch (useResendUnsent): copies under sends/ that no note lists
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { DraftClip } from '@/components/record/draft';

import {
  asSending,
  copyPath,
  docPath,
  isFullUri,
  jobPatch,
  orphanCopies,
  patchUnsent,
  withFilming,
  withoutUnsent,
  withoutUnsentFor,
  withUnsent,
  type Unsent,
  type UnsentClip,
} from './unsentLogic';

const FILE = 'unsent-recordings.json';
const native = Platform.OS !== 'web'; // the web build never films in the app
/** Saved by this run of the app: its done view is sending it, so a resend here would be a second copy. */
const mine = new Set<string>();
/** Recordings this run of the app is filming right now (their recording screen is open). */
const onScreen = new Set<string>();
/** Deleted on Home in this run (saveFilming ignores them). */
const deleted = new Set<string>();
/** Sends whose videos are being copied right now, before their note is written (cleanOrphanCopies leaves them). */
const keeping = new Set<string>();

const file = () => new File(Paths.document, FILE);

let version = 0;
const listeners = new Set<() => void>();
function changed() {
  version += 1;
  for (const l of listeners) l();
}
export function subscribeUnsent(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export const unsentVersion = () => version;

export function loadUnsent(): Unsent[] {
  if (!native) return [];
  try {
    const f = file();
    const parsed = f.exists ? JSON.parse(f.textSync()) : [];
    return Array.isArray(parsed) ? (parsed as Unsent[]) : [];
  } catch {
    return [];
  }
}

function save(list: Unsent[]) {
  if (!native) return;
  try {
    const f = file();
    if (!f.exists) f.create({ intermediates: true });
    f.write(JSON.stringify(list));
  } catch (e) {
    console.warn('[unsent] could not save', String(e).slice(0, 160));
  }
  changed();
}

export type UnsentInput = Pick<Unsent, 'recordingId' | 'cookId' | 'familyId' | 'dish' | 'language' | 'forKids' | 'everyone' | 'requestFrom'> &
  Partial<Pick<Unsent, 'local' | 'glasses' | 'hello'>> & {
    clips: DraftClip[];
    /** The clips that are copies of camera-roll picks (keepForSend), by uri. */
    copies?: Set<string>;
  };

function noteOf({ clips, copies, ...rest }: UnsentInput): Unsent {
  const documents = Paths.document.uri;
  const kept: UnsentClip[] = clips.map((c) => ({
    path: docPath(c.asset.uri, documents),
    durationMs: c.asset.duration ?? 0,
    width: c.asset.width,
    height: c.asset.height,
    startedAt: c.recordedAt ? Date.parse(c.recordedAt) : Date.now(),
    ...(copies?.has(c.asset.uri) ? { copy: true } : {}),
  }));
  return { ...rest, clips: kept, savedAt: new Date().toISOString(), jobId: null, resends: 0 };
}

/** It's being sent now ("I'm done", Send): kept until Convex has the job and every file is up. */
export function saveUnsent(input: UnsentInput) {
  mine.add(input.recordingId);
  keeping.delete(input.recordingId);
  save(withUnsent(loadUnsent(), noteOf(input)));
}

/** A note put back exactly as it was (a send that didn't start). */
export function putUnsent(u: Unsent) {
  save(withUnsent(loadUnsent(), u));
}

/** A file was saved while she films: the 'filming' note, with every file so far (never over a send). */
export function saveFilming(input: UnsentInput) {
  // Deleted on Home: a file the closed screen's camera saves late must not bring it back.
  if (deleted.has(input.recordingId)) return;
  const list = loadUnsent();
  const next = withFilming(list, noteOf(input));
  if (next !== list) save(next);
}

/** The recording screen for it is open in this run (its note isn't one to ask about). */
export function filmingOnScreen(recordingId: string, on: boolean) {
  if (on) onScreen.add(recordingId);
  else onScreen.delete(recordingId);
  changed();
}
export const filmingNow = (recordingId: string) => onScreen.has(recordingId);

/** Her [Send it] on Home: the 'filming' note is being sent now, by this run (no resend meanwhile). */
export function startSending(recordingId: string): Unsent | null {
  const list = loadUnsent();
  const u = list.find((x) => x.recordingId === recordingId);
  const next = u ? asSending(u, Date.now()) : null;
  if (!next) return null; // gone, or already being sent: never reset a send on its way
  mine.add(recordingId);
  save(withUnsent(list, next));
  return next;
}

/** That send didn't start (no upload made): Home asks her again. */
export function backToFilming(recordingId: string) {
  const list = loadUnsent();
  if (list.some((u) => u.recordingId === recordingId && !u.jobId)) save(patchUnsent(list, recordingId, { state: 'filming' }));
}

/** The note's upload job (null: it has none now, e.g. the job it pointed at was stopped to send it again). */
export function markUnsentJob(recordingId: string, jobId: string | null) {
  const list = loadUnsent();
  if (list.some((u) => u.recordingId === recordingId)) save(patchUnsent(list, recordingId, jobPatch(jobId)));
}

/** A resend of it failed with no upload row left (it has no job): Home shows its own failed row (failedNotes). */
export function markUnsentDidntSend(recordingId: string) {
  const list = loadUnsent();
  if (list.some((u) => u.recordingId === recordingId && !u.jobId)) save(patchUnsent(list, recordingId, { didntSend: true }));
}

function remove(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch (e) {
    console.warn('[unsent] could not delete', String(e).slice(0, 120));
  }
}

/** A note going: the copies of camera-roll picks go with it (their originals are in Photos). */
function removeCopies(u: Unsent) {
  if (!native) return;
  for (const c of u.clips) if (c.copy) remove(unsentUri(c));
  try {
    const dir = new Directory(Paths.document, 'sends', u.recordingId);
    if (dir.exists && dir.list().length === 0) dir.delete();
  } catch {
    // already gone
  }
}

export function dropUnsent(recordingId: string) {
  keeping.delete(recordingId);
  const list = loadUnsent();
  const u = list.find((x) => x.recordingId === recordingId);
  if (!u) return;
  save(withoutUnsent(list, recordingId));
  removeCopies(u);
}

/** She stopped or cleared that upload's row on Home: its recording is never sent again by itself. */
export function dropUnsentFor(row: { job_id: string; recording_id?: string | null; unsent_id?: string | null }) {
  const list = loadUnsent();
  const rest = withoutUnsentFor(list, row);
  if (rest.length === list.length) return;
  save(rest);
  for (const u of list) if (!rest.includes(u)) removeCopies(u);
}

/** Her Delete on Home (after "Delete this video?"): the files and the note, for good. */
export function deleteRecording(u: Unsent) {
  for (const c of u.clips) remove(unsentUri(c));
  try {
    for (const dir of [new Directory(Paths.document, 'recordings', u.recordingId), new Directory(Paths.document, 'sends', u.recordingId)]) if (dir.exists) dir.delete();
  } catch (e) {
    console.warn('[unsent] could not delete the folder', String(e).slice(0, 120));
  }
  deleted.add(u.recordingId);
  save(withoutUnsent(loadUnsent(), u.recordingId));
}

/**
 * Once a launch: copies under documents/sends/ that no note lists (the app died between the copy and
 * its note, or a note was put back without them) go, and so do their empty folders.
 */
export function cleanOrphanCopies() {
  if (!native) return;
  try {
    const root = new Directory(Paths.document, 'sends');
    if (!root.exists) return;
    const dirs = root.list().filter((d): d is Directory => d instanceof Directory);
    const paths = dirs.flatMap((d) => d.list().filter((f) => f instanceof File).map((f) => `sends/${d.name}/${f.name}`));
    for (const p of orphanCopies(paths, loadUnsent(), (id) => keeping.has(id))) remove(new File(Paths.document, p).uri);
    for (const d of dirs) if (!keeping.has(d.name) && d.exists && d.list().length === 0) d.delete();
  } catch (e) {
    console.warn('[unsent] could not tidy the kept copies', String(e).slice(0, 120));
  }
}

/** Counted before a resend starts, so a send that closes the app again still counts. */
export function countResend(recordingId: string) {
  const list = loadUnsent();
  const u = list.find((x) => x.recordingId === recordingId);
  if (u) save(patchUnsent(list, recordingId, { resends: u.resends + 1 }));
}

/** Its note is still there (not stopped on Home meanwhile, not sent by another run). */
export const stillUnsent = (recordingId: string) => loadUnsent().some((u) => u.recordingId === recordingId);

export const savedHere = (recordingId: string) => mine.has(recordingId);

/** Where the clip's video is now. */
export function unsentUri(c: UnsentClip): string {
  return isFullUri(c.path) ? c.path : new File(Paths.document, c.path).uri;
}

/**
 * An in-app recording's own files are still in documents/recordings/<id>/, whether or not a note lists them (only
 * Delete on Home removes that folder; a note dropped before Nov 10 left them there with nothing pointing at them).
 */
export function recordingFilesHere(recordingId: string | null | undefined): boolean {
  if (!native || !recordingId) return false;
  try {
    const dir = new Directory(Paths.document, 'recordings', recordingId);
    return dir.exists && dir.list().some((f) => f instanceof File && (f.size ?? 0) > 0);
  } catch {
    return false;
  }
}

/** Its videos that are still on the phone and not empty (a missing one is left out, the rest still go). */
export function clipsHere(u: Unsent): UnsentClip[] {
  return u.clips.filter((c) => {
    try {
      const f = new File(unsentUri(c));
      return f.exists && (f.size ?? 0) > 0;
    } catch {
      return false;
    }
  });
}

/**
 * Before a Send-screen upload: each picked video that lives in a cache iOS may empty (ImagePicker's
 * copies in Caches/, the camera's in tmp/) is copied into documents/sends/<noteId>/ (on APFS a copy
 * is a clone: instant, no extra space), so a send the app dies during can go again on the next
 * launch. A video that isn't there is left as it is (the upload then says so). `copies`: their uris.
 */
export async function keepForSend(clips: DraftClip[], noteId: string): Promise<{ clips: DraftClip[]; copies: Set<string> }> {
  const copies = new Set<string>();
  if (!native) return { clips, copies };
  keeping.add(noteId); // until its note is written (saveUnsent) or dropped
  const documents = Paths.document.uri;
  const out: DraftClip[] = [];
  for (const [i, c] of clips.entries()) {
    const rel = copyPath(c.asset.uri, documents, noteId, i + 1);
    if (!rel) {
      out.push(c);
      continue;
    }
    try {
      const src = new File(c.asset.uri);
      if (!src.exists) {
        out.push(c);
        continue;
      }
      const dir = new Directory(Paths.document, 'sends', noteId);
      if (!dir.exists) dir.create({ intermediates: true });
      const target = new File(Paths.document, rel);
      if (target.exists) target.delete();
      await src.copy(target);
      copies.add(target.uri);
      out.push({ ...c, asset: { ...c.asset, uri: target.uri } });
    } catch (e) {
      console.warn('[unsent] could not keep a picked video; it uploads from where it is', String(e).slice(0, 160));
      out.push(c);
    }
  }
  return { clips: out, copies };
}
