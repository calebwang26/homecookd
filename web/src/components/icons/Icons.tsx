// Icon set (brief 5 "Icons.tsx"). All icons are decorative by default (aria-hidden); pass `title`
// to make one meaningful. Stroke icons use currentColor.
//
//   <PlayIcon size={18} />   <ArrowRightIcon />   <HeartIcon className={s.heart} />
//   <KitchenIcon name="whisk" size={32} />          // kitchen line icons, 1.8px stroke, round caps
//   <ShareGlyph name="message" size={24} />
import type { ReactNode, SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'stroke'> {
  size?: number | string;
  /** stroke width (stroke icons only) */
  stroke?: number;
  title?: string;
}

function Svg({ size = 24, stroke = 1.8, title, children, viewBox = '0 0 24 24', fill = 'none', ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill={fill}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/* ---------------- UI ---------------- */

export const PlayIcon = (p: IconProps) => (
  <Svg {...p} stroke={0} fill="currentColor">
    <path d="M8 5.6v12.8a1 1 0 0 0 1.52.85l10.2-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6z" />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p} stroke={0} fill="currentColor">
    <rect x="6.5" y="5" width="4" height="14" rx="1.4" />
    <rect x="13.5" y="5" width="4" height="14" rx="1.4" />
  </Svg>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

export const ArrowDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);

export const HeartIcon = (p: IconProps) => (
  <Svg {...p} stroke={0} fill="currentColor" viewBox="0 0 24 22">
    <path d="M12 20s-8-5-10.5-10A5.5 5.5 0 0 1 12 4.5 5.5 5.5 0 0 1 22.5 10C20 15 12 20 12 20z" />
  </Svg>
);

export const SpeakerIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" fill="currentColor" stroke="none" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Svg>
);

export const MoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);

export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const CameraIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const RecDot = (p: IconProps) => (
  <Svg {...p} stroke={0} fill="currentColor">
    <circle cx="12" cy="12" r="6" />
  </Svg>
);

/* ---------------- Share glyphs (generic, no third-party logos) ---------------- */

export type ShareGlyphName = 'message' | 'mail' | 'link' | 'qr' | 'family';

const SHARE: Record<ShareGlyphName, ReactNode> = {
  message: <path d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 16h-6l-4.5 3.5V16H7a2.5 2.5 0 0 1-2.5-2.5z" />,
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="M4.5 7.5l7.5 5.5 7.5-5.5" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 0 0-5.66-5.66L11.5 6.8" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-2.83 2.83a4 4 0 0 0 5.66 5.66l1.33-1.3" />
    </>
  ),
  qr: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1.2" />
      <rect x="14" y="4" width="6" height="6" rx="1.2" />
      <rect x="4" y="14" width="6" height="6" rx="1.2" />
      <path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 19.5V20M19.5 14h.5" />
    </>
  ),
  family: (
    <>
      <circle cx="8" cy="8" r="2.6" />
      <circle cx="16.5" cy="9" r="2.1" />
      <path d="M3.5 18.5c.4-3 2.3-4.8 4.5-4.8s4.1 1.8 4.5 4.8M13 18.5c.3-2.4 1.7-3.8 3.5-3.8s3.2 1.4 3.5 3.8" />
    </>
  ),
};

export function ShareGlyph({ name, ...p }: IconProps & { name: ShareGlyphName }) {
  return <Svg {...p}>{SHARE[name]}</Svg>;
}

/* ---------------- Kitchen line icons (1.8px stroke, round caps) ---------------- */

export type KitchenIconName =
  | 'whisk'
  | 'wooden-spoon'
  | 'ladle'
  | 'pot'
  | 'chili'
  | 'garlic'
  | 'timer'
  | 'rolling-pin'
  | 'flame'
  | 'scallion';

