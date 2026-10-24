// The Sunday table in the app (RETENTION-HANDOFF 3.2): the shape GET /table returns, and the small
// rules the Homes' "This week at the table" row, the 1:1 chat header's "6 weeks" and the one-time
// milestone burst share. Pure except the milestone's remembered-once flag (lib/storage), so it runs
// under Node: scripts/test-table.mjs. The fetch & shared store are in lib/tableApi.ts.
//
//   const faces = tableFaces(profiles, table, me?.id);       // the family, memorial left out; [] -> hide the row
//   familyRecordings(table);                                 // the "I miss home" pool's scope
//   fitFaces(faces, 7);                                      // TableRow: what fits (8 at most), plus "+N"
//   canTapFace(face);                                        // false for my own face
//   const pair = pairWith(table, me.id, other.id);           // the chat header's pair, or null
//   weeksLabel(weeksOf(pair));                               // "6 weeks", or null -> show nothing
//   const n = await claimMilestone(me.id, pair);             // 12 until it's been seen on this phone
//   await milestoneSeen(me.id, pair, n);                     // the burst played: never again
//   releaseMilestone(me.id, pair, n);                        // it went away first: next time again
//
// Guardrails (handoff section 5): an unlit face is simply a face (no grey, no sad state); a pair's
// count shows only to its two people and only when there is one (no "0 weeks", nothing during an
// ember); no copy says what didn't happen. A memorial person isn't on the row at all (guardrails 2 & 7:
// a row about who took part this week would keep them unlit forever and read them as present).
import type { Profile } from './api';
import { kvGet, kvSet } from './storage';

/** One face's flame this week (GET /table `people`). */
export type TablePerson = { profile_id: string; lit: boolean };

/** A kid & cook's weeks in a row (GET /table `pairs`; only the pairs that include me). */
export type TablePair = {
  kid_id: string;
  cook_id: string;
  /** Weeks in a row; null while an ember shows (the old count is kept, nothing is shown). */
  weeks: number | null;
  ember_until: string | null;
  lit_this_week: boolean;
  /** 4, 12, 26 or 52 while `weeks` is that milestone. */
  milestone?: number;
};

/**
 * GET /table. `recordings`: the dishes this family's own recordings became (the server's delivered
 * sends), the only real dishes the kid Home's "I miss home" may play; missing from an older server,
 * which plays nothing.
 */
export type Table = { week_start: string; people: TablePerson[]; pairs: TablePair[]; recordings?: string[] };

export const TABLE_MAX_FACES = 8;
export const MILESTONES = [4, 12, 26, 52] as const;

/** `memorial: true` (GET /family): remembered, not here; left off the row (tableFaces). */
export type TableFaceProfile = Pick<Profile, 'id' | 'name' | 'role'> & { avatar_key?: string | null; memorial?: boolean };
export type TableFace = { profile: TableFaceProfile; lit: boolean; isMe: boolean };

/** A response we can trust, or null (an old server, a proxy page, junk). */
export function asTable(v: unknown): Table | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Partial<Table>;
  if (typeof t.week_start !== 'string' || !Array.isArray(t.people) || !Array.isArray(t.pairs)) return null;
  const out: Table = {
    week_start: t.week_start,
    people: t.people.filter((p): p is TablePerson => !!p && typeof p.profile_id === 'string').map((p) => ({ profile_id: p.profile_id, lit: p.lit === true })),
    pairs: t.pairs.filter((p): p is TablePair => !!p && typeof p.kid_id === 'string' && typeof p.cook_id === 'string'),
  };
  if (Array.isArray(t.recordings)) out.recordings = t.recordings.filter((id): id is string => typeof id === 'string' && !!id);
  return out;
}

/** The dishes this family's own recordings became (empty until the table says; never a guess). */
export function familyRecordings(table: Table | null | undefined): Set<string> {
  return new Set(table?.recordings ?? []);
}

/** Who is lit this week (also for the flame on "Who's in the kitchen?" tiles). */
export function litIds(table: Table | null | undefined): Set<string> {
  return new Set((table?.people ?? []).filter((p) => p.lit).map((p) => p.profile_id));
}

/**
 * The faces for "This week at the table": cooks first, then the kids, each group in the family's own
 * order. The whole family by default, so the row's "+N" counts everyone who didn't fit (fitFaces caps
 * the row at 8 cells); `max` cuts the list itself. Me included (my own flame is my part of the week)
 * and never the one cut. A face the table doesn't know yet is unlit. A memorial person is left out:
 * the row is this week's table, not the family list (they stay on Profiles and in the family list;
 * TODO(caleb) #5), so they're neither a face nor counted in "+N". No table yet, or nobody here but me:
 * [] (hide the row; never invent).
 */
export function tableFaces(
  profiles: readonly TableFaceProfile[],
  table: Table | null | undefined,
  meId: string | null | undefined,
  max = Infinity,
): TableFace[] {
  const here = profiles.filter((p) => p.memorial !== true);
  if (!table || !here.some((p) => p.id !== meId)) return [];
  const lit = litIds(table);
  const ordered = [...here.filter((p) => p.role === 'cook'), ...here.filter((p) => p.role !== 'cook')];
  let shown = ordered.slice(0, Math.max(0, max));
  const me = ordered.find((p) => p.id === meId);
  if (me && !shown.includes(me) && shown.length) shown = [...shown.slice(0, -1), me];
  return shown.map((p) => ({ profile: p, lit: lit.has(p.id), isMe: p.id === meId }));
}

