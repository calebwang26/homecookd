// The rules for in-app recordings that haven't reached the worker yet (lib/unsentRecordings), pure
// (node scripts/test-recording-ui.mjs): where each video is kept (a path inside documents/, because iOS
// moves the app's folder when the app updates), what the next launch does with a recording that's
// still waiting, and which cook the phone opens as so that send can finish.

export type UnsentClip = {
  /** Inside documents/ ("recordings/<id>/part-01.mp4"), or a full file:// uri when it's elsewhere. */
  path: string;
  durationMs: number;
  width: number;
  height: number;
  /** When this file began filming (epoch ms). */
  startedAt: number;
};

export type Unsent = {
  recordingId: string;
  /** The family it was filmed in (Supabase id) and the cook who filmed it (Supabase profile id). */
  familyId: string | null;
  cookId: string;
  clips: UnsentClip[];
  /** The pre-record sheet's answers, as the done view sends them. */
  dish: string | null;
  language: string | null;
  forKids: string[] | null;
  everyone: boolean;
  requestFrom: string | null;
  savedAt: string;
  /** The upload signer's job, once one was made (its row in jobs.json). */
  jobId: string | null;
  /** Sends started after a relaunch. */
  resends: number;
};

/** A recording that fails to send this many launches in a row stops being sent by itself (its videos stay). */
export const MAX_RESENDS = 3;

/** Where a file is inside documents/, or its full uri when it isn't in there. */
export function docPath(uri: string, documentsUri: string): string {
  const base = documentsUri.endsWith('/') ? documentsUri : `${documentsUri}/`;
  return uri.startsWith(base) ? decodeURIComponent(uri.slice(base.length)) : uri;
}

export const isFullUri = (path: string) => /^[a-z]+:\/\//i.test(path);

export function withUnsent(list: Unsent[], next: Unsent): Unsent[] {
  return [next, ...list.filter((u) => u.recordingId !== next.recordingId)];
}

export function patchUnsent(list: Unsent[], recordingId: string, patch: Partial<Unsent>): Unsent[] {
  return list.map((u) => (u.recordingId === recordingId ? { ...u, ...patch } : u));
}

export function withoutUnsent(list: Unsent[], recordingId: string): Unsent[] {
  return list.filter((u) => u.recordingId !== recordingId);
}

/**
 * What a launch does with one that's waiting. `convexJobId`: the job on its Convex recording (null =
 * none, undefined = Convex couldn't say). 'sent': the job exists, forget the note. 'gone': its videos
 * aren't on the phone, nothing to send. 'wait': ask again next launch. 'give-up': it failed too often
 * (the videos stay in documents/recordings/). 'send': send it now.
 */
export type ResendStep = 'sent' | 'gone' | 'wait' | 'give-up' | 'send';

export function resendStep(u: Pick<Unsent, 'resends'>, at: { convexJobId: string | null | undefined; filesHere: boolean }): ResendStep {
  if (at.convexJobId) return 'sent';
  if (!at.filesHere) return 'gone';
  if (at.convexJobId === undefined) return 'wait';
  return u.resends >= MAX_RESENDS ? 'give-up' : 'send';
}

/** The cook with a recording still waiting in this family (the newest), or null. */
export function waitingCook(list: Unsent[], familyId: string | null): string | null {
  if (!familyId) return null;
  return list.find((u) => u.familyId === familyId && u.resends < MAX_RESENDS)?.cookId ?? null;
}
