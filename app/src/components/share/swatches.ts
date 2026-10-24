// Card colours for the share sheet (SPEC 5: peach, sage, ink).
export type SwatchId = 'peach' | 'sage' | 'ink';

export const SWATCHES: { id: SwatchId; label: string; stage: string; dark: boolean }[] = [
  { id: 'peach', label: 'Peach', stage: '#F9E3CF', dark: false },
  { id: 'sage', label: 'Sage', stage: '#E6EBCF', dark: false },
  { id: 'ink', label: 'Ink', stage: '#1E2410', dark: true },
];
