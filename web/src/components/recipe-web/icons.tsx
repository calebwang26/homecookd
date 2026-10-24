// Stroke icons exactly as the Hearth bible draws them (24 viewBox, round caps). Decorative.
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 22, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

const stroke = (w = 2.2) => ({ fill: 'none', stroke: 'currentColor', strokeWidth: w, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const });

export const IconBack = (p: P) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" {...stroke()} />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg size={20} {...p}>
    <path d="M6 6l12 12M18 6 6 18" {...stroke()} />
  </Svg>
);
export const IconArrow = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" {...stroke()} />
  </Svg>
);
export const IconChevronDown = (p: P) => (
  <Svg size={20} {...p}>
    <path d="M6 9l6 6 6-6" {...stroke()} />
  </Svg>
);
export const IconPlay = (p: P) => (
  <Svg size={16} {...p}>
    <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" />
  </Svg>
);
export const IconPause = (p: P) => (
  <Svg size={16} {...p}>
    <rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" />
    <rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" />
  </Svg>
);
export const IconWave = (p: P) => (
  <Svg size={18} {...p}>
    <path d="M4 9v6M8 6v12M12 3v18M16 7v10M20 10v4" {...stroke(2)} />
  </Svg>
);
export const IconHeart = ({ filled, ...p }: P & { filled?: boolean }) => (
  <Svg {...p}>
    <path
      d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinejoin="round"
    />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg size={16} {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" {...stroke(3)} />
  </Svg>
);
export const IconEye = (p: P) => (
  <Svg size={20} {...p}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" {...stroke(2)} />
    <circle cx="12" cy="12" r="3" {...stroke(2)} />
  </Svg>
);
export const IconBubble = (p: P) => (
  <Svg size={24} {...p}>
    <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z" {...stroke(2)} />
  </Svg>
);
export const IconSparkle = (p: P) => (
  <Svg size={18} {...p}>
    <path d="M12 3c.6 4.6 3.4 7.4 8 8-4.6.6-7.4 3.4-8 8-.6-4.6-3.4-7.4-8-8 4.6-.6 7.4-3.4 8-8z" fill="currentColor" />
  </Svg>
);
export const IconBook = (p: P) => (
  <Svg size={18} {...p}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z" {...stroke(2)} />
  </Svg>
);
export const IconCopy = (p: P) => (
  <Svg size={18} {...p}>
    <rect x="8" y="8" width="12" height="12" rx="3" {...stroke(2)} />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" {...stroke(2)} />
  </Svg>
);
