// "Your language: Marathi · मराठी", a quiet link in the foot of "Who's in the kitchen?" (from
// "Mom ▾"), for a cook already in: the language homie talks with her in (people.setLanguage). A new
// cook picks it when she joins (app/join.tsx).
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { LanguageSheet, languageLabel } from '@/components/record/LanguagePicker';
import { PressableScale, Txt, useToast } from '@/components/ui';
import { languageName } from '@/lib/languages';
import { setLanguage, useMe } from '@/lib/live/convex';
import { useSession } from '@/lib/session';
import { colors } from '@/theme/tokens';

export function LanguageEntry() {
  const { me } = useSession();
  const cook = me?.role === 'cook';
  const convexMe = useMe(cook);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  if (!cook) return null;
  const current = picked ?? convexMe?.language ?? 'en';

  const pick = async (code: string) => {
    setOpen(false);
    if (code === current) return;
    setPicked(code);
    try {
      await setLanguage(code, me?.id);
      toast.show(`homie will talk with you in ${languageName(code)}`);
    } catch (e) {
      setPicked(null);
      toast.show('That didn’t save. Check the connection and try again.', { tone: 'error' });
      console.warn('[profiles] setLanguage', String(e));
    }
  };

  return (
    <>
      <PressableScale
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Your language: ${languageLabel(current)}`}
        accessibilityHint="Pick the language homie talks with you in"
        style={styles.link}>
        <Txt variant="label" weight={600} color={colors.muted}>
          Your language: {languageLabel(current)}
        </Txt>
      </PressableScale>
      <LanguageSheet visible={open} value={current} onPick={(code) => void pick(code)} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  link: { minHeight: 48, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
});
