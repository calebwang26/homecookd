// What a tap on the resting pot says, with what it remembers (the lines themselves: lib/homie/tap).
// homie says hello once per person on this phone (Caleb, Oct 24): the first tap line starts with "Hi,
// I’m homie.", and the recording hello counts too (lib/live/homie). Each piece of news is told once
// (kept per person, newest 50), and the screen's own lines take turns, never the same line twice in a
// row. Kept with kv under `homie.introduced.<profileId>` and `homie.told.<profileId>`, so they last
// across app restarts. Plain TS (lib/storage is a map in scripts/test-homie.mjs).
import { kvGet, kvSet } from '@/lib/storage';

import { HELP, type HomieRoute } from './logic';
import { chooseTapLine, type TapFact } from './tap';

export const introducedKey = (profileId: string) => `homie.introduced.${profileId}`;
export const toldKey = (profileId: string) => `homie.told.${profileId}`;
const TOLD_KEPT = 50;

// Taps land faster than storage answers: the first one claims the hello.
const claimed = new Set<string>();
// This run's memory: the last line said, each screen's turn, and what was told (storage fills it once).
let last: string | null = null;
const turns = new Map<string, number>();
const told = new Map<string, Promise<string[]>>();

/** homie has said hello to this person (the recording hello). */
export function markIntroduced(profileId: string | null | undefined): void {
  if (!profileId || claimed.has(profileId)) return;
  claimed.add(profileId);
  void kvSet(introducedKey(profileId), new Date().toISOString());
}

/** True the first time only (per person, across restarts). */
async function firstHello(profileId: string): Promise<boolean> {
  if (claimed.has(profileId)) return false;
  claimed.add(profileId);
  if (await kvGet(introducedKey(profileId))) return false;
  void kvSet(introducedKey(profileId), new Date().toISOString());
  return true;
}

function toldIds(profileId: string): Promise<string[]> {
  let ids = told.get(profileId);
  if (!ids) {
    ids = kvGet(toldKey(profileId))
      .then((raw) => {
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
      })
      .catch(() => []);
    told.set(profileId, ids);
  }
  return ids;
}

/**
 * What a tap here says: news first (once), else this screen's next line; the hello before the first
 * one. `news`: the person's facts and Claude's words for them (lib/homie/news). Never throws (storage
 * failures read as "nothing said yet").
 */
export async function takeTapLine(
  route: Pick<HomieRoute, 'screen'>,
  profileId: string | null | undefined,
  news: { facts: readonly TapFact[]; written?: ReadonlyMap<string, string> } = { facts: [] },
): Promise<string> {
  const ids = profileId ? await toldIds(profileId) : [];
  // Read after the wait: a second quick tap sees what the first one said.
  const turn = turns.get(route.screen) ?? 0;
  const pick = chooseTapLine({ screen: route.screen, facts: news.facts, told: new Set(ids), written: news.written, last, turn });
  last = pick.text;
  if (pick.factId) {
    ids.push(pick.factId);
    if (profileId) void kvSet(toldKey(profileId), JSON.stringify(ids.slice(-TOLD_KEPT)));
  } else turns.set(route.screen, turn + 1);
  const hello = !profileId || (await firstHello(profileId));
  return hello ? `${HELP.hello} ${pick.text}` : pick.text;
}

/** Tests only: forget this run's memory (an app restart). */
export function resetIntroForTests(): void {
  claimed.clear();
  last = null;
  turns.clear();
  told.clear();
}
