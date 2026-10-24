// "What language do you cook in?": a search field (the Recipes search pill's look) over the list,
// English first. "mar" and "मरा" both find "Marathi · मराठी" (lib/languages matchLanguages).
//
//   <LanguagePicker value="mr" onChange={setLang} />            inline (join: the page scrolls)
//   <LanguageSheet visible value onPick onClose />               in a sheet (its own scroll)
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { BottomSheet, CheckIcon, CloseIcon, haptic, PressableScale, SearchIcon, Txt } from '@/components/ui';
import { LANGUAGES, matchLanguages, type Language } from '@/lib/languages';
import { alpha, colors, fonts, radii, shadows } from '@/theme/tokens';

export const LANGUAGE_QUESTION = 'What language do you cook in?';

/** "Marathi · मराठी", or "English" when the two are the same. */
export function languageLabel(code: string | null | undefined): string {
  const l = LANGUAGES.find((x) => x.code === (code ?? 'en').toLowerCase());
  if (!l) return code ?? 'English';
  return l.native === l.name ? l.name : `${l.name} · ${l.native}`;
}

export function LanguagePicker({ value, onChange, onSheet = false }: { value: string; onChange: (code: string) => void; onSheet?: boolean }) {
  const [query, setQuery] = useState('');
  const found = matchLanguages(query);
  return (
    <View style={styles.col}>
      <View style={[styles.field, onSheet && styles.fieldOnSheet]}>
        <SearchIcon size={20} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search: Marathi, Hindi, Español…"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Search languages"
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          selectionColor={colors.green}
          style={styles.input}
        />
        {query ? (
          <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)}>
            <PressableScale onPress={() => setQuery('')} haptic accessibilityLabel="Clear search" hitSlop={13} style={styles.clear}>
              <CloseIcon size={14} color={colors.card} strokeWidth={2.6} />
            </PressableScale>
          </Animated.View>
        ) : null}
      </View>
      <View style={styles.list} accessibilityRole="radiogroup" accessibilityLabel="Languages">
        {found.map((l) => (
          <Row key={l.code} l={l} on={l.code === value} onPress={() => onChange(l.code)} />
        ))}
        {found.length === 0 ? (
          <Txt variant="meta" align="center" style={styles.none}>
            No language by that name yet.
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

function Row({ l, on, onPress }: { l: Language; on: boolean; onPress: () => void }) {
  return (
    <PressableScale
      onPress={() => {
        if (!on) haptic('selection');
        onPress();
      }}
      scaleTo={0.98}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={l.native === l.name ? l.name : `${l.name}, ${l.native}`}
      style={[styles.row, on && styles.rowOn]}>
      <Txt variant="label" size={17} weight={700} color={colors.ink} numberOfLines={1} style={styles.flex}>
        {l.name}
        {l.native !== l.name ? (
          <Txt variant="label" size={17} weight={500} color={colors.muted}>
            {`  ·  ${l.native}`}
          </Txt>
        ) : null}
      </Txt>
      {on ? (
        <View style={styles.check}>
          <CheckIcon size={14} color={colors.card} strokeWidth={3} />
        </View>
      ) : null}
    </PressableScale>
  );
}

export function LanguageSheet({ visible, value, onPick, onClose }: { visible: boolean; value: string; onPick: (code: string) => void; onClose: () => void }) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={LANGUAGE_QUESTION} accessibilityLabel={LANGUAGE_QUESTION} maxHeightRatio={0.85}>
      <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <LanguagePicker value={value} onChange={onPick} onSheet />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  col: { gap: 12 },
  flex: { flex: 1 },
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
  // On a cream sheet the field takes the page tone, as the sheets' other fields do.
  fieldOnSheet: { backgroundColor: colors.page, boxShadow: 'none' },
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
  list: { gap: 6 },
  row: {
    minHeight: 56,
    paddingHorizontal: 18,
    borderRadius: radii.tile,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: alpha.hairline,
  },
  rowOn: { backgroundColor: colors.sage, borderColor: 'transparent' },
  check: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  none: { paddingVertical: 16 },
  sheetScroll: { maxHeight: 460 },
});
