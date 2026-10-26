// Parent-Chat bottom panel: cream, top corners 32, 0 -10px 30px shadow, padding 28 24 24, 230 tall.
// One huge 92 px mic (green #5B6F00 + 0 12px 28px glow) over "Tap to talk" (18/700) and a quiet
// "Type instead" (15/600 #4C5A10). Recording (bible Parent-Chat--recording): the button turns
// #9A4F47 with a stop square and a 10 px rgba(154,79,71,0.18) ring, label "Tap again to send".
// "Type instead" swaps the panel to a text field + a "Send" pill for people who'd rather write; the
// choice is remembered per person on this phone (kv composer.mode.<id>), so a typer opens on the
// field next time (the big mic stays the default for everyone who hasn't typed). The field grows to
// 5 lines (Return adds a line). Where the mic can't record (the web without a recorder) the panel
// opens on the field with "Talking works in the app. Type below." instead of a greyed mic.
// Attach a recipe: a round well "+" sits left of the big mic (56) and left of the typed field (48);
// it opens "Attach a recipe" (RecipePickerSheet). The picked dish shows as a card at the top of the
// panel (the composer's AttachedDish, flat on cream, × removes it; another pick replaces it) and rides
// on the next voice note or typed message. With a dish attached: "Tap to talk about it" and "Write
// about this dish"; picking while typing focuses the field. The "+" hides while recording.
// `prompt` overrides the field's "Write to Leo" (not "Write about this dish"); `face` (a lent phone:
// whoever it is writing as) sits in the field and before "Tap to talk as Grandma".
// Answering a question (`answering`): AnsweringStrip is pinned at the top of the panel, the asker's
// face and "Answering Leo: how long do I…", with a × that turns the next message back into a plain
// one. Without it nothing is answered, whatever was asked last.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type TextInput, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, CloseIcon, MicIcon, PressableScale, StopIcon, Txt, useToast } from '@/components/ui';
import type { Profile } from '@/lib/api';
import { mmss } from '@/lib/format';
import { composerModeKey, kvGet, kvSet } from '@/lib/storage';
import { useVoiceRecorder, type VoiceRecording } from '@/lib/voice';
import { useWords } from '@/lib/words/useWords';
import { colors, shadows } from '@/theme/tokens';

import { AttachedDish, FOCUS_AFTER_PICK_MS, GrowingInput, NO_MIC_NOTE, SendPill, type ComposerDish } from './KidComposer';
import { AttachButton, RecipePickerSheet } from './RecipePickerSheet';

/** The question the next message answers: who asked, their words, and the × that cancels it. */
export type Answering = { who: Pick<Profile, 'name' | 'avatar_key'> | null; words: string; onCancel: () => void };

/** "Answering Leo: how long do I let the beef sit…" with the asker's face and a × to cancel. */
export function AnsweringStrip({ answering, style }: { answering: Answering; style?: StyleProp<ViewStyle> }) {
  const { t } = useWords();
  const name = answering.who?.name ?? null;
  const words = answering.words;
  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} style={[styles.strip, style]}>
      <Avatar profile={answering.who ?? { name: 'them' }} size={28} />
      <Txt
        variant="label"
        size={15}
        leading={1.3}
        color={colors.butterInk}
        numberOfLines={2}
        style={styles.stripText}
        accessibilityLabel={name != null ? t('messages.strip.label', { name, words }) : t('messages.strip.labelThem', { words })}>
        <Txt variant="label" size={15} weight={700} color={colors.butterInk}>
          {name != null ? t('messages.strip.answering', { name }) : t('messages.strip.answeringThem')}{' '}
        </Txt>
        {answering.words}
      </Txt>
      <PressableScale
        onPress={answering.onCancel}
        haptic
        accessibilityRole="button"
        accessibilityLabel={name != null ? t('messages.strip.cancel', { name }) : t('messages.strip.cancelThem')}
        accessibilityHint={t('messages.strip.cancelHint')}
        style={styles.stripX}>
        <View style={styles.stripXDisc}>
          <CloseIcon size={14} color={colors.butterInk} strokeWidth={2.4} />
        </View>
      </PressableScale>
    </Animated.View>
  );
}

