// Every icon in the Hearth bible as a stroke SVG (24x24 viewBox, 2px round strokes unless the bible
// says otherwise). Paths are copied from docs/design/hearth-bible/source/*.dc.html.
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { colors } from '@/theme/tokens';

export type IconProps = { size?: number; color?: string; strokeWidth?: number };

type StrokeProps = IconProps & { children: React.ReactNode; defaultStroke?: number };

function Stroke({ size = 24, color = colors.ink, strokeWidth, defaultStroke = 2, children }: StrokeProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth ?? defaultStroke}
      strokeLinecap="round"
      strokeLinejoin="round">
      {children}
    </Svg>
  );
}

// Tab bar ------------------------------------------------------------------------------------------
export const HomeIcon = (p: IconProps) => (
  <Stroke {...p}>
    <Path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z" />
  </Stroke>
);
export const GridIcon = (p: IconProps) => (
  <Stroke {...p}>
    <Rect x={4} y={4} width={7} height={7} rx={2} />
    <Rect x={13} y={4} width={7} height={7} rx={2} />
    <Rect x={4} y={13} width={7} height={7} rx={2} />
    <Rect x={13} y={13} width={7} height={7} rx={2} />
  </Stroke>
);
export const ChatIcon = (p: IconProps) => (
  <Stroke {...p}>
    <Path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z" />
  </Stroke>
);
export const MicIcon = (p: IconProps) => (
  <Stroke {...p}>
    <Rect x={9} y={3} width={6} height={11} rx={3} />
    <Path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </Stroke>
);
export const BookIcon = (p: IconProps) => (
  <Stroke {...p}>
    <Path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z" />
    <Path d="M12 6v13.5" />
  </Stroke>
);

// Navigation ---------------------------------------------------------------------------------------
export const BackIcon = (p: IconProps) => (
  <Stroke defaultStroke={2.2} {...p}>
    <Path d="M15 5l-7 7 7 7" />
  </Stroke>
);
export const ChevronRightIcon = (p: IconProps) => (
  <Stroke defaultStroke={2.2} {...p}>
    <Path d="M9 5l7 7-7 7" />
  </Stroke>
);
export const ChevronDownIcon = (p: IconProps) => (
  <Stroke defaultStroke={2.2} {...p}>
    <Path d="M6 9l6 6 6-6" />
  </Stroke>
);
export const ChevronUpIcon = (p: IconProps) => (
  <Stroke defaultStroke={2.2} {...p}>
    <Path d="M6 15l6-6 6 6" />
  </Stroke>
);
export const CloseIcon = (p: IconProps) => (
  <Stroke defaultStroke={2.2} {...p}>
    <Path d="M6 6l12 12M18 6 6 18" />
  </Stroke>
);
export const ArrowRightIcon = (p: IconProps) => (
  <Stroke defaultStroke={2.2} {...p}>
    <Path d="M5 12h14M13 6l6 6-6 6" />
  </Stroke>
);
export const PlusIcon = (p: IconProps) => (
  <Stroke {...p}>
    <Path d="M12 5v14M5 12h14" />
  </Stroke>
);
export const SearchIcon = (p: IconProps) => (
  <Stroke {...p}>
    <Circle cx={11} cy={11} r={6.5} />
    <Path d="M20 20l-4-4" />
  </Stroke>
);
export const MoreIcon = ({ size = 24, color = colors.ink }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx={5} cy={12} r={2} fill={color} />
    <Circle cx={12} cy={12} r={2} fill={color} />
    <Circle cx={19} cy={12} r={2} fill={color} />
  </Svg>
);

// Media --------------------------------------------------------------------------------------------
/** Solid play triangle (bible: M7 4.5v15l12.5-7.5z). */
export const PlayIcon = ({ size = 16, color = colors.ink }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M7 4.5v15l12.5-7.5z" fill={color} />
  </Svg>
);
export const PauseIcon = ({ size = 16, color = colors.ink }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x={6} y={4.5} width={4.2} height={15} rx={1.4} fill={color} />
    <Rect x={13.8} y={4.5} width={4.2} height={15} rx={1.4} fill={color} />
  </Svg>
);
/** Filled square used while recording (Parent-Chat). */
export const StopIcon = ({ size = 30, color = colors.card }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x={6} y={6} width={12} height={12} rx={2.5} fill={color} />
  </Svg>
);
/** Solid red record dot (Parent-Home "Record a new recipe"). */
export const RecordDotIcon = ({ size = 18, color = colors.danger }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx={12} cy={12} r={8} fill={color} />
  </Svg>
);
/** Voice bars on the "Hear Mom" buttons. */
export const VoiceIcon = (p: IconProps) => (
  <Stroke {...p}>
    <Path d="M4 9v6M8 6v12M12 3v18M16 7v10M20 10v4" />
  </Stroke>
);
export const VideoIcon = (p: IconProps) => (
  <Stroke {...p}>
    <Rect x={3} y={6} width={13} height={12} rx={3} />
    <Path d="M16 10.5l5-3v9l-5-3z" />
  </Stroke>
);
export const CameraIcon = (p: IconProps) => (
  <Stroke {...p}>
    <Path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" />
    <Circle cx={12} cy={12.5} r={3.5} />
  </Stroke>
);

