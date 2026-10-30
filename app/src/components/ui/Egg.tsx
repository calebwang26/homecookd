// The homecookd egg: the logo and the mascot at once (it replaced the pot, Oct 30). The kit's SVGs as they
// are (assets/brand/, never redrawn or recolored), drawn with react-native-svg's SvgXml.
//   <EggMark size={34} />                 the logo; the file follows the rendered size (ui/eggFiles markFile)
//   <EggMascot mood="sleepy" size={88} /> a mood (ui/eggFiles): one per screen at most
// Both are pictures only (hidden from screen readers) unless `label` is given. No shadows, glows or tints
// on them (the kit's "don't"s); put them on cream, white or yolk, or use `reversed` on dark.
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { BRAND_SVGS, type BrandFile } from './brandSvgs';
import { lockupWidth, markFile, moodFile, type EggMood } from './eggFiles';

export type { EggMood };

type Common = { size?: number; label?: string; style?: StyleProp<ViewStyle> };

// The kit files' own `role` / `aria-label` (for an <img>) are dropped as they're drawn: SvgXml would pass
// them on as props React doesn't know. The wrapper View speaks for the picture instead. Nothing drawn changes.
const drawable = new Map<BrandFile, string>();
function xmlOf(file: BrandFile) {
  let xml = drawable.get(file);
  if (!xml) {
    xml = BRAND_SVGS[file].replace(/ role="img"| aria-label="[^"]*"/g, '');
    drawable.set(file, xml);
  }
  return xml;
}

function Drawn({ file, width, height, label, style }: { file: BrandFile; width: number; height: number; label?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[{ width, height }, style]}
      accessible={!!label}
      accessibilityRole={label ? 'image' : undefined}
      accessibilityLabel={label}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}
      pointerEvents="none">
      <SvgXml xml={xmlOf(file)} width={width} height={height} />
    </View>
  );
}

/** The logo mark (the "made-it" egg), as the kit's file for its size. */
export function EggMark({ size = 34, reversed = false, label, style }: Common & { reversed?: boolean }) {
  return <Drawn file={markFile(size, reversed)} width={size} height={size} label={label} style={style} />;
}

/** The egg mascot in one of its moods. */
export function EggMascot({ mood = 'hello', size = 88, label, style }: Common & { mood?: EggMood }) {
  return <Drawn file={moodFile(mood)} width={size} height={size} label={label} style={style} />;
}

/** The kit's horizontal lockup file (mark + outlined wordmark) at a height. */
export function Lockup({ height, reversed = false, label = 'homecookd', style }: { height: number; reversed?: boolean; label?: string; style?: StyleProp<ViewStyle> }) {
  const file: BrandFile = reversed ? 'lockup-horizontal-reversed.svg' : 'lockup-horizontal.svg';
  return <Drawn file={file} width={lockupWidth(height)} height={height} label={label} style={style} />;
}
