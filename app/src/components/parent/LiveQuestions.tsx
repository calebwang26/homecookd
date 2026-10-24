// Parent Home: questions a kid asked while cooking that the video couldn't answer (Convex
// questions.openForCook, live; docs/build/STACK.md "Close the loop"). One row per question: who and
// which dish, the question (in the cook's language when Track F translated it, marked "Translated"
// with the kid's own words), "Answer" (the walkie-talkie, /answer/<id>: homie reads it to her and she
// answers out loud), and the small "Hold to talk" pill as the quick way. Her voice is the answer, sent
// as a voice note and transcribed on the server. An answered question leaves the list by itself.
// A share ask (questions.kind 'share', from Community: "Shreya wants to put your Poha on the map…")
// is a row like the others, with no step; her spoken yes or no answers it.
// Nothing open: no card.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { HoldToTalk } from '@/components/postcard/HoldToTalk';
import { questionLines } from '@/components/record/walkieLogic';
import { ChevronRightIcon, fadeOutFast, listEnter, PressableScale, Txt } from '@/components/ui';
import { answerQuestion, useCookQuestions, type CookQuestion } from '@/lib/live/convex';
import { getCachedEntry } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import { colors, radii, shadows, space } from '@/theme/tokens';

import { dishName } from './kitchen';

function who(q: CookQuestion): string {
  const name = q.askedByName?.trim() || 'Your family';
  const e = getCachedEntry(q.recipeId);
  const dish = q.recipeTitle || (e ? dishName(e.title, e.cook_name) : null);
  const step = q.stepOrder && q.kind !== 'share' ? ` · step ${q.stepOrder}` : '';
  return dish ? `${name} · ${dish}${step}` : `${name} asked`;
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
  const lines = questionLines(q);
  const open = () => router.push({ pathname: '/answer/[id]', params: { id: q._id } });
  return (
    <Animated.View exiting={fadeOutFast} layout={LinearTransition.duration(220)} style={styles.row}>
      <PressableScale
        onPress={open}
        scaleTo={0.98}
        accessibilityRole="button"
        accessibilityLabel={lines.en ? `${who(q)}: ${lines.main}. Translated from: ${lines.en}` : `${who(q)}: ${lines.main}`}
        accessibilityHint="Opens the question. homie reads it to you, and you answer out loud."
        style={styles.open}>
        <Txt variant="label" size={15} weight={700} color={colors.greenDeep} numberOfLines={1}>
          {who(q)}
        </Txt>
        <Txt variant="title" size={20} leading={1.25} color={colors.ink}>
          “{lines.main}”
        </Txt>
        {/* Gemini's translation of the kid's words: AI words are always labelled. */}
        {lines.en ? (
          <Txt variant="meta" size={14}>
            Translated · “{lines.en}”
          </Txt>
        ) : null}
      </PressableScale>
      <View style={styles.actions}>
        <HoldToTalk toName={q.askedByName ?? 'them'} onSend={(rec) => answerQuestion(q._id, { audioUri: rec.uri, contentType: rec.contentType })} />
        <PressableScale onPress={open} accessibilityRole="button" accessibilityLabel="Answer" hitSlop={8} style={styles.answer}>
          <Txt variant="label" size={15} weight={700} color={colors.greenDeep}>
            Answer
          </Txt>
          <ChevronRightIcon size={16} color={colors.greenDeep} />
        </PressableScale>
      </View>
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
