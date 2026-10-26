// Card colours for the share sheet (SPEC 5: peach, sage, ink).
import type { WordKey } from '@/lib/words/words';

export type SwatchId = 'peach' | 'sage' | 'ink';

/** `label`: the swatch's spoken name ("Peach card"), read with t(). */
export const SWATCHES: { id: SwatchId; label: WordKey; stage: string; dark: boolean }[] = [
  { id: 'peach', label: 'share.swatch.peach', stage: '#F9E3CF', dark: false },
  { id: 'sage', label: 'share.swatch.sage', stage: '#E6EBCF', dark: false },
  { id: 'ink', label: 'share.swatch.ink', stage: '#1E2410', dark: true },
];
