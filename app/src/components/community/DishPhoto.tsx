// A Community dish photo: our own stock photo when the feed has one, else the dish's name on a soft tile
// (ui/NoPhoto: never the egg, never another photo). A family's video frames never show here
// (community.feed only passes homecookd.app stock covers).
import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { NoPhoto } from '@/components/ui';
import { colors } from '@/theme/tokens';

export function DishPhoto({
  uri,
  label,
  title = label,
  size = 64,
  style,
}: {
  uri: string | null;
  label: string;
  /** The dish's name for the no-photo tile (defaults to `label`). */
  title?: string;
  /** The tile's height (under 100: the name's first letter). */
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.box, style]}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessibilityLabel={label} />
      ) : (
        <NoPhoto title={title} size={size} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', backgroundColor: colors.well, alignItems: 'center', justifyContent: 'center' },
});
