// A Community dish photo: our own stock photo when the feed has one, else the pot on a soft tile.
// A family's video frames never show here (community.feed only passes homecookd.app stock covers).
import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { PotMark } from '@/components/ui';
import { colors } from '@/theme/tokens';

export function DishPhoto({ uri, label, pot = 40, style }: { uri: string | null; label: string; pot?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.box, style]}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessibilityLabel={label} />
      ) : (
        <PotMark size={pot} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', backgroundColor: colors.peach, alignItems: 'center', justifyContent: 'center' },
});
