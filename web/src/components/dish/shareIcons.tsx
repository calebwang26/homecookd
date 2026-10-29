// The share row's glyphs, path for path from the app (app/src/components/ui/icons.tsx, and the
// Instagram camera from share/ExternalRow.tsx), so the web row draws what the app draws. Not the
// brands' own marks. Decorative: the buttons carry the names.
import type { ReactNode } from 'react';

type P = { size?: number; strokeWidth?: number };

function Stroke({ size = 24, strokeWidth = 2, children }: P & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const LinkIcon = (p: P) => (
  <Stroke {...p}>
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
  </Stroke>
);

export const MessageIcon = (p: P) => (
  <Stroke {...p}>
    <path d="M5.5 4.5h13A2.5 2.5 0 0 1 21 7v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5v-3.5h-1A2.5 2.5 0 0 1 3 15V7a2.5 2.5 0 0 1 2.5-2.5z" />
    <path d="M8 9.5h8M8 13h5" />
  </Stroke>
);

export const InstagramIcon = (p: P) => (
  <Stroke {...p}>
    <rect x={3.5} y={3.5} width={17} height={17} rx={5} />
    <circle cx={12} cy={12} r={3.8} />
    <circle cx={17.1} cy={6.9} r={0.6} fill="currentColor" />
  </Stroke>
);

export const WhatsAppIcon = (p: P) => (
  <Stroke {...p}>
    <path d="M12 3.5a8.5 8.5 0 0 0-7.4 12.7L3.5 20.5l4.4-1.1A8.5 8.5 0 1 0 12 3.5z" />
    <path d="M9 8.6c.3-.4.8-.4 1 0l.8 1.6c.1.3 0 .6-.2.8l-.5.5a6 6 0 0 0 2.4 2.4l.5-.5c.2-.2.5-.3.8-.2l1.6.8c.4.2.4.7 0 1-.6.6-1.5.9-2.3.6a8 8 0 0 1-4.6-4.6c-.3-.8 0-1.7.5-2.4z" />
  </Stroke>
);

export const MoreIcon = ({ size = 24 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <circle cx={5} cy={12} r={2} />
    <circle cx={12} cy={12} r={2} />
    <circle cx={19} cy={12} r={2} />
  </svg>
);

/** The app's CheckIcon (stroke 3 by default; the badge and the toast use 3.5). */
export const CheckIcon = ({ strokeWidth = 3, ...p }: P) => (
  <Stroke strokeWidth={strokeWidth} {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Stroke>
);
