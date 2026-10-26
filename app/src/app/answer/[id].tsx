// The walkie-talkie v2 (/answer/<questionId>, from a Parent Home question row): the cook answers a
// kid's question out loud, with no buttons. The peach wash of the recording screen, a small cream ×
// top-left, and one centred column (components/record/RecordWash COLUMN): "Shreya ने विचारलं", the
// question big in her language (questions.textForCook, else what homie said when it translated it),
// the kid's English small under it marked "Translated", then homie big (HomiePot is its only glow: the
// ring while it listens, a plain white circle once it can't hear her), then five green listening bars
// that move with her voice and "बोला, मी ऐकतोय" / "Just answer out loud". homie reads the question when
// it opens (lib/live/speak, labelled "AI voice"; a translated question in her language even before
// people.me has loaded); then it listens, sends her voice note when she stops, and says "Shreya ला
// पाठवलं" while a check pops in, before the screen closes by itself (components/record/useWalkie). A
// tap on the question reads it again. The corner pot is hidden here: the big one is homie.
// A share ask (questions.kind 'share': someone wants her dish on the Community map) comes the same
// way: "Shreya ने विचारलं", the ask in her language, and her spoken yes or no (a short word is enough)
// goes as the voice note; the server reads it, and only a clear yes shares the dish.
// Dev aid (web screenshots only): /answer/preview?lang=mr[&step=listening|sending|sent][&kind=share]
// shows a made-up question from Shreya, standing still.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BiLine } from '@/components/record/BiLine';
import { GlowHomie } from '@/components/record/GlowHomie';
import { ListeningBars } from '@/components/record/ListeningBars';
import { COLUMN, RecordWash } from '@/components/record/RecordWash';
import { useWalkie, type WalkieStep } from '@/components/record/useWalkie';
import { questionFit, questionLines } from '@/components/record/walkieLogic';
import { recordWords, type Line, type RecordWords } from '@/components/record/words';
import { CheckIcon, CloseIcon, IconButton, Txt, useToast } from '@/components/ui';
import { useHomieScreen } from '@/lib/homie/hooks';
import { potState, sayPhase, speakingLabel } from '@/lib/homie/logic';
import { useHomie } from '@/lib/homie/store';
import { answerQuestion, useCookQuestions, useMe, type CookQuestion } from '@/lib/live/convex';
import { speak, stopSpeaking } from '@/lib/live/speak';
import { useNowPlaying } from '@/lib/media';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import { colors, motion, space } from '@/theme/tokens';

/** The × (IconButton's 48 pt): the column starts below it. */
const CLOSE_SIZE = 48;
/** Read the question even if people.me never answers (an English question then reads in English). */
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
// convex/shareRequests.ts shareQuestion's words, and a draft of their Marathi (Track F translates the real one).
const PREVIEW_SHARE: CookQuestion = {
  ...PREVIEW,
  stepOrder: undefined,
  kind: 'share',
  text: 'Shreya wants to put your Kanda Poha on the map for neighbors. They’d see the recipe and one line you said, never your video. Is that okay?',
  textForCook: 'श्रेयाला तुमचे कांदा पोहे शेजाऱ्यांसाठी नकाशावर ठेवायचे आहेत. त्यांना रेसिपी आणि तुमचं एक वाक्य दिसेल, तुमचा व्हिडिओ कधीच नाही. चालेल का?',
};

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/parent/home');
}

function previewQuestion(lang?: string, kind?: string): CookQuestion {
  if (kind === 'share') return lang === 'mr' ? PREVIEW_SHARE : { ...PREVIEW_SHARE, textForCook: undefined };
  return lang === 'mr' ? PREVIEW : PREVIEW_EN;
}

