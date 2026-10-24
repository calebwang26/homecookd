// homie says hello once per person on this phone (Caleb, Oct 24). The first tap on a screen without a
// line of its own says "Hi, I’m homie."; after that, those screens say HELP.again. The recording
// hello counts too (lib/live/homie). Kept with kv under `homie.introduced.<profileId>`, so it lasts
// across app restarts. Plain TS (lib/storage is a map in scripts/test-homie.mjs).
import { kvGet, kvSet } from '@/lib/storage';

import { HELP, type HomieRoute } from './logic';

export const introducedKey = (profileId: string) => `homie.introduced.${profileId}`;

// Taps land faster than storage answers: the first one claims the hello.
const claimed = new Set<string>();

/** homie has said hello to this person (the recording hello). */
export function markIntroduced(profileId: string | null | undefined): void {
  if (!profileId || claimed.has(profileId)) return;
  claimed.add(profileId);
  void kvSet(introducedKey(profileId), new Date().toISOString());
}

/**
 * What a tap on the resting pot says here: the screen's own line, or on the other screens the hello
 * the first time and HELP.again after. Never throws (storage failures read as "not said yet").
 */
export async function takeTapLine(route: Pick<HomieRoute, 'help'>, profileId: string | null | undefined): Promise<string> {
  if (route.help !== HELP.hello || !profileId) return route.help;
  if (claimed.has(profileId)) return HELP.again;
  claimed.add(profileId);
  if (await kvGet(introducedKey(profileId))) return HELP.again;
  void kvSet(introducedKey(profileId), new Date().toISOString());
  return HELP.hello;
}

/** Tests only: forget the in-memory guard (an app restart). */
export function resetIntroForTests(): void {
  claimed.clear();
}
