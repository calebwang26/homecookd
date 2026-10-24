// "Mom sees your hearts" (RETENTION-HANDOFF 3.5, kid side): since PR 4 a dish's cook sees the hearts on
// her dishes, so the first heart someone leaves on a family cook's dish after that ships says so,
// once per profile on this phone, as a toast. Hearts still work as favorites everywhere.
//
//   // components/recipes/HeartButton.tsx, after fav.toggle() resolves ok:
//   const note = await takeHeartsNoteFor({ meId: me.id, entry: getCachedEntry(recipeId), profiles, wasOn: on, ok });
//   if (note) toast.show(note, { icon: <HeartIcon size={14} filled color={colors.card} /> });
//
// Shown only when it is true: the heart went from off to on and was saved, and the dish's cook is
// someone else in the family (not me, not a library cook who isn't a profile) whom GET /family says
// is not a memorial profile (guardrail 2, never addressed as present). A profile without the flag (an
// older server, a cached family from before it) counts as unknown, so the note waits. The words are a
// plain fact about who can see what; they never speak for the cook. Plain TS with no React Native
// imports (lib/storage is swapped for a map in scripts/test-hearts.mjs).
import type { Profile } from './api';
import { kvGet, kvSet } from './storage';
import type { LibraryEntry } from './types';

/** A family cook as GET /family gives them; `memorial` must be exactly false for the note to show. */
export type NoteCook = Pick<Profile, 'id' | 'name' | 'memorial'>;

type Tap = { meId: string | null | undefined; wasOn: boolean; ok: boolean };

export const heartsNoteKey = (profileId: string) => `hearts.toastSeen.${profileId}`;

/** "Mom sees your hearts". */
export function heartsNoteText(cookName: string): string {
  return `${cookName.trim()} sees your hearts`;
}

/** True when this heart tap may carry the note (before checking whether it was already shown). */
export function heartsNoteApplies(i: Tap & { cook: NoteCook | null | undefined }): boolean {
  const { meId, cook, wasOn, ok } = i;
  return !!meId && ok && !wasOn && !!cook && cook.id !== meId && cook.memorial === false && !!cook.name.trim();
}

/**
 * The family profile whose name is the dish's cook_name, case-insensitively: cookProfile()'s rule in
 * lib/recipes.ts, repeated so this file stays importable under Node. Samples count (hearts on them
 * reach the cook too); a YouTube creator or a relative outside the family matches nobody.
 */
export function heartsNoteCook<P extends NoteCook>(entry: Pick<LibraryEntry, 'cook_name'> | null | undefined, profiles: P[]): P | null {
  const n = (entry?.cook_name ?? '').trim().toLowerCase();
  return (n && profiles.find((p) => p.name.trim().toLowerCase() === n)) || null;
}

// Taps can land faster than storage answers: this keeps a double tap to one toast.
const claimed = new Set<string>();

/**
 * The toast text if this tap should show it, else null. Marks it shown for this profile (on this
 * phone) before returning, so it appears once. Never throws (storage failures read as "not shown").
 */
export async function takeHeartsNote(i: Tap & { cook: NoteCook | null | undefined }): Promise<string | null> {
  if (!heartsNoteApplies(i)) return null;
  const meId = i.meId!;
  if (claimed.has(meId)) return null;
  claimed.add(meId);
  if (await kvGet(heartsNoteKey(meId))) return null;
  await kvSet(heartsNoteKey(meId), new Date().toISOString());
  return heartsNoteText(i.cook!.name);
}

/** HeartButton's whole decision: the dish's library entry and the family as the session has them. */
export function takeHeartsNoteFor(i: Tap & { entry: Pick<LibraryEntry, 'cook_name'> | null | undefined; profiles: NoteCook[] }): Promise<string | null> {
  return takeHeartsNote({ meId: i.meId, wasOn: i.wasOn, ok: i.ok, cook: heartsNoteCook(i.entry, i.profiles) });
}

/** Whether this profile has seen the note (tests, a settings reset). */
export async function heartsNoteSeen(profileId: string): Promise<boolean> {
  return claimed.has(profileId) || !!(await kvGet(heartsNoteKey(profileId)));
}

/** Tests only: forget the in-memory guard. */
export function resetHeartsNoteForTests(): void {
  claimed.clear();
}
