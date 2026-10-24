// The recording being prepared: Record (camera / library) fills it, Send reads it, a finished send
// clears it. Lives in memory only: the picked files are already on the phone, and a fresh launch
// starts a fresh recording.
//
//   const draft = useDraft();
//   addClips(clips, { dish, requestFrom });   toggleClip(key);   clearDraft();
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
  /** The profile who asked for it (pre-selected in "Who is it for?"). */
  requestFrom: string | null;
};

const EMPTY: Draft = { clips: [], dish: null, requestFrom: null };

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
export function addClips(clips: DraftClip[], ctx: { dish?: string | null; requestFrom?: string | null } = {}) {
  // The same library video picked twice is kept once.
  const known = new Set(draft.clips.map((c) => c.asset.assetId ?? c.asset.uri));
  const fresh = clips.filter((c) => !known.has(c.asset.assetId ?? c.asset.uri));
  set({
    clips: [...draft.clips, ...fresh],
    dish: draft.dish ?? ctx.dish ?? null,
    requestFrom: draft.requestFrom ?? ctx.requestFrom ?? null,
  });
}

export function toggleClip(key: string) {
  set({ ...draft, clips: draft.clips.map((c) => (c.key === key ? { ...c, selected: !c.selected } : c)) });
}

export function clearDraft() {
  set(EMPTY);
}
