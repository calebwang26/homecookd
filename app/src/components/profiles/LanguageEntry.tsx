// "Your language: Marathi · मराठी", a quiet link in the foot of "Who's in the kitchen?" (from
// "Mom ▾"), for a cook already in: the language homie talks with her in (people.setLanguage). A new
// cook picks it when she joins (app/join.tsx).
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { LanguageSheet, languageLabel } from '@/components/record/LanguagePicker';
import { PressableScale, Txt, useToast } from '@/components/ui';
import { languageName } from '@/lib/languages';
import { useMe } from '@/lib/live/convex';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import { colors } from '@/theme/tokens';

export function LanguageEntry() {
  const { me } = useSession();
  const cook = me?.role === 'cook';
  const convexMe = useMe(cook);
  const toast = useToast();
  const { t, choose } = useWords();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  if (!cook) return null;
  const current = picked ?? convexMe?.language ?? 'en';

  const pick = async (code: string) => {
    setOpen(false);
    if (code === current) return;
    setPicked(code);
    try {
      // Only a save that reached Convex is worth a "done"; the local stub keeps it for this launch only.
      if ((await choose(code)) === 'saved') toast.show(t('profiles.language.saved', { language: languageName(code) }));
    } catch (e) {
      setPicked(null);
      toast.show(t('profiles.language.saveFailed'), { tone: 'error' });
      console.warn('[profiles] setLanguage', String(e));
    }
  };

  return (
    <>
      <PressableScale
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('profiles.language.entry', { language: languageLabel(current) })}
        accessibilityHint={t('profiles.language.entryHint')}
        style={styles.link}>
        <Txt variant="label" weight={600} color={colors.muted}>
          {t('profiles.language.entry', { language: languageLabel(current) })}
        </Txt>
      </PressableScale>
      <LanguageSheet visible={open} value={current} onPick={(code) => void pick(code)} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  link: { minHeight: 48, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
});