const KITCHEN: Record<KitchenIconName, ReactNode> = {
  whisk: (
    <>
      <path d="M12 13.5V21" />
      <path d="M12 13.5c-3.2 0-4.5-3.6-4.5-6.2C7.5 4.6 9.6 3 12 3s4.5 1.6 4.5 4.3c0 2.6-1.3 6.2-4.5 6.2z" />
      <path d="M12 13.5c-1.4 0-2-3.4-2-6.2S10.8 3 12 3s2 1.5 2 4.3-.6 6.2-2 6.2z" />
    </>
  ),
  'wooden-spoon': (
    <>
      <ellipse cx="15.5" cy="7.5" rx="3.6" ry="4.8" transform="rotate(40 15.5 7.5)" />
      <path d="M12.6 10.6L4.5 19.5" />
    </>
  ),
  ladle: (
    <>
      <path d="M17 3.5l-6.2 9" />
      <path d="M5 12.5h11a5.5 5.5 0 0 1-11 0z" />
    </>
  ),
  pot: (
    <>
      <path d="M5 10h14v6.5A3.5 3.5 0 0 1 15.5 20h-7A3.5 3.5 0 0 1 5 16.5z" />
      <path d="M3 11.5h2M19 11.5h2M4.5 10h15M11 7h2" />
      <path d="M9 6.2c-.8-1 .8-1.6 0-2.7M15 6.2c-.8-1 .8-1.6 0-2.7" />
    </>
  ),
  chili: (
    <>
      <path d="M17.5 7.5c1.4 3.6-.4 9.8-9.2 12.5-2 .6-3.6-.6-2.2-1.6 5.7-4 6.9-7.5 7.6-10.4.4-1.6 3.1-2 3.8-.5z" />
      <path d="M16.6 7.3c.2-1.6 1-2.9 2.6-3.6" />
    </>
  ),
  garlic: (
    <>
      <path d="M12 4c.3 2.2 2.2 3.2 3.8 4.8C17.5 10.5 18.5 12 18.5 14a6.5 6 0 0 1-13 0c0-2 1-3.5 2.7-5.2C9.8 7.2 11.7 6.2 12 4z" />
      <path d="M12 9.5c-1.3 1.6-1.8 3.5-1.8 5.4M12 9.5c1.3 1.6 1.8 3.5 1.8 5.4M9 20.2l-.4 1M15 20.2l.4 1M12 20.4V21.5" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13.5" r="7" />
      <path d="M12 13.5V10M10 3.5h4M12 3.5v3M18.2 7.3l1.3-1.3" />
    </>
  ),
  'rolling-pin': (
    <>
      <rect x="6.3" y="9.3" width="11.4" height="5.4" rx="2.7" transform="rotate(-35 12 12)" />
      <path d="M3.5 17.9l2.3-1.6M18.2 7.6l2.3-1.6" />
    </>
  ),
  flame: (
    <>
      <path d="M12 21c3.6 0 6-2.5 6-6 0-4-3-6.2-4-9.5-.4 2.3-1.6 3.5-2.8 4.3C10 8.6 9.3 7 9.5 5 7.4 7 6 10 6 15c0 3.5 2.4 6 6 6z" />
      <path d="M12 21c-1.5 0-2.5-1-2.5-2.6 0-1.8 1.4-2.6 2.2-4 .4 1.3 2.8 2.1 2.8 4 0 1.6-1 2.6-2.5 2.6z" />
    </>
  ),
  scallion: (
    <>
      <path d="M8 21c-.6-3.6 0-6 1.2-8.6L14 3M10.5 21c.2-3 1.4-5.6 3-8l4-7M8 21h3" />
      <path d="M9.2 12.4c1.4.3 2.6 1 3.6 2.1" />
    </>
  ),
};

export const KITCHEN_ICONS = Object.keys(KITCHEN) as KitchenIconName[];

export function KitchenIcon({ name, ...p }: IconProps & { name: KitchenIconName }) {
  return <Svg {...p}>{KITCHEN[name]}</Svg>;
}

/** Spoon glyph used for "what made it special" callouts. */
export const SpoonIcon = (p: IconProps) => <KitchenIcon {...p} name="wooden-spoon" />;