type Mode = 'voice' | 'type';
/** Each person's last mode, once read from storage this session. */
const modes = new Map<string, Mode>();

/** This person's last composer mode on this phone; null while it's being read. */
function useComposerMode(personId: string | null | undefined): [Mode | null, (m: Mode) => void] {
  const key = personId ? composerModeKey(personId) : null;
  const [read, setRead] = useState<{ key: string | null; mode: Mode } | null>(null);
  useEffect(() => {
    if (!key || modes.has(key)) return;
    let alive = true;
    kvGet(key).then((v) => {
      const mode: Mode = v === 'type' ? 'type' : 'voice';
      if (!modes.has(key)) modes.set(key, mode);
      if (alive) setRead({ key, mode: modes.get(key)! });
    });
    return () => {
      alive = false;
    };
  }, [key]);
  const mode = !key ? 'voice' : read?.key === key ? read.mode : (modes.get(key) ?? null);
  const set = useCallback(
    (m: Mode) => {
      if (key) {
        modes.set(key, m);
        void kvSet(key, m);
      }
      setRead({ key, mode: m });
    },
    [key],
  );
  return [mode, set];
}

export function AnswerPanel({
  otherName,
  family,
  personId,
  prompt,
  face,
  answering,
  attachment,
  onRemoveAttachment,
  onAttach,
  onSendVoice,
  onSendText,
}: {
  /** Who hears it; null: nobody named (`family`: the family, else "them"). */
  otherName: string | null;
  /** The family circle: no name means the whole family. */
  family?: boolean;
  /** Who is writing: their last mode (voice / typing) is remembered on this phone. */
  personId?: string | null;
  /** The field's words when nothing is attached (default "Write to <otherName>" / "Write to the family"). */
  prompt?: string;
  /** A lent phone: the person it is writing as (their face in the field and by "Tap to talk"). */
  face?: Pick<Profile, 'name' | 'avatar_key'> | null;
  /** The question the next message answers (shows AnsweringStrip); none = a plain message. */
  answering?: Answering | null;
  attachment?: ComposerDish | null;
  onRemoveAttachment?: () => void;
  /** Shows the "+": the recipe picked in "Attach a recipe". */
  onAttach?: (recipeId: string) => void;
  onSendVoice: (rec: VoiceRecording) => void;
  onSendText: (text: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { t } = useWords();
  const sendVoice = useRef(onSendVoice);
  useEffect(() => {
    sendVoice.current = onSendVoice;
  });
  const rec = useVoiceRecorder({ onAutoStop: (r) => r && sendVoice.current(r) });
  const canTalk = rec.supported !== false;
  const [mode, setMode] = useComposerMode(personId);
  const typing = mode === 'type' || !canTalk;
  // The field takes focus only when someone taps "Type instead", not when the chat opens on it.
  const [focusField, setFocusField] = useState(false);
  const [text, setText] = useState('');
  const input = useRef<TextInput>(null);
  const [picking, setPicking] = useState(false);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (focusTimer.current) clearTimeout(focusTimer.current);
    },
    [],
  );
  const pick = (recipeId: string) => {
    setPicking(false);
    onAttach?.(recipeId);
    if (!typing) return;
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => input.current?.focus(), FOCUS_AFTER_PICK_MS);
  };
  // Leaving the chat (back, or into a recipe / step from a bubble) throws the recording away, so
  // the mic never keeps listening behind another screen.
  const cancelRec = useRef(rec.cancel);
  useEffect(() => {
    cancelRec.current = rec.cancel;
  });
  useFocusEffect(
    useCallback(
      () => () => {
        void cancelRec.current();
      },
      [],
    ),
  );
  const recording = rec.phase === 'recording';
  const busy = rec.phase === 'requesting' || rec.phase === 'stopping';

  // Microphone problems, once (no mic at all is said on the panel instead).
  const lastError = useRef<string | null>(null);
  useEffect(() => {
    if (rec.error && rec.error !== lastError.current && rec.phase !== 'unsupported') toast.show(rec.error, { tone: 'error', durationMs: 3200 });
    lastError.current = rec.error;
  }, [rec.error, rec.phase, toast]);

  const onMic = async () => {
    if (recording) {
      const note = await rec.stop();
      if (note) {
        onSendVoice(note);
        const heard =
          otherName != null
            ? t('messages.panel.willHear', { name: `${otherName.charAt(0).toUpperCase()}${otherName.slice(1)}` })
            : family
              ? t('messages.panel.familyWillHear')
              : t('messages.panel.theyWillHear');
        toast.show(heard, { tone: 'success' });
      } else {
        toast.show(t('messages.composer.tooShort'), { tone: 'info' });
      }
      return;
    }
    const ok = await rec.start();
    if (!ok && !rec.supported) toast.show(t('messages.composer.appOnly'), { tone: 'info' });
  };

  const submit = () => {
    const words = text.trim();
    if (!words) return;
    onSendText(words);
    setText('');
  };

  const pad = { paddingBottom: Math.max(24, insets.bottom + 8) };
  const strip = answering ? <AnsweringStrip answering={answering} style={styles.stretch} /> : null;
  const card = attachment ? <AttachedDish dish={attachment} onRemove={onRemoveAttachment} flat style={typing ? null : styles.center} /> : null;
  const sheet = onAttach ? (
    <RecipePickerSheet visible={picking} onClose={() => setPicking(false)} onPick={(e) => pick(e.id)} selectedId={attachment?.id ?? null} />
  ) : null;
  const writePrompt = attachment
    ? t('messages.panel.writeAboutDish')
    : (prompt ??
      (otherName != null
        ? t('messages.chat.writeTo', { name: otherName })
        : family
          ? t('messages.chat.writeToFamily')
          : t('messages.chat.writeToThem')));

  // Still reading this person's last mode (a moment): the empty panel, so neither mode flashes.
  if (mode === null && canTalk) return <View style={[styles.panel, pad]} />;

  if (typing) {
    return (
      <View style={[styles.panel, styles.typePanel, pad]}>
        {strip}
        {card}
        {canTalk ? null : (
          <Txt variant="meta" size={15} align="center">
            {t(NO_MIC_NOTE)}
          </Txt>
        )}
        <View style={styles.typeRow}>
          {onAttach ? (
            <View style={styles.rowSlot}>
              <AttachButton tone="well" onPress={() => setPicking(true)} />
            </View>
          ) : null}
          <View style={styles.field}>
            {face ? <Avatar profile={face} size={28} style={styles.fieldFace} /> : null}
            <GrowingInput ref={input} value={text} onChangeText={setText} placeholder={writePrompt} autoFocus={focusField} />
          </View>
          <SendPill tone="green" onPress={submit} disabled={!text.trim()} />
        </View>
        {canTalk ? (
          <PressableScale onPress={() => setMode('voice')} style={[styles.linkBtn, styles.center]} accessibilityLabel={t('messages.panel.useVoice')}>
            <Txt variant="label" size={15} weight={600} color={colors.greenDeep}>
              {t('messages.panel.useVoice')}
            </Txt>
          </PressableScale>
        ) : null}
        {sheet}
      </View>
    );
  }

  return (
    <View style={[styles.panel, pad]}>
      {strip}
      {card}
      <View style={styles.micRow}>
        {onAttach && !recording ? (
          <View style={styles.plus}>
            <AttachButton tone="well" size={56} onPress={() => setPicking(true)} />
          </View>
        ) : null}
        <View>
          <BigMic recording={recording} busy={busy} level={rec.level} onPress={onMic} />
          {recording ? (
            <View style={styles.timer} pointerEvents="none" accessibilityLiveRegion="polite">
              <View style={styles.timerDot} />
              <Txt variant="label" size={15} weight={700} color={colors.danger} style={styles.tnum}>
                {mmss(rec.elapsed)}
              </Txt>
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.talkRow}>
        {face && !recording ? <Avatar profile={face} size={24} /> : null}
        <Txt variant="title" size={18}>
          {recording
            ? t('messages.panel.tapAgain')
            : attachment
              ? t('messages.panel.tapAboutIt')
              : face
                ? t('messages.panel.tapAs', { name: face.name })
                : t('messages.composer.tapToTalk')}
        </Txt>
      </View>
      <PressableScale
        onPress={async () => {
          if (recording) await rec.cancel();
          setFocusField(true);
          setMode('type');
        }}
        style={styles.linkBtn}
        accessibilityLabel={t('messages.panel.typeInstead')}>
        <Txt variant="label" size={15} weight={600} color={colors.greenDeep}>
          {t('messages.panel.typeInstead')}
        </Txt>
      </PressableScale>
      {sheet}
    </View>
  );
}

