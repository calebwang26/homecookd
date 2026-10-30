// The homecookd egg mascot: the kit's mood SVGs (docs/brand/, public/brand/mascot/, byte-identical).
// It replaces the old pot. The mascot reacts and never speaks for the cook; one per screen at most.
//
//   hello      greetings (the dish box, Mom's first screen, the lander)
//   listening  while a voice is playing
//   made-it    success ("Sent", "I made it", thanks)
//   sleepy     empty states and the daily limit
//   oops       errors ("We couldn't reach...")
//
// A dish card with no photo is NOT the egg: it's a cream card with the dish name in Fraunces (DishHero).
// Decorative unless `title` is set. Server-safe.
import type { CSSProperties } from 'react';

export type EggMood = 'hello' | 'listening' | 'made-it' | 'sleepy' | 'oops';

export interface EggMascotProps {
  mood?: EggMood;
  size?: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export function EggMascot({ mood = 'hello', size = 88, title, className, style }: EggMascotProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a fixed SVG from public/brand, no loader
    <img
      src={`/brand/mascot/${mood}.svg`}
      width={size}
      height={size}
      alt={title ?? ''}
      aria-hidden={title ? undefined : true}
      className={className}
      style={{ display: 'inline-block', flex: 'none', ...style }}
    />
  );
}
