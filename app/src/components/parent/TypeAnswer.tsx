// A question's answer, typed (homie switched off, lib/homie/switch: no walkie-talkie to answer out loud). Opens
// under the question row on Parent Home: a field and Send. A typed answer counts like a spoken one
// (questions.answer): a kid's question goes to the kid, and homie's own follow-up ("Did you add cumin?") reads
// its yes or no. The row leaves the list once it's answered.
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ActionButton, useToast } from '@/components/ui';
import { ensureAiConsent } from '@/lib/aiConsent';
import { answerQuestion } from '@/lib/live/convex';
import { useWords } from '@/lib/words/useWords';
import { colors, fonts, radii } from '@/theme/tokens';

const MAX_TEXT = 2000;

export function TypeAnswer({ questionId }: { questionId: string }) {
  const { t } = useWords();
  const toast = useToast();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const words = text.trim();

  const send = async () => {
    if (!words || sending) return;
    if (!(await ensureAiConsent())) return;
    setSending(true);
    try {
      await answerQuestion(questionId, { text: words });
    } catch (e) {
      console.warn('[answer] typed', String(e).slice(0, 160));
      toast.show(t('parent.questions.notSent'), { tone: 'error' });
      setSending(false);
    }
  };

  return (
    <Animated.View entering={FadeIn.duration(180)} style={styles.box}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={t('parent.questions.typePlaceholder')}
        placeholderTextColor={colors.muted}
        multiline
        autoFocus
        maxLength={MAX_TEXT}
        editable={!sending}
        accessibilityLabel={t('parent.questions.typePlaceholder')}
        style={styles.input}
      />
      <View style={styles.send}>
        <ActionButton label={t('messages.composer.send')} size="sm" state={sending ? 'loading' : 'idle'} disabled={!words} onPress={() => void send()} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radii.segment, backgroundColor: colors.well, padding: 12, gap: 10 },
  input: { minHeight: 48, maxHeight: 140, fontFamily: fonts.sansMedium, fontSize: 17, color: colors.ink, paddingVertical: 0, outlineStyle: 'none' } as object,
  send: { alignSelf: 'flex-end' },
});
