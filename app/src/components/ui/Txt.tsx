// Text with the bible's type roles. Pick a `variant`, override `size` / `weight` / `color` when a
// screen needs the exact bible value (e.g. <Txt variant="display" size={34}>).
import { useContext } from 'react';
import { Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';

import { RtlContext } from '@/lib/words/context';
import { colors, typography, type SansWeight, type SerifWeight } from '@/theme/tokens';

export type TxtVariant =
  | 'display' // Fraunces 500, -0.02em. Default 32 (kid titles); 34 parent, 40 Main, 30 recipe
  | 'section' // Fraunces 500 22 (empty-state titles, sheet headings)
  | 'kitchen' // Fraunces 500 20 ("Mom's kitchen")
  | 'name' // Fraunces 600 20 (profile tile names)
  | 'brand' // Fraunces 600 22 ("homecookd")
  | 'chatName' // Fraunces 500 24 (chat header)
  | 'quote' // Fraunces italic 17/1.4 (quote cards)
  | 'quoteLg' // Fraunces italic 24/1.25 ("How long for a soft egg?")
  | 'lead' // DM Sans 17/1.45 muted ("Tap your face to come in.")
  | 'body' // DM Sans 16 muted (subtitles under titles)
  | 'bodyInk' // DM Sans 16 ink
  | 'title' // DM Sans 17/700 ink (card titles, thread names)
  | 'rowTitle' // DM Sans 16/700 ink (list row titles)
  | 'heading' // DM Sans 17/600 ink ("The cooks")
  | 'label' // DM Sans 15/600 ink (chips, outline buttons)
  | 'meta' // DM Sans 14 muted (row meta lines)
  | 'caption' // DM Sans 13 muted (times, tab labels)
  | 'tiny' // DM Sans 12 muted (bubble times)
  | 'eyebrow' // DM Sans 13/700 uppercase +0.04em muted ("IN THIS STEP")
  | 'button'; // DM Sans 18/700 cream (big pill buttons)

const roles: Record<TxtVariant, TextStyle> = {
  display: typography.display(32),
  section: typography.serif(22, 500),
  kitchen: typography.serif(20, 500),
  name: typography.serif(20, 600),
  brand: typography.serif(22, 600),
  chatName: typography.serif(24, 500),
  quote: typography.quote(17, 1.4),
  quoteLg: typography.quote(24, 1.25),
  lead: typography.sans(17, 400, colors.muted, 1.45),
  body: typography.sans(16, 400, colors.muted),
  bodyInk: typography.sans(16, 400, colors.ink),
  title: typography.sans(17, 700, colors.ink),
  rowTitle: typography.sans(16, 700, colors.ink),
  heading: typography.sans(17, 600, colors.ink),
  label: typography.sans(15, 600, colors.ink),
  meta: typography.sans(14, 400, colors.muted),
  caption: typography.sans(13, 400, colors.muted),
  tiny: typography.sans(12, 400, colors.muted),
  eyebrow: typography.eyebrow(13),
  button: typography.sans(18, 700, colors.card),
};

const serifVariants = new Set<TxtVariant>(['display', 'section', 'kitchen', 'name', 'brand', 'chatName']);
const italicVariants = new Set<TxtVariant>(['quote', 'quoteLg']);

export type TxtProps = TextProps & {
  variant?: TxtVariant;
  /** Font size override. For `display` this also rescales tracking and line height. */
  size?: number;
  /** Weight override: DM Sans 400-700, or Fraunces 400-600 for serif variants. */
  weight?: SansWeight | SerifWeight;
  color?: string;
  /** Line height as a ratio of the size (bible style, e.g. 1.4). */
  leading?: number;
  align?: TextStyle['textAlign'];
  style?: StyleProp<TextStyle>;
};

export function txtStyle(variant: TxtVariant, size?: number, weight?: number, leading?: number): TextStyle {
  const base = roles[variant];
  if (size == null && weight == null && leading == null) return base;
  const s = size ?? (base.fontSize as number);
  let style: TextStyle;
  if (variant === 'display') {
    style = { ...typography.display(s, leading ?? 1.1) };
    if (weight) style.fontFamily = typography.serif(s, weight as SerifWeight).fontFamily;
  } else if (serifVariants.has(variant)) {
    style = { ...base, ...typography.serif(s, (weight ?? (variant === 'name' || variant === 'brand' ? 600 : 500)) as SerifWeight, leading) };
  } else if (italicVariants.has(variant)) {
    style = { ...base, ...typography.quote(s, leading ?? (variant === 'quoteLg' ? 1.25 : 1.4)) };
  } else {
    const w = (weight ?? weightOf(base)) as SansWeight;
    style = { ...base, ...typography.sans(s, w, base.color as string, leading ?? ratioOf(base)) };
  }
  return style;
}

function weightOf(t: TextStyle): SansWeight {
  const f = String(t.fontFamily ?? '');
  if (f.endsWith('700Bold')) return 700;
  if (f.endsWith('600SemiBold')) return 600;
  if (f.endsWith('500Medium')) return 500;
  return 400;
}
function ratioOf(t: TextStyle) {
  return t.lineHeight && t.fontSize ? t.lineHeight / t.fontSize : undefined;
}

const RTL: TextStyle = { writingDirection: 'rtl' };

export function Txt({ variant = 'body', size, weight, color, leading, align, style, ...rest }: TxtProps) {
  // Urdu and Arabic words read right to left (lib/words); a screen's own style still wins.
  const rtl = useContext(RtlContext);
  return (
    <Text
      {...rest}
      style={[
        txtStyle(variant, size, weight, leading),
        rtl ? RTL : null,
        color ? { color } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
}
