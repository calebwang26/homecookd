// Phase 5's two doors (components/doors/TwoDoors, docs/design/phase5-cold-parents): shown once, right after the
// language screen, to a cook whose family has no recipes and no recordings yet, the mom who just installed from
// Facebook. Everyone else goes straight to Home.
//   - A family with any recipe or any recording job (ready, still processing, or failed) never sees them. That
//     keeps every existing cook out, including the TEST family's Mom, Dad and Grandma that Apple's reviewer signs
//     in as (they have Chicken Biryani), even a cook there who never filmed anything herself.
//   - Nothing is decided until this phone's "seen" flag and both Convex lists have come for this person, so the
//     doors never flash over Home. While Convex is stubbed or unreachable the lists never come: no doors.
//   - "Seen" is per profile on this phone (kv `doors.seen.<profileId>`), set when she taps a door or "Not now".
// Pure, so scripts/test-doors.mjs runs it in Node.

export type DoorsDecision = 'wait' | 'show' | 'skip';

export type DoorsInput = {
  /** Whoever is on this phone (useSession's me). */
  me: { id: string; role: string } | null | undefined;
  /** This phone's flag, and which profile it was read for (null until read). */
  seen: { profileId: string; seen: boolean } | null;
  /** The family's recipes.list rows (null until Convex answers for this person). */
  recipes: readonly unknown[] | null;
  /** Her own recording jobs, jobs.mine (null until Convex answers for this person). */
  jobs: readonly unknown[] | null;
};

/** 'show' the doors, 'skip' them for good this launch, or 'wait' (Home shows meanwhile). */
export function doorsDecision({ me, seen, recipes, jobs }: DoorsInput): DoorsDecision {
  if (!me || me.role !== 'cook') return 'skip';
  if (!seen || seen.profileId !== me.id) return 'wait';
  if (seen.seen) return 'skip';
  // One list with anything in it settles it; "nothing yet" needs both.
  if ((recipes?.length ?? 0) > 0 || (jobs?.length ?? 0) > 0) return 'skip';
  return recipes == null || jobs == null ? 'wait' : 'show';
}

/** This phone's memory that a profile saw the doors. */
export const doorsSeenKey = (profileId: string) => `doors.seen.${profileId}`;