function BigMic({ recording, busy, level, onPress }: { recording: boolean; busy: boolean; level: number; onPress: () => void }) {
  const reduce = useReducedMotion();
  const { t } = useWords();
  const on = useSharedValue(0);
  const lvl = useSharedValue(0);
  useEffect(() => {
    on.value = reduce ? withTiming(recording ? 1 : 0, { duration: 150 }) : withSpring(recording ? 1 : 0, { damping: 18, stiffness: 220, mass: 1 });
  }, [recording, reduce, on]);
  useEffect(() => {
    lvl.value = withTiming(level, { duration: 120 });
  }, [level, lvl]);
  // The bible's 10 px ring, breathing a little with the voice.
  const ring = useAnimatedStyle(() => ({
    opacity: on.value,
    transform: [{ scale: (92 + 20 * on.value + lvl.value * 10 * on.value) / 112 }],
  }));
  return (
    <View style={styles.micWrap}>
      <Animated.View pointerEvents="none" style={[styles.ring, ring]} />
      <PressableScale
        onPress={onPress}
        disabled={busy}
        haptic={recording ? 'medium' : true}
        accessibilityLabel={recording ? t('messages.panel.tapAgain') : t('messages.composer.tapToTalk')}
        accessibilityState={{ selected: recording, busy }}
        style={[
          styles.mic,
          {
            backgroundColor: recording ? colors.danger : colors.green,
            boxShadow: recording ? undefined : shadows.mic,
            opacity: busy ? 0.75 : 1,
          },
        ]}>
        {recording ? <StopIcon size={30} color={colors.card} /> : <MicIcon size={36} color={colors.card} />}
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    backgroundColor: colors.card,
    boxShadow: shadows.panelUp,
    paddingTop: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 12,
    minHeight: 230,
  },
  // The mic stays centred; the "+" sits at the panel's left edge, level with it.
  micRow: { alignSelf: 'stretch', alignItems: 'center' },
  plus: { position: 'absolute', left: 0, top: 18 },
  micWrap: { width: 92, height: 92, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 112, height: 112, borderRadius: 56, backgroundColor: 'rgba(154,79,71,0.18)' },
  mic: { width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center' },
  timer: { position: 'absolute', left: 92 + 22, top: 34, flexDirection: 'row', alignItems: 'center', gap: 6 },
  timerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  tnum: { fontVariant: ['tabular-nums'] },
  linkBtn: { height: 40, paddingHorizontal: 12, justifyContent: 'center' },
  center: { alignSelf: 'center' },
  stretch: { alignSelf: 'stretch' },
  strip: {
    minHeight: 48,
    paddingLeft: 10,
    borderRadius: 18,
    backgroundColor: colors.butter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stripText: { flex: 1, minWidth: 0, paddingVertical: 8 },
  // 48 pt to tap, a 28 pt × to see.
  stripX: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  stripXDisc: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(90,58,34,0.1)', alignItems: 'center', justifyContent: 'center' },
  // Typing: a little narrower padding, so "Write to the family" fits beside "+" and "Send".
  typePanel: { minHeight: 0, paddingTop: 24, paddingHorizontal: 16, alignItems: 'stretch' },
  rowSlot: { height: 56, justifyContent: 'center' },
  talkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%' },
  fieldFace: { marginLeft: -8, marginRight: 10 },
  // Buttons stay at the bottom while the field grows.
  typeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  field: {
    flex: 1,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 17,
    borderRadius: 28,
    backgroundColor: colors.page,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
