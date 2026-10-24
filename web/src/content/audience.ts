// The two lander versions (one codebase, same sections and images, different words).
//   parent → /       the one who cooks (copy.parent.ts); the default home page. /teach renders it too.
//   kid    → /learn  the one who misses the cooking (copy.ts)
// Who sees which, and the switch between them: src/lib/audience-route.ts.
export type Audience = 'kid' | 'parent';

export const AUDIENCES: readonly Audience[] = ['kid', 'parent'];

/** Where each version lives (the only path table; links, canonicals and share images use it). */
export const AUDIENCE_PATH: Record<Audience, string> = { parent: '/', kid: '/learn' };

/** The other version (the cross-links on each page point here). */
export function otherAudience(a: Audience): Audience {
  return a === 'kid' ? 'parent' : 'kid';
}
