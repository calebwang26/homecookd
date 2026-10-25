// In-app recordings filmed but not yet fully handed to the worker (Oct 24), so that if the app dies
// after "I'm done" (a crash at "Done! Sending it to Shreya", a swipe-away mid-upload) the next launch
// sends it again. One note per recording in Paths.document/unsent-recordings.json: written when filming
// stops (app/recording.tsx), given the upload job once the signer made one, and dropped once Convex has
// the job and every file is uploaded (components/record/sendDraft), or when she stops or clears its
// row on Home. The next launch sends what's left in the background, as that cook, whoever is in
// (components/record/useResendUnsent). The videos stay in documents/recordings/<recordingId>/.
// Not covered: a recording the app dies in before "I'm done" (its finished 5-minute files are kept,
// but nothing sends them). Rules: lib/unsentLogic.
//
//   saveUnsent({ recordingId, cookId, familyId, clips, dish, language, forKids, everyone, requestFrom })
//   markUnsentJob(recordingId, jobId)   dropUnsent(recordingId)   dropUnsentFor(row)   countResend(recordingId)
//   loadUnsent()   stillUnsent(recordingId)   savedHere(recordingId)   clipsHere(note)   unsentUri(clip)
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { DraftClip } from '@/components/record/draft';

import { docPath, isFullUri, patchUnsent, withoutUnsent, withoutUnsentFor, withUnsent, type Unsent, type UnsentClip } from './unsentLogic';

const FILE = 'unsent-recordings.json';
const native = Platform.OS !== 'web'; // the web build never films in the app
/** Saved by this run of the app: its done view is sending it, so a resend here would be a second copy. */
const mine = new Set<string>();

const file = () => new File(Paths.document, FILE);

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
}

export type UnsentInput = Pick<Unsent, 'recordingId' | 'cookId' | 'familyId' | 'dish' | 'language' | 'forKids' | 'everyone' | 'requestFrom'> & {
  clips: DraftClip[];
};

export function saveUnsent({ clips, ...rest }: UnsentInput) {
  const documents = Paths.document.uri;
  const kept: UnsentClip[] = clips.map((c) => ({
    path: docPath(c.asset.uri, documents),
    durationMs: c.asset.duration ?? 0,
    width: c.asset.width,
    height: c.asset.height,
    startedAt: c.recordedAt ? Date.parse(c.recordedAt) : Date.now(),
  }));
  mine.add(rest.recordingId);
  save(withUnsent(loadUnsent(), { ...rest, clips: kept, savedAt: new Date().toISOString(), jobId: null, resends: 0 }));
}

export function markUnsentJob(recordingId: string, jobId: string) {
  const list = loadUnsent();
  if (list.some((u) => u.recordingId === recordingId)) save(patchUnsent(list, recordingId, { jobId }));
}

export function dropUnsent(recordingId: string) {
  const list = loadUnsent();
  if (list.some((u) => u.recordingId === recordingId)) save(withoutUnsent(list, recordingId));
}

/** She stopped or cleared that upload's row on Home: its recording is never sent again by itself. */
export function dropUnsentFor(row: { job_id: string; recording_id?: string | null }) {
  const list = loadUnsent();
  const rest = withoutUnsentFor(list, row);
  if (rest.length !== list.length) save(rest);
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