export default function AnswerScreen() {
  const { id, lang: previewLang, step: previewStep, kind: previewKind } = useLocalSearchParams<{ id: string; lang?: string; step?: string; kind?: string }>();
  const preview = __DEV__ && Platform.OS === 'web' && id === 'preview';
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const toast = useToast();
  const { t } = useWords();
  const { me } = useSession();
  const questions = useCookQuestions(me?.role === 'cook');
  const convexMe = useMe();
  useHomieScreen({ hidden: true });

  // Kept once seen: an answered question leaves the open list.
  const found = preview ? previewQuestion(previewLang, previewKind) : (questions.find((x) => x._id === id) ?? null);
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
  const w = useMemo(() => recordWords(lang), [lang]);
  const kid = q?.askedByName?.trim() || null;

  const h = useHomie();
  const now = useNowPlaying();
  const voice = potState(h, sayPhase(now.key, now.phase));
  const talking = voice === 'speaking' || voice === 'lit';

  // What homie said when it translated the question itself (no textForCook yet).
  const [spoken, setSpoken] = useState<string | null>(null);
  const herLanguage = convexMe?.language;
  const read = useCallback(async () => {
    if (!q) return { via: 'none' as const };
    const label = t('messages.answer.aiLabel');
    // Already in her language: said in it. Unloaded people.me leaves `lang` unset: /speak then uses
    // the language the server has for her.
    if (q.textForCook?.trim()) return speak(q.textForCook, { lang: herLanguage, label, profileId: me?.id });
    if (lang === 'en') return speak(q.text, { lang: 'en', profileId: me?.id });
    const said = await speak(q.text, { lang, translate: true, label, profileId: me?.id });
    if (said.via === 'homie' && said.text && said.text !== q.text) setSpoken(said.text);
    return said;
  }, [q, lang, herLanguage, me?.id, t]);

  const close = useCallback(
    (failed?: boolean) => {
      if (failed) {
        const words = kid != null ? t('messages.answer.sendFailed', { name: kid }) : t('messages.answer.sendFailedThem');
        toast.show(words, { tone: 'error', durationMs: 3600 });
      }
      goBack();
    },
    [toast, kid, t],
  );
  // Leaving by hand stops homie mid-word; the automatic close comes after it has finished.
  useEffect(() => () => stopSpeaking(), []);

  const walkie = useWalkie({
    ready: !preview && !!q && (!!convexMe || waitedForLanguage),
    kind: q?.kind,
    talking,
    read,
    send: (note) => answerQuestion(q!._id, { audioUri: note.uri, contentType: note.contentType }),
    // Her own words, said directly: no translating round trip that could arrive after the screen closed.
    thank: () => void speak(w.text('sentTo', { kid: kid ?? undefined }), { lang, profileId: me?.id }),
    close,
  });
  const step: WalkieStep = preview && STEPS.includes(previewStep as WalkieStep) ? (previewStep as WalkieStep) : preview ? 'listening' : walkie.step;

  const lines = q ? questionLines(q, spoken) : null;
  const fit = questionFit(lines?.main ?? '');
  const asked = w.text('kidAsked', { kid: kid ?? undefined });
  const label = labelFor(step, w, kid);
  const homieState = talking ? voice : step === 'sending' ? 'thinking' : step === 'listening' ? 'listening' : 'off';
  const enter = (i: number) => (reduce ? FadeIn.duration(motion.reducedFadeMs) : FadeInDown.duration(380).delay(i * 60));
  // The column clears the × (a long question would otherwise reach it) and scrolls if it must. The
  // same room at the bottom keeps a short one centred on the screen, as in the mockup.
  const top = Math.max(space.topDetail, insets.top + 4);
  const clear = top + CLOSE_SIZE + 12;
  const room = { paddingTop: clear, paddingBottom: fit.compact ? Math.max(24, insets.bottom + 16) : Math.max(clear, insets.bottom + 16) };

  return (
    <View style={styles.page}>
      <RecordWash />
      {q && lines ? (
        <ScrollView contentContainerStyle={[styles.column, room]} bounces={false} showsVerticalScrollIndicator={false}>
          <Animated.View entering={enter(0)} style={styles.words}>
            <Txt variant="label" size={18} weight={600} color={colors.peachInk} align="center">
              {asked}
            </Txt>
            <Pressable
              onPress={walkie.again}
              accessibilityRole="button"
              accessibilityLabel={lines.main}
              accessibilityHint={t('messages.answer.readAgain')}
              disabled={preview}>
              <Txt variant="label" size={fit.font} weight={700} leading={1.3} color={colors.ink} align="center">
                {lines.main}
              </Txt>
            </Pressable>
            {/* Gemini's or homie's translation of the kid's words: AI words are always labelled. */}
            {lines.en ? (
              <Txt variant="meta" size={15} color={colors.muted} align="center">
                {t('messages.answer.translated', { text: lines.en })}
              </Txt>
            ) : null}
          </Animated.View>
          <Animated.View entering={enter(1)} style={[styles.hero, { width: fit.homie, height: fit.homie }]}>
            <GlowHomie size={fit.homie} state={homieState} level={walkie.level} label={talking ? speakingLabel(h, now.key) : null} />
          </Animated.View>
          <Animated.View key={step === 'sent' ? 'sent' : 'ask'} entering={enter(2)} style={[styles.label, (step === 'reading' || step === 'waiting') && styles.soft]} accessibilityLiveRegion="polite">
            {step === 'sent' ? <SentCheck /> : null}
            {step === 'listening' ? <ListeningBars level={walkie.level} color={colors.green} /> : null}
            {step === 'sending' ? <ActivityIndicator color={colors.green} /> : null}
            <BiLine line={label} size={26} weight={700} enSize={15} enColor={colors.muted} color={step === 'nomic' || step === 'nomicHere' || step === 'retry' ? colors.danger : colors.ink} />
          </Animated.View>
        </ScrollView>
      ) : (
        <View style={[styles.column, styles.fill]}>{missing ? <BiLine line={w.line('answered')} size={22} /> : <ActivityIndicator color={colors.green} />}</View>
      )}
      <View style={[styles.top, { paddingTop: top }]} pointerEvents="box-none">
        <IconButton icon={<CloseIcon size={20} color={colors.ink} />} accessibilityLabel={t('messages.answer.close')} onPress={goBack} />
      </View>
    </View>
  );
}

