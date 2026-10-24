// The Recipes search field: a 52 px cream pill (search icon, placeholder, a clear button once there
// is text) with the bible's field shadow. Full width; there is no voice search.
import { forwardRef } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { CloseIcon, PressableScale, SearchIcon } from '@/components/ui';
import { colors, fonts, shadows, space } from '@/theme';

type Props = {
  value: string;
  onChangeText: (t: string) => void;
  onFocus?: () => void;
  placeholder?: string;
  /** @deprecated Voice search was removed; ignored. Kept so older callers still compile. */
  onVoice?: () => void;
};

export const SearchBar = forwardRef<TextInput, Props>(function SearchBar(
  { value, onChangeText, onFocus, placeholder = 'Search dishes or cooks' },
  ref,
) {
  return (
    <View style={styles.row}>
      <View style={styles.field}>
        <SearchIcon size={20} color={colors.muted} />
        <TextInput
          ref={ref}
          value={value}
          onChangeText={onChangeText}
          onFocus={onFocus}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          accessibilityLabel="Search recipes"
          returnKeyType="search"
          enablesReturnKeyAutomatically
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="never"
          selectionColor={colors.green}
          style={styles.input}
        />
        {value ? (
          <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)}>
            <PressableScale
              onPress={() => onChangeText('')}
              haptic
              accessibilityLabel="Clear search"
              hitSlop={13}
              style={styles.clear}>
              <CloseIcon size={14} color={colors.card} strokeWidth={2.6} />
            </PressableScale>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { paddingHorizontal: space.gutter },
  field: {
    height: 52,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: colors.card,
    boxShadow: shadows.field,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    padding: 0,
    fontFamily: fonts.sans,
    fontSize: 17,
    color: colors.ink,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  clear: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(30,36,16,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
