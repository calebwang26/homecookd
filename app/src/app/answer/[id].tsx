// The walkie-talkie: the cook answers a kid's question by holding a big pot (/answer/<questionId>,
// from a Parent Home question row). Top half: the question in her language (questions.textForCook,
// else what homie said when it translated it) with the kid's English under it, "Shreya asked · Step 3",
// and "Hear again". Bottom half: homie, big, as the hold-to-talk button: "Hold and talk", "Let go to
// send" (components/postcard/HoldToTalk: the same hold, 3 s Undo and upload as the small pill).
// homie reads the question aloud on open, in her language (lib/live/speak, labelled "AI voice"); once
// the note has gone it says and shows "Sent to Shreya", then goes back. The corner pot is hidden here:
// the big one is homie.
// Dev aid (web screenshots only): /answer/preview?lang=mr shows a made-up question from Shreya.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomiePot } from '@/components/homie';
import { HoldToTalk, type HoldView } from '@/components/postcard/HoldToTalk';
import { BiLine } from '@/components/record/BiLine';
import { CloseIcon, IconButton, PressableScale, ScreenWash, Txt } from '@/components/ui';
import { useHomieScreen } from '@/lib/homie/hooks';
import { potState, sayPhase, speakingLabel } from '@/lib/homie/logic';
import { useHomie } from '@/lib/homie/store';
import { cookWords, type CookWords, type Line } from '@/lib/homie/strings';
import { languageName } from '@/lib/languages';
import { answerQuestion, useCookQuestions, useMe, type CookQuestion } from '@/lib/live/convex';
import { speak, stopSpeaking } from '@/lib/live/speak';
import { useNowPlaying } from '@/lib/media';
import { useSession } from '@/lib/session';
import { colors, motion, radii, shadows, space } from '@/theme/tokens';

const POT_BUTTON = 260;
/** Read the question even if people.me never answers (her language then reads as English). */
const LANGUAGE_WAIT_MS = 2000;
const SENT_HOLD_MS = 2600;
const MISSING_MS = 5000;

const PREVIEW: CookQuestion = {
  _id: 'preview',
  _creationTime: 0,
  recipeId: 'preview',
  stepOrder: 3,
  text: 'How much ginger do I add?',
  textForCook: 'आलं किती घालायचं?',
  askedByName: 'Shreya',
};

function leave() {
  stopSpeaking();
  if (router.canGoBack()) router.back();
  else router.replace('/parent/home');
}

export default function AnswerScreen() {
  const { id, lang: previewLang } = useLocalSearchParams<{ id: string; lang?: string }>();
  const preview = __DEV__ && Platform.OS === 'web' && id === 'preview';
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const { me } = useSession();
  const questions = useCookQuestions(me?.role === 'cook');
  const convexMe = useMe();
  useHomieScreen({ hidden: true });

  // Kept once seen: an answered question leaves the open list.
  const found = preview ? PREVIEW : (questions.find((x) => x._id === id) ?? null);
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
  const kid = q?.askedByName?.trim() || null;

  // What homie said when it translated the question itself (no textForCook yet).
  const [spoken, setSpoken] = useState<string | null>(null);
  const read = useCallback(async () => {
    if (!q) return;
    if (lang === 'en') return void speak(q.text, { lang: 'en', profileId: me?.id });
    if (q.textForCook) return void speak(q.textForCook, { lang, label: 'AI voice', profileId: me?.id });
    const said = await speak(q.text, { lang, translate: true, label: 'Translated · AI voice', profileId: me?.id });
    if (said.via === 'homie' && said.text && said.text !== q.text) setSpoken(said.text);
  }, [q, lang, me?.id]);

  // homie reads it once, as soon as her language is known.
  const readOnce = useRef(false);
  useEffect(() => {
    if (!q || readOnce.current || (!convexMe && !waitedForLanguage)) return;
    readOnce.current = true;
    void read();
  }, [q, convexMe, waitedForLanguage, read]);
  useEffect(() => () => stopSpeaking(), []);

  const [sent, setSent] = useState(false);
  const onSent = () => {
    setSent(true);
    if (lang === 'en') void speak(w.text('sentTo', { kid: kid ?? undefined }), { lang: 'en' });
    else void speak(`Sent to ${kid ?? 'your family'}`, { lang, translate: true });
  };
  // "Sent to Shreya" shows for a moment, then back (not if she already left).
  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(leave, SENT_HOLD_MS);
    return () => clearTimeout(t);
  }, [sent]);

  const h = useHomie();
  const now = useNowPlaying();
  const voiceState = potState(h, sayPhase(now.key, now.phase));
  const talking = voiceState === 'speaking' || voiceState === 'lit';

  const question = q ? q.textForCook ?? spoken ?? q.text : null;
  const translated = !!q && question !== q.text;
  const asked = w.line('kidAsked', { kid: kid ?? undefined });
  const stepWords = q?.stepOrder ? ` · ${w.text('step', { n: q.stepOrder })}` : '';
  const english = q ? `${kid ?? 'They'} asked: “${q.text}”${q.stepOrder ? ` · Step ${q.stepOrder}` : ''}` : '';
  const letGo = w.line('letGoToSend', { kid: kid ?? undefined });
  const hear = w.line('hearAgain');

  return (
    <View style={styles.page}>
      <View style={[styles.topHalf, { paddingTop: Math.max(space.topDetail, insets.top + 4) }]}>
        <ScreenWash tone="parent" height={420} />
        <View style={styles.bar}>
          <IconButton icon={<CloseIcon size={20} color={colors.ink} />} accessibilityLabel="Close" onPress={leave} />
          {q ? (
            <PressableScale onPress={() => void read()} haptic accessibilityRole="button" accessibilityLabel={hear.en ? `${hear.text}. ${hear.en}` : hear.text} style={styles.hear}>
              <Txt variant="label" size={16} weight={600} color={colors.ink} numberOfLines={1}>
                {hear.en ? `${hear.text} · ${hear.en}` : hear.text}
              </Txt>
            </PressableScale>
          ) : null}
        </View>

        {q ? (
          <Animated.View entering={reduce ? FadeIn.duration(motion.reducedFadeMs) : FadeInDown.duration(380)} style={styles.card}>
            <Txt variant="label" size={17} weight={600} color={colors.peachInk}>
              {asked.text}
              {stepWords}
            </Txt>
            <Txt variant="label" size={30} weight={700} leading={1.35} color={colors.ink}>
              {question}
            </Txt>
            {translated || lang !== 'en' ? (
              <Txt variant="meta" size={16} color={colors.muted}>
                {english}
              </Txt>
            ) : null}
          </Animated.View>
        ) : missing ? (
          <BiLine line={w.line('answered')} size={22} style={styles.missing} />
        ) : (
          <ActivityIndicator color={colors.green} style={styles.missing} />
        )}

        {q ? (
          <Txt variant="caption" size={14} color={colors.peachInk} align="center" accessibilityLiveRegion="polite">
            {talking ? speakingLabel(h, now.key) : lang !== 'en' ? `homie read it to you in ${languageName(lang)}` : 'homie read it to you'}
          </Txt>
        ) : null}
      </View>

      <View style={[styles.bottomHalf, { paddingBottom: Math.max(40, insets.bottom + 16) }]}>
        {q && !sent ? (
          <View onTouchStart={stopSpeaking} style={styles.potWrap}>
            <HoldToTalk
              toName={kid ?? 'them'}
              onSend={(rec) => answerQuestion(q._id, { audioUri: rec.uri, contentType: rec.contentType })}
              onSent={onSent}
              bodyStyle={styles.potButton}
              body={(v) => <PotBody v={v} w={w} kid={kid} voiceState={voiceState} level={h.level} />}
            />
          </View>
        ) : null}
        {sent ? (
          <Animated.View entering={reduce ? FadeIn.duration(motion.reducedFadeMs) : FadeInDown.duration(380)} style={styles.sent}>
            <HomiePot state={voiceState === 'off' ? 'listening' : voiceState} size={120} />
            <BiLine line={w.line('sentTo', { kid: kid ?? undefined })} size={28} weight={700} enSize={16} />
          </Animated.View>
        ) : q ? (
          <BiLine line={letGo} size={17} weight={600} color={colors.sageInk} enColor={colors.sageInk} style={styles.hint} />
        ) : null}
      </View>
    </View>
  );
}

