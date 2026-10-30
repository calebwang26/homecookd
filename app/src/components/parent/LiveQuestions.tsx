// Parent Home: questions a kid asked while cooking that the video couldn't answer (Convex
// questions.openForCook, live; docs/build/STACK.md "Close the loop"). One row per question: who and
// which dish, the question (in the cook's language when Track F translated it, marked "Translated"
// with the kid's own words), "Answer" (the walkie-talkie, /answer/<id>: homie reads it to her and she
// answers out loud), and the small "Hold to talk" pill as the quick way. Her voice is the answer, sent
// as a voice note and transcribed on the server. An answered question leaves the list by itself.
// Her voice goes to the AI companies (written out, translated), so the first time either way in asks
// first (lib/aiConsent): "Answer" opens nothing, and the pill records nothing, until she says yes.
// A share ask (questions.kind 'share', from Community: "Shreya wants to put your Poha on the map…")
// is a row like the others, with no step; her spoken yes or no answers it. homie's own follow-up question
// (kind 'followUp': "Did you add cumin?") reads "homie asks about your Poha", not as a kid's.
// homie switched off (lib/homie/switch): "Answer" opens a box to type the answer in (TypeAnswer) instead of the
// walkie-talkie; the pill still records a voice note.
// Nothing open: no card.
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { HoldToTalk } from '@/components/postcard/HoldToTalk';
import { questionLines } from '@/components/record/walkieLogic';
import { ChevronRightIcon, fadeOutFast, listEnter, PressableScale, Txt } from '@/components/ui';
import { askAiConsentNow, ensureAiConsent } from '@/lib/aiConsent';
import { HOMIE_ON } from '@/lib/homie/switch';
import { answerQuestion, useCookQuestions, type CookQuestion } from '@/lib/live/convex';
import { getCachedEntry } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import type { T } from '@/lib/words/words';
import { colors, radii, shadows, space } from '@/theme/tokens';

import { dishName } from './kitchen';
import { TypeAnswer } from './TypeAnswer';

function who(q: CookQuestion, t: T): string {
  const name = q.askedByName?.trim() || t('parent.questions.yourFamily');
  const e = getCachedEntry(q.recipeId);
  const dish = q.recipeTitle || (e ? dishName(e.title, e.cook_name, t) : null);
  if (q.kind === 'followUp') return dish ? t('parent.questions.homieDish', { dish }) : t('parent.questions.homieAsks');
  if (!dish) return t('parent.questions.asked', { name });
  return q.stepOrder && q.kind !== 'share' ? t('parent.questions.whoDishStep', { name, dish, step: q.stepOrder }) : `${name} · ${dish}`;
}

export function LiveQuestions({ enterIndex = 0 }: { enterIndex?: number }) {
  const { me } = useSession();
  const questions = useCookQuestions(me?.role === 'cook');
  if (!questions.length) return null;
  return (
    <Animated.View entering={listEnter(enterIndex)} exiting={fadeOutFast} layout={LinearTransition.duration(220)} style={styles.card}>
      {questions.map((q) => (
        <QuestionRow key={q._id} q={q} />
      ))}
    </Animated.View>
  );
}

function QuestionRow({ q }: { q: CookQuestion }) {
  const { t } = useWords();
  const lines = questionLines(q);
  const [typing, setTyping] = useState(false);
  const open = async () => {
    if (!HOMIE_ON) return setTyping((on) => !on);
    if (await ensureAiConsent()) router.push({ pathname: '/answer/[id]', params: { id: q._id } });
  };
  return (
    <Animated.View exiting={fadeOutFast} layout={LinearTransition.duration(220)} style={styles.row}>
      <PressableScale
        onPress={open}
        scaleTo={0.98}
        accessibilityRole="button"
        accessibilityLabel={lines.en ? t('parent.questions.labelTranslated', { who: who(q, t), question: lines.main, english: lines.en }) : `${who(q, t)}: ${lines.main}`}
        accessibilityHint={t(HOMIE_ON ? 'parent.questions.hint' : 'parent.questions.hintType')}
        style={styles.open}>
        <Txt variant="label" size={15} weight={700} color={colors.yolkDeep} numberOfLines={1}>
          {who(q, t)}
        </Txt>
        <Txt variant="title" size={20} leading={1.25} color={colors.ink}>
          “{lines.main}”
        </Txt>
        {/* Gemini's translation of the kid's words: AI words are always labelled. */}
        {lines.en ? (
          <Txt variant="meta" size={14}>
            {t('parent.questions.translated', { text: lines.en })}
          </Txt>
        ) : null}
      </PressableScale>
      <View style={styles.actions}>
        <HoldToTalk
          toName={q.askedByName ?? t('messages.hold.them')}
          mayStart={askAiConsentNow}
          onSend={(rec) => answerQuestion(q._id, { audioUri: rec.uri, contentType: rec.contentType })}
        />
        <PressableScale onPress={open} accessibilityRole="button" accessibilityLabel={t('parent.ask.answer')} hitSlop={8} style={styles.answer}>
          <Txt variant="label" size={15} weight={700} color={colors.yolkDeep}>
            {t('parent.ask.answer')}
          </Txt>
          <ChevronRightIcon size={16} color={colors.yolkDeep} />
        </PressableScale>
      </View>
      {typing ? <TypeAnswer questionId={q._id} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.card, backgroundColor: colors.card, boxShadow: shadows.card, padding: space.lg, gap: space.lg },
  row: { gap: 8 },
  open: { gap: 6 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, gap: 12 },
  answer: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4 },
});
