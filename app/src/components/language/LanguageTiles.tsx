// The language screen: a cook's first time in with no language picked (lib/words/useWords needsChoice), before
// her home. Big tiles, each in its own script, the phone's language first and English next, so nothing has to
// be read in English. One tap saves it (people.language: homie, the recording screens and the app's words) and
// her home comes up in it. The title reads in the phone's language.
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Headline } from '@/components/signin';
import { haptic, listEnter, PressableScale, ScreenWash, Txt, useToast } from '@/components/ui';
import { LANGUAGES } from '@/lib/languages';
import { useWords } from '@/lib/words/useWords';
import { tileOrder } from '@/lib/words/words';
import { alpha, colors, radii, shadows } from '@/theme/tokens';

export function LanguageTiles() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { t, lang, choose } = useWords();
  const pick = (code: string) => {
    haptic('selection');
    choose(code).catch(() => toast.show(t('common.language.saveFailed')));
  };
  return (
    <View style={styles.root}>
      <ScreenWash tone="parent" height={420} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: Math.max(112, insets.top + 72), paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}>
        {/* homie's own pot floats over the top of every screen, so no wordmark here. */}
        <Animated.View entering={listEnter(0)} style={styles.top}>
          <Headline title={t('common.language.title')} line={t('common.language.line')} />
        </Animated.View>
        <Animated.View entering={listEnter(1)} style={styles.grid} accessibilityRole="radiogroup">
          {tileOrder(lang).map((code) => {
            const l = LANGUAGES.find((x) => x.code === code);
            if (!l) return null;
            return (
              <PressableScale
                key={code}
                onPress={() => pick(code)}
                scaleTo={0.96}
                accessibilityRole="radio"
                accessibilityLabel={l.native === l.name ? l.name : `${l.native}, ${l.name}`}
                style={styles.tile}>
                <Txt variant="name" size={24} align="center" numberOfLines={1} adjustsFontSizeToFit>
                  {l.native}
                </Txt>
                {l.native !== l.name ? (
                  <Txt variant="caption" align="center" numberOfLines={1}>
                    {l.name}
                  </Txt>
                ) : null}
              </PressableScale>
            );
          })}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: 20, gap: 28 },
  top: { gap: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 92,
    paddingHorizontal: 12,
    paddingVertical: 16,
    borderRadius: radii.tile,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: alpha.hairline,
    boxShadow: shadows.field,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
});
