// Copy for each version of the lander (src/content/audience.ts).
import type { Audience } from './audience';
import { copy, type Copy } from './copy';
import { copyParent } from './copy.parent';

export const COPY: Record<Audience, Copy> = { kid: copy, parent: copyParent };

export function getCopy(audience: Audience): Copy {
  return COPY[audience];
}