/** The check next to "Sent to Shreya": it pops in (a spring). Reduce Motion: it just fades in with the line. */
function SentCheck() {
  const reduce = useReducedMotion();
  const pop = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!reduce) pop.set(withSpring(1, { damping: 10, stiffness: 240, mass: 0.8 }));
  }, [reduce, pop]);
  const style = useAnimatedStyle(() => ({ opacity: Math.min(1, pop.value * 2), transform: [{ scale: 0.3 + 0.7 * pop.value }] }));
  return (
    <Animated.View style={[styles.check, style]}>
      <CheckIcon size={22} color={colors.card} />
    </Animated.View>
  );
}

/** The line under homie for each step. */
function labelFor(step: WalkieStep, w: RecordWords, kid: string | null): Line {
  switch (step) {
    case 'sending':
      return w.line('sendingNow');
    case 'sent':
      return w.line('sentTo', { kid: kid ?? undefined });
    case 'retry':
      return w.line('couldntSend');
    case 'nomic':
      return w.line('micOff');
    case 'nomicHere':
      return w.line('noMicHere');
    default:
      return w.line('listening');
  }
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: space.gutter, flexDirection: 'row' },
  column: { flexGrow: 1, paddingHorizontal: COLUMN.side, alignItems: 'center', justifyContent: 'center' },
  fill: { flex: 1 },
  words: { alignItems: 'center', gap: 8 },
  hero: { marginTop: COLUMN.toHero },
  label: { marginTop: COLUMN.toLabel, alignItems: 'center', gap: 10 },
  soft: { opacity: 0.45 },
  check: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
});
