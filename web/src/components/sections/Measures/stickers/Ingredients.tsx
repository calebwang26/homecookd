// Twelve flat ingredient illustrations for the Measures physics drop (brief 8.10, owned by B4).
// Drawn on a 64×64 grid with the pot mascot's brown outline so they read as one sticker set.
// Each renders inside a white sticker circle (see Measures.module.css .sticker). Decorative.
import type { ReactElement } from 'react';

const OUT = '#4A3B30';
const SW = 2.4;

export type IngredientId =
  | 'garlic'
  | 'chili'
  | 'star-anise'
  | 'scallion'
  | 'lemon'
  | 'egg'
  | 'bay-leaf'
  | 'ginger'
  | 'dumpling'
  | 'peppercorn'
  | 'tomato'
  | 'cinnamon';

const line = { fill: 'none', stroke: OUT, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const ART: Record<IngredientId, ReactElement> = {
  garlic: (
    <>
      <path
        d="M32 8c-.8 3.2-3 6-7.4 9.4C18.4 22 13 26.6 13 34.6 13 45 21.4 53 32 53s19-8 19-18.4c0-8-5.4-12.6-11.6-17.2C35 14 32.8 11.2 32 8z"
        fill="#FFF7EA"
      />
      <path d="M19.6 31c-1.6 6-.6 12.4 3.4 17.4M44.4 31c1.6 6 .6 12.4-3.4 17.4" fill="none" stroke="#E2D3EC" strokeWidth={3.2} strokeLinecap="round" />
      <path
        d="M32 8c-.8 3.2-3 6-7.4 9.4C18.4 22 13 26.6 13 34.6 13 45 21.4 53 32 53s19-8 19-18.4c0-8-5.4-12.6-11.6-17.2C35 14 32.8 11.2 32 8z"
        {...line}
        strokeWidth={SW}
      />
      <path d="M32 19c-4.4 6.2-5.6 17.6-2.4 33M32 19c4.4 6.2 5.6 17.6 2.4 33M23.6 25.6c-4.6 6-5.4 15.6-1.4 24.6M40.4 25.6c4.6 6 5.4 15.6 1.4 24.6" {...line} strokeWidth={1.7} />
      <path d="M26.4 53.4l-1.4 3.6M30.6 53.8l-.4 4M34.4 53.8l.6 3.8M38 53.2l1.6 3.4" {...line} strokeWidth={1.7} />
    </>
  ),
  chili: (
    <>
      <path
        d="M20.4 21.6c5-4 12-3.6 16.6 1.8 5 5.8 7 14.2 13.4 21.2 2.2 2.4 3.6 4.6 3.6 6.4 0 1.6-1.6 2.4-3.6 1.8C38.6 49.6 27.4 42.4 21.4 33.4c-2.8-4-3.6-8.6-1-11.8z"
        fill="#E95D3D"
        stroke={OUT}
        strokeWidth={SW}
        strokeLinejoin="round"
      />
      <path d="M25.4 26.6c4.2.4 8 3.8 10.6 9" fill="none" stroke="#FFB8A0" strokeWidth={2.6} strokeLinecap="round" />
      <path d="M19.4 16.8c-.8-3.6.6-7 4.2-9" fill="none" stroke={OUT} strokeWidth={5} strokeLinecap="round" />
      <path d="M19.4 16.8c-.8-3.6.6-7 4.2-9" fill="none" stroke="#5B6F00" strokeWidth={2.4} strokeLinecap="round" />
      <path
        d="M15.2 19.8c1.4-4 6.2-5.6 10.4-3.6 2.6 1.2 3.2 4 1.2 5.6-3 2.4-7.6 2.8-10.2 1-1.4-.8-1.8-1.8-1.4-3z"
        fill="#788C15"
        stroke={OUT}
        strokeWidth={SW}
        strokeLinejoin="round"
      />
    </>
  ),
  'star-anise': (
    <>
      {Array.from({ length: 8 }, (_, k) => (
        <g key={k} transform={`rotate(${k * 45} 32 32)`}>
          <path
            d="M32 31c-3.4-3.6-5.2-9.6-3.6-15.6.6-2.2 2.2-3.6 3.6-3.6s3 1.4 3.6 3.6C37.2 21.4 35.4 27.4 32 31z"
            fill="#9A5A2E"
            stroke={OUT}
            strokeWidth={1.8}
            strokeLinejoin="round"
          />
          <ellipse cx={32} cy={20.6} rx={1.9} ry={3} fill="#EDB27A" />
        </g>
      ))}
      <circle cx={32} cy={32} r={3.4} fill="#6E4A33" stroke={OUT} strokeWidth={1.6} />
    </>
  ),
  scallion: (
    <>
      <path d="M12 51.6l-4.4 2.8M12.8 53.4l-3 4.4M15 53.6l-.6 4.8M17.6 55.6l-3 3.6M19.4 57l.4 4" {...line} strokeWidth={1.5} />
      {/* back stalk */}
      <path d="M19 55L52.4 21.6" fill="none" stroke={OUT} strokeWidth={9} strokeLinecap="round" />
      <path d="M29 45L52.4 21.6" fill="none" stroke="#788C15" strokeWidth={6} strokeLinecap="round" />
      <path d="M19 55l10.4-10.4" fill="none" stroke="#FFFBEF" strokeWidth={6} strokeLinecap="round" />
      {/* front stalk */}
      <path d="M13.6 50.4L48 14" fill="none" stroke={OUT} strokeWidth={9} strokeLinecap="round" />
      <path d="M25 38.4L48 14" fill="none" stroke="#A9BE3C" strokeWidth={6} strokeLinecap="round" />
      <path d="M13.6 50.4L25.4 38" fill="none" stroke="#FFFBEF" strokeWidth={6} strokeLinecap="round" />
      {/* split leaf */}
      <path d="M38.6 24c4.4-1.6 9.4-1.2 14.2.8" fill="none" stroke={OUT} strokeWidth={7} strokeLinecap="round" />
      <path d="M38.6 24c4.4-1.6 9.4-1.2 14.2.8" fill="none" stroke="#A9BE3C" strokeWidth={4} strokeLinecap="round" />
    </>
  ),
  lemon: (
    <>
      <g transform="rotate(-28 32 35)">
        <ellipse cx={8.8} cy={35} rx={3} ry={2.4} fill="#FFD24D" stroke={OUT} strokeWidth={1.8} />
        <ellipse cx={55.2} cy={35} rx={3} ry={2.4} fill="#FFD24D" stroke={OUT} strokeWidth={1.8} />
        <path d="M10 35c0-10 9.8-17 22-17s22 7 22 17-9.8 17-22 17S10 45 10 35z" fill="#FFD24D" stroke={OUT} strokeWidth={SW} />
        <path d="M18.6 28.4c4-3.2 9.4-4.4 15-4" fill="none" stroke="#FFF1C7" strokeWidth={2.8} strokeLinecap="round" />
        <circle cx={24} cy={40} r={0.9} fill="#E2A21A" />
        <circle cx={31} cy={44} r={0.9} fill="#E2A21A" />
        <circle cx={40} cy={40.6} r={0.9} fill="#E2A21A" />
        <circle cx={44} cy={33} r={0.9} fill="#E2A21A" />
      </g>
      <path d="M38.4 15.4c3.6-5.2 9.8-6.8 15.4-4.6-1.8 5.4-8 8.6-15.4 4.6z" fill="#788C15" stroke={OUT} strokeWidth={1.8} strokeLinejoin="round" />
      <path d="M38.4 15.4c4.4-1.4 8.6-2.8 12-4" fill="none" stroke="#4C5A10" strokeWidth={1.2} strokeLinecap="round" />
    </>
  ),
  egg: (
    <>
      <path
        d="M13.6 33.6c-2-9 4-17 12-19 6-1.6 9 2 14 1.4 7-.8 12 5 11.4 12-.4 4 2.6 7 1.6 11.6-1.6 7-9 9.6-15 9.4-5-.2-8 2.4-13.4 1.2-6.6-1.6-9.2-8.6-10.6-16.6z"
        fill="#FFFDF7"
        stroke={OUT}
        strokeWidth={SW}
        strokeLinejoin="round"
      />
      <path d="M17 38c.6 3.6 2 6.6 4.4 8.4" fill="none" stroke="#EFEFE6" strokeWidth={3} strokeLinecap="round" />
      <circle cx={31.4} cy={32.4} r={8.8} fill="#FEBE29" stroke={OUT} strokeWidth={2.2} />
      <path d="M27 29.6c1-2.2 3-3.4 5.2-3.4" fill="none" stroke="#FFE59A" strokeWidth={2.4} strokeLinecap="round" />
    </>
  ),
  'bay-leaf': (
    <>
      <path d="M13.4 50.4l-4.6 4.6" {...line} strokeWidth={SW} />
      <path
        d="M12.4 50.6c2-14 12-30.4 28.4-36.6 5-1.8 9-2.4 12.2-2.2-.2 3-1 7-3 12-7.6 16.4-21.6 26.2-37.6 26.8z"
        fill="#B2C248"
        stroke={OUT}
        strokeWidth={SW}
        strokeLinejoin="round"
      />
      <path d="M14.6 48.6C24.4 38.6 36 26.6 50 14.6" fill="none" stroke="#4C5A10" strokeWidth={1.7} strokeLinecap="round" />
      <path d="M23.4 39.4l-.8-6.8M29.6 33l-.6-7.6M35.8 27.2l-.2-6.6M28.2 35.4l6.2 1.6M34.4 29.6l6 1.2M40.6 24.2l5 .6" fill="none" stroke="#4C5A10" strokeWidth={1.3} strokeLinecap="round" />
      <path d="M22.6 34.6c3.6-6.6 8.6-12.2 15-16.4" fill="none" stroke="#D3E07A" strokeWidth={2.2} strokeLinecap="round" opacity={0.8} />
    </>
  ),
  ginger: (
    <>
      <path
        d="M36.4 22.6c-.4-3.4 1.4-6.4 4.4-7.4 1.8 2.4 1.8 5.4.2 8"
        fill="#F2C48D"
        stroke={OUT}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <path
        d="M9.6 38.6c-1.2-5 2.6-8.8 7.4-8.2 1-4.4 5.6-6.8 9.6-4.6 2.4-4.8 9.2-6 12.4-1.6 4-2.2 9.6.2 10 4.8 4.4.8 6.6 5.2 4.4 9-2 3.6-6.2 4.2-9.2 3-2 3.6-7.2 4.4-10.6 2.2-3.2 2.4-8.2 2-10.6-.8-4.2.6-10.4-.8-13.4-4.6z"
        fill="#F2C48D"
        stroke={OUT}
        strokeWidth={SW}
        strokeLinejoin="round"
      />
      <path d="M21.4 31.4c1.2 2 1.2 4.2.2 6.4M32.4 27.4c1.4 2.2 1.6 4.8.4 7.4M43.8 29.6c1.2 2.2 1.2 4.4-.4 6.6M27 41c1.6-.6 3.4-.6 5 .2" fill="none" stroke="#C98E55" strokeWidth={1.6} strokeLinecap="round" />
      <path d="M14.6 35c2.4-1.4 5-1.8 7.4-1.2" fill="none" stroke="#FBE1BE" strokeWidth={2.2} strokeLinecap="round" />
    </>
  ),
  dumpling: (
    <>
      <path
        d="M8 40.4c0-13 11-22 24-22s24 9 24 22c0 4-3.4 6.6-7.6 6.6H15.6C11.4 47 8 44.4 8 40.4z"
        fill="#FFF3DC"
        stroke={OUT}
        strokeWidth={SW}
        strokeLinejoin="round"
      />
      <path d="M13.4 42.6c6 1.4 31.2 1.4 37.2 0" fill="none" stroke="#EBD5B0" strokeWidth={2.4} strokeLinecap="round" />
      <path d="M19.6 23.2c1.6 3 1.8 6 .8 9.2M26.6 20.2c1.4 3.2 1.6 6.6.6 9.8M33.8 19.4c1 3.4 1 6.8 0 10M41 21c.8 3.2.6 6.4-.6 9.4M47.4 24.6c.2 2.8-.4 5.4-1.8 7.8" fill="none" stroke={OUT} strokeWidth={1.7} strokeLinecap="round" />
    </>
  ),
  peppercorn: (
    <>
      {(
        [
          [23, 25, 7, '#5A3A22'],
          [38.4, 23.4, 6.4, '#788C15'],
          [30.6, 37.8, 7.4, '#5A3A22'],
          [45, 36.6, 6, '#E9937F'],
          [19, 42.6, 5.6, '#5A3A22'],
        ] as const
      ).map(([cx, cy, r, fill], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r={r} fill={fill} stroke={OUT} strokeWidth={2} />
          <path d={`M${cx - r * 0.5} ${cy - r * 0.15}c${r * 0.15}-${r * 0.35} ${r * 0.4}-${r * 0.5} ${r * 0.7}-${r * 0.5}`} fill="none" stroke="#FFFDF7" strokeWidth={1.6} strokeLinecap="round" opacity={0.7} />
        </g>
      ))}
    </>
  ),
  tomato: (
    <>
      <circle cx={32} cy={36} r={18} fill="#E95D3D" stroke={OUT} strokeWidth={SW} />
      <path d="M20.6 32c1.4-3.6 4.4-6 8-6.6" fill="none" stroke="#FFB8A0" strokeWidth={2.8} strokeLinecap="round" />
      <path d="M32 19.6V11" fill="none" stroke={OUT} strokeWidth={2.6} strokeLinecap="round" />
      <path
        d="M32 15.8l2.6 4.2 5.4-1.6-2.6 4.6 4.8 2.4-5.6 1.2.6 5.4-5.2-3-5.2 3 .6-5.4-5.6-1.2 4.8-2.4-2.6-4.6 5.4 1.6z"
        fill="#788C15"
        stroke={OUT}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </>
  ),
  cinnamon: (
    <g transform="rotate(-32 32 32)">
      <rect x={7} y={21} width={50} height={10.4} rx={5.2} fill="#B8693A" stroke={OUT} strokeWidth={SW} />
      <path d="M17 26.2h34" fill="none" stroke="#8A4A22" strokeWidth={1.3} strokeLinecap="round" opacity={0.7} />
      <path d="M13.2 26.2c0-1.8 1.2-2.8 2.6-2.8s2.4 1.4 1.8 2.8-2 1.8-2.8 1.2" fill="none" stroke={OUT} strokeWidth={1.4} strokeLinecap="round" />
      <rect x={10} y={33.6} width={46} height={10.4} rx={5.2} fill="#A85D30" stroke={OUT} strokeWidth={SW} />
      <path d="M20 38.8h30" fill="none" stroke="#7A3F1C" strokeWidth={1.3} strokeLinecap="round" opacity={0.7} />
      <path d="M16.2 38.8c0-1.8 1.2-2.8 2.6-2.8s2.4 1.4 1.8 2.8-2 1.8-2.8 1.2" fill="none" stroke={OUT} strokeWidth={1.4} strokeLinecap="round" />
      <path d="M22 23.6c6-.8 14-.8 22 0" fill="none" stroke="#D99566" strokeWidth={1.6} strokeLinecap="round" opacity={0.8} />
    </g>
  ),
};

export const INGREDIENT_LABEL: Record<IngredientId, string> = {
  garlic: 'garlic',
  chili: 'chili',
  'star-anise': 'star anise',
  scallion: 'scallion',
  lemon: 'lemon',
  egg: 'egg',
  'bay-leaf': 'bay leaf',
  ginger: 'ginger',
  dumpling: 'dumpling',
  peppercorn: 'peppercorns',
  tomato: 'tomato',
  cinnamon: 'cinnamon stick',
};

export function Ingredient({ id, className }: { id: IngredientId; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      {ART[id]}
    </svg>
  );
}