// Status -------------------------------------------------------------------------------------------
export const HeartIcon = ({ size = 22, color = colors.muted, strokeWidth = 2, filled = false }: IconProps & { filled?: boolean }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'} stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round">
    <Path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
  </Svg>
);
export const CheckIcon = (p: IconProps) => (
  <Stroke defaultStroke={3} {...p}>
    <Path d="M5 12.5l4.5 4.5L19 7.5" />
  </Stroke>
);
/**
 * A little pot, the postcard's rating ("How close to Dad’s?", retention PR 3): filled in the pot
 * mascot's colours when chosen, an outline in `muted` when not (about 6:1 on the page and on cards, so
 * the five empty pots read as buttons, not as disabled). Not in the bible (drawn to match PotMark).
 * TODO(caleb): pots vs dumplings (RETENTION-HANDOFF 8.3).
 */
export const PotIcon = ({ size = 24, filled = false, strokeWidth = 1.8 }: Omit<IconProps, 'color'> & { filled?: boolean }) => {
  const line = filled ? colors.potLine : colors.muted;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={line} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 11h14v4a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5z" fill={filled ? colors.potBody : 'none'} />
      <Path d="M5 13H3M19 13h2" />
      <Ellipse cx={12} cy={10.4} rx={7.6} ry={1.9} fill={filled ? colors.potLid : 'none'} />
      <Circle cx={12} cy={7} r={1.1} fill={line} />
    </Svg>
  );
};
export const ClockIcon = (p: IconProps) => (
  <Stroke {...p}>
    <Circle cx={12} cy={12} r={8.5} />
    <Path d="M12 7.5V12l3 2" />
  </Stroke>
);
export const EyeIcon = (p: IconProps) => (
  <Stroke {...p}>
    <Path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <Circle cx={12} cy={12} r={3} />
  </Stroke>
);
/** Paper plane (Parent-Send "Send to Leo"). */
export const SendIcon = (p: IconProps) => (
  <Stroke {...p}>
    <Path d="M4 12l16-8-6 16-2.5-6.5z" />
  </Stroke>
);

// Sharing ------------------------------------------------------------------------------------------
export const ShareIcon = (p: IconProps) => (
  <Stroke {...p}>
    <Path d="M12 3.5v11M8 7.5l4-4 4 4" />
    <Path d="M6 11.5H5.5A1.5 1.5 0 0 0 4 13v5.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V13a1.5 1.5 0 0 0-1.5-1.5H18" />
  </Stroke>
);
export const LinkIcon = (p: IconProps) => (
  <Stroke {...p}>
    <Path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
    <Path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
  </Stroke>
);
export const CopyIcon = (p: IconProps) => (
  <Stroke {...p}>
    <Rect x={8} y={8} width={12} height={12} rx={3} />
    <Path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" />
  </Stroke>
);
/** Text message bubble (Messages / SMS share). */
export const MessageIcon = (p: IconProps) => (
  <Stroke {...p}>
    <Path d="M5.5 4.5h13A2.5 2.5 0 0 1 21 7v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5v-3.5h-1A2.5 2.5 0 0 1 3 15V7a2.5 2.5 0 0 1 2.5-2.5z" />
    <Path d="M8 9.5h8M8 13h5" />
  </Stroke>
);
/** A WhatsApp-like glyph: phone handset inside a round speech bubble (not the brand mark). */
export const WhatsAppIcon = (p: IconProps) => (
  <Stroke {...p}>
    <Path d="M12 3.5a8.5 8.5 0 0 0-7.4 12.7L3.5 20.5l4.4-1.1A8.5 8.5 0 1 0 12 3.5z" />
    <Path d="M9 8.6c.3-.4.8-.4 1 0l.8 1.6c.1.3 0 .6-.2.8l-.5.5a6 6 0 0 0 2.4 2.4l.5-.5c.2-.2.5-.3.8-.2l1.6.8c.4.2.4.7 0 1-.6.6-1.5.9-2.3.6a8 8 0 0 1-4.6-4.6c-.3-.8 0-1.7.5-2.4z" />
  </Stroke>
);