/** The big pot's inside: homie (steam with her voice while she holds), her words, the English under them. */
function PotBody({ v, w, kid, voiceState, level }: { v: HoldView; w: CookWords; kid: string | null; voiceState: ReturnType<typeof potState>; level: number }) {
  const holding = v.phase === 'recording';
  const line: Line | null =
    holding
      ? w.line('letGoToSend', { kid: kid ?? undefined })
      : v.phase === 'waiting'
        ? w.line('sending')
        : v.phase === 'sent'
          ? w.line('sentTo', { kid: kid ?? undefined })
          : v.phase === 'short'
            ? w.line('holdLonger')
            : v.phase === 'cut' || v.phase === 'undone'
              ? w.line('notSent')
              : v.phase === 'error'
                ? w.line('tryAgain')
                : v.phase === 'sending'
                  ? null
                  : w.line('holdAndTalk');
  const waiting = v.phase === 'waiting';
  const ink = waiting ? colors.butterInk : colors.card;
  return (
    <View style={[styles.potInner, holding ? styles.potHolding : waiting ? styles.potWaiting : null]}>
      <HomiePot state={holding ? 'listening' : voiceState} level={holding ? v.level : level} size={104} shadow={false} />
      {line ? (
        <View style={styles.potWords}>
          <Txt variant="label" size={24} weight={700} color={ink} align="center" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>
            {line.text}
          </Txt>
          {line.en ? (
            <Txt variant="meta" size={14} color={waiting ? colors.butterInk : 'rgba(255,253,247,0.8)'} align="center" numberOfLines={1}>
              {line.en}
            </Txt>
          ) : null}
        </View>
      ) : (
        <ActivityIndicator color={colors.card} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  topHalf: { flex: 1, paddingHorizontal: 20, paddingBottom: 20, gap: 14 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hear: { height: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: colors.card, boxShadow: shadows.button, justifyContent: 'center', maxWidth: '75%' },
  card: { padding: 20, borderRadius: 26, backgroundColor: colors.card, boxShadow: shadows.cardRaised, gap: 8 },
  missing: { marginTop: 40 },
  bottomHalf: { flex: 1, paddingHorizontal: 20, paddingTop: 16, alignItems: 'center', justifyContent: 'center', gap: 18 },
  potWrap: { alignItems: 'center' },
  potButton: {
    width: POT_BUTTON,
    height: POT_BUTTON,
    borderRadius: POT_BUTTON / 2,
    boxShadow: `0 0 0 16px rgba(91,111,0,0.14), ${shadows.hero}`,
  },
  potInner: { flex: 1, borderRadius: POT_BUTTON / 2, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 28 },
  potHolding: { backgroundColor: colors.danger },
  potWaiting: { backgroundColor: colors.butter },
  potWords: { alignItems: 'center', gap: 2 },
  hint: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: radii.quote, backgroundColor: colors.sage },
  sent: { alignItems: 'center', gap: 16 },
});
