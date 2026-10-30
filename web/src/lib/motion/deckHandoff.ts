// The kid page's deck hand-off (desktop): DeckFilm closes its fan into a stack and lets go of its pin, and
// StepsToBox picks that stack up in the same place, so the cards never leave the screen between the two.
// DeckFilm writes where its front card rests while pinned (viewport px, from its measure) and its root (the
// pin spacer, whose bottom reaches the viewport bottom as the pin lets go); StepsToBox reads both.
export const deckHandoff: { root: HTMLElement | null; x: number; y: number; cw: number } = {
  root: null,
  x: 0,
  y: 0,
  cw: 0,
};
