// The recording being prepared: Record (camera / library) fills it, Send reads it, a finished send
// clears it. Lives in memory only: the picked files are already on the phone, and a fresh launch
// starts a fresh recording.
//
//   const draft = useDraft();
//   addClips(clips, { dish, requestFrom, glasses });   toggleClip(key);   clearDraft();
//   setDraftMeta({ dish, requestFrom, forKids, everyone, language, recordingId })   the pre-record sheet's answers
import type { ImagePickerAsset } from 'expo-image-picker';
import { useSyncExternalStore } from 'react';

export type DraftClip = {
  key: string;
  asset: ImagePickerAsset;
  source: 'camera' | 'library';
  /** When the recording started, when we know it (camera clips). ISO string. */
  recordedAt: string | null;
  selected: boolean;
  /** Dev preview only: an image to show in place of a video frame. */
  previewImage?: string | null;
};

export type Draft = {
  clips: DraftClip[];
  /** The dish, when we know it (a learner's request). null = ask on the Send screen. */
  dish: string | null;
  /** The profile who asked for it (pre-selected in "Who is it for?"), or the first kid ticked. */
  requestFrom: string | null;
  /** The kids ticked on the pre-record sheet (components/record/who.ts); null = the sheet didn't ask. */
  forKids: string[] | null;
  /** Every kid ticked on the pre-record sheet: it goes to everyone. */
  everyone: boolean;
  /** Filmed on smart glasses, imported from the camera roll (Convex jobs.create `source`). */
  glasses: boolean;
  /** The language she cooked in (an ISO 639-1 code), when she picked it or people.me had loaded. */
  language: string | null;
  /** homie's live session for these videos (phone camera), for jobs.create. */
  recordingId: string | null;
};

const EMPTY: Draft = { clips: [], dish: null, requestFrom: null, forKids: null, everyone: false, glasses: false, language: null, recordingId: null };

let draft: Draft = EMPTY;
const listeners = new Set<() => void>();

function set(next: Draft) {
  draft = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const get = () => draft;

export function useDraft(): Draft {
  return useSyncExternalStore(subscribe, get, get);
}

export function getDraft(): Draft {
  return draft;
}

let seq = 0;
export function clipKeyFor(asset: ImagePickerAsset): string {
  seq += 1;
  return `${asset.assetId ?? asset.uri}#${seq}`;
}

/** Adds clips (newly picked ones start selected). The request context only fills empty slots. */
export function addClips(clips: DraftClip[], ctx: { dish?: string | null; requestFrom?: string | null; glasses?: boolean } = {}) {
  // The same library video picked twice is kept once.
  const known = new Set(draft.clips.map((c) => c.asset.assetId ?? c.asset.uri));
  const fresh = clips.filter((c) => !known.has(c.asset.assetId ?? c.asset.uri));
  set({
    ...draft,
    clips: [...draft.clips, ...fresh],
    dish: draft.dish ?? ctx.dish ?? null,
    requestFrom: draft.requestFrom ?? ctx.requestFrom ?? null,
    glasses: draft.glasses || !!ctx.glasses,
  });
}

/** What the pre-record sheet settled, before any video is in. It replaces what was there. */
export function setDraftMeta(meta: Partial<Pick<Draft, 'dish' | 'requestFrom' | 'forKids' | 'everyone' | 'language' | 'recordingId'>>) {
  set({ ...draft, ...meta });
}

export function toggleClip(key: string) {
  set({ ...draft, clips: draft.clips.map((c) => (c.key === key ? { ...c, selected: !c.selected } : c)) });
}

export function clearDraft() {
  set(EMPTY);
}
