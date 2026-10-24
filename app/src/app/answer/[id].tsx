// The walkie-talkie v2 (/answer/<questionId>, from a Parent Home question row): the cook answers a
// kid's question out loud, with no buttons. The peach wash and warm glow of the recording screen, a
// small cream × top-left, and one centred column (components/record/RecordWash COLUMN): "Shreya ने
// विचारलं", the question big in her language (questions.textForCook, else what homie said when it
// translated it), the kid's English small under it marked "Translated", then homie big and glowing,
// then "बोला, मी ऐकतोय" / "Just answer out loud". homie reads the question when it opens (lib/live/speak,
// labelled "AI voice"); then it listens, sends her voice note when she stops, and says and shows
// "Shreya ला पाठवलं" before the screen closes by itself (components/record/useWalkie). A tap on the
// question reads it again. The corner pot is hidden here: the big one is homie.
// Dev aid (web screenshots only): /answer/preview?lang=mr[&step=listening|sending|sent] shows a
// made-up question from Shreya, standing still.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BiLine } from '@/components/record/BiLine';
import { GlowHomie } from '@/components/record/GlowHomie';
import { COLUMN, RecordWash, WarmGlow } from '@/components/record/RecordWash';
import { useWalkie, type WalkieStep } from '@/components/record/useWalkie';
import { recordWords } from '@/components/record/words';
import { CheckIcon, CloseIcon, IconButton, Txt, useToast } from '@/components/ui';
import { useHomieScreen } from '@/lib/homie/hooks';
import { potState, sayPhase, speakingLabel } from '@/lib/homie/logic';
import { useHomie } from '@/lib/homie/store';
import { cookWords, type Line } from '@/lib/homie/strings';
import { answerQuestion, useCookQuestions, useMe, type CookQuestion } from '@/lib/live/convex';
import { speak, stopSpeaking } from '@/lib/live/speak';
import { useNowPlaying } from '@/lib/media';
import { useSession } from '@/lib/session';
import { colors, motion, space } from '@/theme/tokens';

const HOMIE_SIZE = 200;
/** Read the question even if people.me never answers (her language then reads as English). */
const LANGUAGE_WAIT_MS = 2000;
const MISSING_MS = 5000;
const STEPS: readonly WalkieStep[] = ['waiting', 'reading', 'listening', 'sending', 'sent', 'retry', 'nomic', 'nomicHere'];

const PREVIEW: CookQuestion = {
  _id: 'preview',
  _creationTime: 0,
  recipeId: 'preview',
  stepOrder: 3,
  text: 'How much ginger do I add?',
  textForCook: 'आलं किती घालायचं?',
  askedByName: 'Shreya',
};
const PREVIEW_EN: CookQuestion = { ...PREVIEW, textForCook: undefined };

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/parent/home');
}

