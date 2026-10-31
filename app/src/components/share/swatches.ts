// Card colours for the share sheet (SPEC 5), in the egg palette: the yolk tint, the green tint and ink.
// The ids (and the spoken names) are still peach / sage / ink. TODO(caleb): rename "Peach card" and "Sage
// card" in every language (share.swatch.*) to the new colours' names.
import type { WordKey } from '@/lib/words/words';

export type SwatchId = 'peach' | 'sage' | 'ink';

/** `label`: the swatch's spoken name ("Peach card"), read with t(). */
export const SWATCHES: { id: SwatchId; label: WordKey; stage: string; dark: boolean }[] = [
  { id: 'peach', label: 'share.swatch.peach', stage: '#FCEBD0', dark: false },
  { id: 'sage', label: 'share.swatch.sage', stage: '#DCEBE2', dark: false },
  { id: 'ink', label: 'share.swatch.ink', stage: '#18221D', dark: true },
];
