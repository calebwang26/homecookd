// Parent Home: questions a kid asked while cooking that the video couldn't answer (Convex
// questions.openForCook, live; docs/build/STACK.md "Close the loop"). One row per question: who and
// which dish, the question, and "Hold to talk" (the postcard's pill): the cook's voice is the answer,
// sent as a voice note and transcribed on the server. An answered question leaves the list by itself.
// Nothing open: no card.
import { StyleSheet, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { HoldToTalk } from '@/components/postcard/HoldToTalk';
import { fadeOutFast, listEnter, Txt } from '@/components/ui';
import { answerQuestion, useCookQuestions, type CookQuestion } from '@/lib/live/convex';
import { getCachedEntry } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import { colors, radii, shadows, space } from '@/theme/tokens';

import { dishName } from './kitchen';

function who(q: CookQuestion): string {
  const name = q.askedByName ?? 'Your family';
  const e = getCachedEntry(q.recipeId);
  const dish = q.recipeTitle ?? (e ? dishName(e.title, e.cook_name) : null);
  const step = q.stepOrder ? ` · step ${q.stepOrder}` : '';
  return dish ? `${name} · ${dish}${step}` : `${name} asked`;
}

export function LiveQuestions({ enterIndex = 0 }: { enterIndex?: number }) {
  const { me } = useSession();
  const questions = useCookQuestions(me?.role === 'cook');
  if (!questions.length) return null;
  return (
    <Animated.View entering={listEnter(enterIndex)} exiting={fadeOutFast} layout={LinearTransition.duration(220)} style={styles.card}>
      {questions.map((q) => (
        <Animated.View key={q._id} exiting={fadeOutFast} layout={LinearTransition.duration(220)} style={styles.row}>
          <Txt variant="label" size={15} weight={700} color={colors.greenDeep} numberOfLines={1}>
            {who(q)}
          </Txt>
          <Txt variant="title" size={20} leading={1.25} color={colors.ink}>
            “{q.text}”
          </Txt>
          <View style={styles.talk}>
            <HoldToTalk toName={q.askedByName ?? 'them'} onSend={(rec) => answerQuestion(q._id, { audioUri: rec.uri, contentType: rec.contentType })} />
          </View>
        </Animated.View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.card, backgroundColor: colors.card, boxShadow: shadows.card, padding: space.lg, gap: space.lg },
  row: { gap: 8 },
  talk: { alignItems: 'flex-start', marginTop: 4 },
});