/**
 * Whether a face on the row is a button (their chat, or PersonSheet): not my own. tableFaces never
 * hands over a memorial person; one built by hand still isn't a button (guardrail 2: a chat with
 * "Ask Grandma anything." would treat them as present).
 */
export function canTapFace(face: Pick<TableFace, 'isMe'> & { profile: Pick<TableFaceProfile, 'memorial'> }): boolean {
  return !face.isMe && face.profile.memorial !== true;
}

/**
 * The faces that fit in one row of `slots` cells (TableRow measures the width; never more than 8
 * cells, however wide): all of them, or `slots - 1` faces plus a "+N" cell for the rest, so N is
 * everyone in `faces` not shown. Order kept; I'm never the one cut. At least 2 slots.
 */
export function fitFaces(faces: readonly TableFace[], slots: number): { shown: TableFace[]; more: number } {
  const n = Math.max(2, Math.min(TABLE_MAX_FACES, Math.floor(Number.isFinite(slots) ? slots : 2)));
  if (faces.length <= n) return { shown: [...faces], more: 0 };
  let shown = faces.slice(0, n - 1);
  const me = faces.find((f) => f.isMe);
  if (me && !shown.includes(me)) shown = [...shown.slice(0, -1), me];
  return { shown, more: faces.length - shown.length };
}

/** The pair between me and the other person in a 1:1 chat (kid & cook either way), or null. */
export function pairWith(table: Table | null | undefined, meId: string | null | undefined, otherId: string | null | undefined): TablePair | null {
  if (!table || !meId || !otherId || meId === otherId) return null;
  return (
    table.pairs.find((p) => (p.kid_id === meId && p.cook_id === otherId) || (p.cook_id === meId && p.kid_id === otherId)) ?? null
  );
}

/** The count to show: 1 or more, else null (0 and an ember show nothing). */
export function weeksOf(pair: Pick<TablePair, 'weeks'> | null | undefined): number | null {
  const w = pair?.weeks;
  return typeof w === 'number' && Number.isFinite(w) && w >= 1 ? Math.floor(w) : null;
}

/** "1 week", "6 weeks"; null when there's nothing to show. */
export function weeksLabel(weeks: number | null | undefined): string | null {
  if (typeof weeks !== 'number' || !Number.isFinite(weeks) || weeks < 1) return null;
  const n = Math.floor(weeks);
  return n === 1 ? '1 week' : `${n} weeks`;
}

/** The milestone this pair has just reached (4, 12, 26 or 52), or null. */
export function milestoneOf(pair: TablePair | null | undefined): number | null {
  const n = pair?.milestone;
  if (typeof n !== 'number' || !(MILESTONES as readonly number[]).includes(n)) return null;
  return weeksOf(pair) === n ? n : null;
}

/** "12 weeks at the table with Mom" (the other person of the pair, from the viewer's side). */
export function milestoneTitle(n: number, otherName: string): string {
  const name = otherName.trim();
  return name ? `${n} weeks at the table with ${name}` : `${n} weeks at the table`;
}

export const milestoneKey = (meId: string, pair: Pick<TablePair, 'kid_id' | 'cook_id'>, n: number) =>
  `table.milestone.${meId}.${pair.kid_id}.${pair.cook_id}.${n}`;

// In this run: `claimed` = held by a burst, or already found seen (stops a double effect or two
// headers at once, before storage answers); `seen` = played to the end (storage has it too).
const claimed = new Set<string>();
const seen = new Set<string>();

/**
 * The milestone to celebrate now, once per person, pair & milestone on this phone: returns it while
 * it hasn't been seen here and no other burst holds it, else null (and null with no milestone). It
 * doesn't remember it: the burst calls milestoneSeen() once it has played, or releaseMilestone() if
 * it went away first (the chat closed during the claim or the hold), so a quick back tap never uses
 * it up unseen.
 */
export async function claimMilestone(meId: string | null | undefined, pair: TablePair | null | undefined): Promise<number | null> {
  const n = milestoneOf(pair);
  if (!meId || !pair || n === null) return null;
  const key = milestoneKey(meId, pair, n);
  if (claimed.has(key)) return null;
  claimed.add(key);
  if (await kvGet(key)) {
    seen.add(key);
    return null;
  }
  return n;
}

/** The burst played to the end: remembered on this phone (lib/storage), never shown again. */
export async function milestoneSeen(meId: string, pair: Pick<TablePair, 'kid_id' | 'cook_id'>, n: number): Promise<void> {
  const key = milestoneKey(meId, pair, n);
  seen.add(key);
  claimed.add(key);
  await kvSet(key, new Date().toISOString());
}

/** The burst went away before it finished: the next claim gets it again. No-op once it's been seen. */
export function releaseMilestone(meId: string, pair: Pick<TablePair, 'kid_id' | 'cook_id'>, n: number): void {
  const key = milestoneKey(meId, pair, n);
  if (!seen.has(key)) claimed.delete(key);
}