// Food ---------------------------------------------------------------------------------------------
/** Spoon, used for "what made it special" callouts. */
export const SpoonIcon = ({ size = 22, color = colors.ink, strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Ellipse cx={16} cy={8} rx={3.2} ry={5.2} transform="rotate(45 16 8)" stroke={color} strokeWidth={strokeWidth} />
    <Path d="M13.4 10.6 3.8 20.2" stroke={color} strokeWidth={strokeWidth + 0.2} strokeLinecap="round" />
  </Svg>
);

/** Four-point sparkle, filled. Pass `gradient` for the green-to-sun launch sparkle. */
export const SparkleIcon = ({ size = 24, color = colors.sun, gradient = false }: IconProps & { gradient?: boolean }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    {gradient ? (
      <Defs>
        <LinearGradient id="sparkle" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={colors.green} />
          <Stop offset="1" stopColor={colors.sun} />
        </LinearGradient>
      </Defs>
    ) : null}
    <Path
      d="M12 1.5c.6 5.4 3.6 9.3 10.5 10.5-6.9 1.2-9.9 5.1-10.5 10.5C11.4 17.1 8.4 13.2 1.5 12 8.4 10.8 11.4 6.9 12 1.5z"
      fill={gradient ? 'url(#sparkle)' : color}
    />
  </Svg>
);

/**
 * homecookd's pot mascot, exactly as drawn in the bible's Main brand row (viewBox 0 0 100 92).
 * Width:height is 34:32 at the bible's size.
 * `mood` (retention PR 7, lib/touches potMoodAt; only where the brand row shows): 'sleepy' closes
 * its eyes, softens the smile and floats two small z's over the lid; 'waving' raises the right
 * handle as a little arm (BrandPot rocks it). Not in the bible.
 */
export function PotMark({ size = 34, mood = null }: { size?: number; mood?: 'sleepy' | 'waving' | null }) {
  const h = (size * 92) / 100;
  return (
    <Svg width={size} height={h} viewBox="0 0 100 92">
      <Path d="M22 44h56v18a20 20 0 0 1-20 20H42a20 20 0 0 1-20-20z" fill={colors.potBody} stroke={colors.potLine} strokeWidth={4} strokeLinejoin="round" />
      <Path d={mood === 'waving' ? 'M22 52h-8' : 'M22 52h-8M78 52h8'} stroke={colors.potLine} strokeWidth={5} strokeLinecap="round" />
      {mood === 'waving' ? (
        <>
          <Path d="M78 52q9-1 11-13" fill="none" stroke={colors.potLine} strokeWidth={5} strokeLinecap="round" />
          <Circle cx={89.5} cy={35} r={5} fill={colors.potBody} stroke={colors.potLine} strokeWidth={3.5} />
        </>
      ) : null}
      <Ellipse cx={50} cy={42} rx={31} ry={7} fill={colors.potLid} stroke={colors.potLine} strokeWidth={4} />
      <Circle cx={50} cy={33} r={4.5} fill={colors.potLine} />
      {mood === 'sleepy' ? (
        <>
          <Path d="M35 59q5 4.5 10 0M55 59q5 4.5 10 0" fill="none" stroke={colors.potFace} strokeWidth={3} strokeLinecap="round" />
          <Path d="M47 67q3 2.4 6 0" fill="none" stroke={colors.potFace} strokeWidth={3} strokeLinecap="round" />
          <Path d="M66 16h8l-8 9h8M80 4h6l-6 7h6" fill="none" stroke={colors.potLine} strokeOpacity={0.7} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <Circle cx={40} cy={59} r={3.6} fill={colors.potFace} />
          <Circle cx={60} cy={59} r={3.6} fill={colors.potFace} />
          <Path d="M45 65q5 5 10 0" fill="none" stroke={colors.potFace} strokeWidth={3} strokeLinecap="round" />
        </>
      )}
    </Svg>
  );
}

/** Brand row: pot + "homecookd" wordmark is composed in components (needs Txt); see Brand in ui. */