export default function AnswerScreen() {
  const { id, lang: previewLang, step: previewStep } = useLocalSearchParams<{ id: string; lang?: string; step?: string }>();
  const preview = __DEV__ && Platform.OS === 'web' && id === 'preview';
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const toast = useToast();
  const { me } = useSession();
  const questions = useCookQuestions(me?.role === 'cook');
  const convexMe = useMe();
  useHomieScreen({ hidden: true });

  // Kept once seen: an answered question leaves the open list.
  const found = preview ? (previewLang === 'mr' ? PREVIEW : PREVIEW_EN) : (questions.find((x) => x._id === id) ?? null);
  const [kept, setKept] = useState<CookQuestion | null>(null);
  if (found && found !== kept) setKept(found);
  const q = found ?? kept;
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (q) return;
    const t = setTimeout(() => setMissing(true), MISSING_MS);
    return () => clearTimeout(t);
  }, [q]);

  const [waitedForLanguage, setWaitedForLanguage] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaitedForLanguage(true), LANGUAGE_WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  const lang = (preview && previewLang) || (convexMe?.language ?? 'en');
  const w = useMemo(() => cookWords(lang), [lang]);
  const rw = useMemo(() => recordWords(lang), [lang]);
  const kid = q?.askedByName?.trim() || null;

  const h = useHomie();
  const now = useNowPlaying();
  const voice = potState(h, sayPhase(now.key, now.phase));
  const talking = voice === 'speaking' || voice === 'lit';

  // What homie said when it translated the question itself (no textForCook yet).
  const [spoken, setSpoken] = useState<string | null>(null);
  const read = useCallback(async () => {
    if (!q) return { via: 'none' as const };
    if (lang === 'en') return speak(q.text, { lang: 'en', profileId: me?.id });
    if (q.textForCook) return speak(q.textForCook, { lang, label: 'Translated · AI voice', profileId: me?.id });
    const said = await speak(q.text, { lang, translate: true, label: 'Translated · AI voice', profileId: me?.id });
    if (said.via === 'homie' && said.text && said.text !== q.text) setSpoken(said.text);
    return said;
  }, [q, lang, me?.id]);

  const close = useCallback(
    (failed?: boolean) => {
      if (failed) toast.show(`Couldn’t send it to ${kid ?? 'them'}. Try again from Home.`, { tone: 'error', durationMs: 3600 });
      goBack();
    },
    [toast, kid],
  );
  // Leaving by hand stops homie mid-word; the automatic close comes after it has finished.
  useEffect(() => () => stopSpeaking(), []);

  const walkie = useWalkie({
    ready: !preview && !!q && (!!convexMe || waitedForLanguage),
    talking,
    read,
    send: (note) => answerQuestion(q!._id, { audioUri: note.uri, contentType: note.contentType }),
    // Her own words, said directly: no translating round trip that could arrive after the screen closed.
    thank: () => void speak(w.text('sentTo', { kid: kid ?? undefined }), { lang, profileId: me?.id }),
    close,
  });
  const step: WalkieStep = preview && STEPS.includes(previewStep as WalkieStep) ? (previewStep as WalkieStep) : preview ? 'listening' : walkie.step;

  const question = q ? (q.textForCook ?? spoken ?? q.text) : null;
  const translated = !!q && question !== q.text;
  const asked = w.text('kidAsked', { kid: kid ?? undefined });
  const label = labelFor(step, w, rw, kid);
  const homieState = talking ? voice : step === 'sending' ? 'thinking' : step === 'listening' ? 'listening' : 'off';
  const enter = (i: number) => (reduce ? FadeIn.duration(motion.reducedFadeMs) : FadeInDown.duration(380).delay(i * 60));

  return (
    <View style={styles.page}>
      <RecordWash />
      {q ? (
        <View style={styles.column}>
          <Animated.View entering={enter(0)} style={styles.words}>
            <Txt variant="label" size={18} weight={600} color={colors.peachInk} align="center">
              {asked}
            </Txt>
            <Pressable
              onPress={walkie.again}
              accessibilityRole="button"
              accessibilityLabel={question ?? ''}
              accessibilityHint="homie reads it again"
              disabled={preview}>
              <Txt variant="label" size={36} weight={700} leading={1.3} color={colors.ink} align="center">
                {question}
              </Txt>
            </Pressable>
            {translated ? (
              <Txt variant="meta" size={15} color={colors.muted} align="center">
                Translated · “{q.text}”
              </Txt>
            ) : null}
          </Animated.View>
          <Animated.View entering={enter(1)} style={styles.hero}>
            <WarmGlow box={HOMIE_SIZE} />
            <GlowHomie size={HOMIE_SIZE} state={homieState} level={walkie.level} label={talking ? speakingLabel(h, now.key) : null} />
          </Animated.View>
          <Animated.View key={step === 'sent' ? 'sent' : 'ask'} entering={enter(2)} style={[styles.label, (step === 'reading' || step === 'waiting') && styles.soft]} accessibilityLiveRegion="polite">
            {step === 'sent' ? (
              <View style={styles.check}>
                <CheckIcon size={22} color={colors.card} />
              </View>
            ) : null}
            {step === 'sending' ? <ActivityIndicator color={colors.green} /> : null}
            <BiLine line={label} size={26} weight={700} enSize={15} enColor={colors.muted} color={step === 'nomic' || step === 'nomicHere' || step === 'retry' ? colors.danger : colors.ink} />
          </Animated.View>
        </View>
      ) : (
        <View style={styles.column}>{missing ? <BiLine line={w.line('answered')} size={22} /> : <ActivityIndicator color={colors.green} />}</View>
      )}
      <View style={[styles.top, { paddingTop: Math.max(space.topDetail, insets.top + 4) }]} pointerEvents="box-none">
        <IconButton icon={<CloseIcon size={20} color={colors.ink} />} accessibilityLabel="Close" onPress={goBack} />
      </View>
    </View>
  );
}

/** The line under homie for each step. */
function labelFor(step: WalkieStep, w: ReturnType<typeof cookWords>, rw: ReturnType<typeof recordWords>, kid: string | null): Line {
  switch (step) {
    case 'sending':
      return rw.line('sendingNow');
    case 'sent':
      return w.line('sentTo', { kid: kid ?? undefined });
    case 'retry':
      return rw.line('couldntSend');
    case 'nomic':
      return rw.line('micOff');
    case 'nomicHere':
      return rw.line('noMicHere');
    default:
      return rw.line('listening');
  }
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: space.gutter, flexDirection: 'row' },
  column: { flex: 1, paddingHorizontal: COLUMN.side, alignItems: 'center', justifyContent: 'center' },
  words: { alignItems: 'center', gap: 8 },
  hero: { marginTop: COLUMN.toHero, width: HOMIE_SIZE, height: HOMIE_SIZE },
  label: { marginTop: COLUMN.toLabel, alignItems: 'center', gap: 10 },
  soft: { opacity: 0.45 },
  check: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
});
