// Kid-Chat composer: a cream pill field (56 tall, padding 0 20, 0 6px 20px shadow, 16 ink,
// "Message Mom") and a round 56 ink mic. The field grows with the words up to 5 lines (then
// scrolls; Return adds a line). Typing turns the mic into a "Send" pill (icon + the word). Where
// the mic can't record (the web without a recorder) it says "Talking works in the app. Type
// below." over the field and the button is always Send. Tapping the mic
// records a voice note: the field becomes a recording strip (red dot, live level bars, the time,
// "Cancel") and the button turns record-red #9A4F47 with a stop square and a soft red halo; tap
// again to send.
// A round cream "+" (48) left of the field opens "Attach a recipe" (RecipePickerSheet); picking a dish
// puts it in the composer (one at a time: another pick replaces it) and focuses the field. The "+"
// hides while recording.
// An attached dish (picked here, or on the way in: "Ask about a dish", a step) sits above the field as
// a small card (44 thumb, title, a × to remove it) and the field takes focus; whatever is sent next
// carries it. The step, if any, is named once, in the placeholder.
// While the dish's name is still loading, a skeleton line stands in for the title. AttachedDish is
// shared with the cook's AnswerPanel (`flat` on its cream panel).
// `face` (a lent phone: whoever it is writing as) sits at the start of the field.
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { Platform, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Avatar, CloseIcon, MicIcon, PressableScale, SendIcon, Skeleton, StopIcon, Txt, useToast } from '@/components/ui';
import type { Profile } from '@/lib/api';
import { mmss } from '@/lib/format';
import { MAX_VOICE_S, useVoiceRecorder, type VoiceRecording } from '@/lib/voice';
import { useWords } from '@/lib/words/useWords';
import type { WordKey } from '@/lib/words/words';
import { colors, fonts, shadows } from '@/theme/tokens';

import { AttachButton, RecipePickerSheet } from './RecipePickerSheet';

/** The dish waiting to go out with the next message (`title` null while it loads). */
export type ComposerDish = { id?: string; title: string | null; poster: string | null };

/** After a pick, the field takes focus once the picker sheet has gone. */
export const FOCUS_AFTER_PICK_MS = 500;

/** One typed line (16 on 22), and how many lines the field grows to before it scrolls. */
const LINE = 22;
const MAX_LINES = 5;

/** Said where the mic can't record (instead of a greyed-out button): a key, read with t(). */
export const NO_MIC_NOTE: WordKey = 'messages.composer.noMic';

/**
 * The typed field, shared with the cook's AnswerPanel: grows with the words (and a wrapped
 * placeholder) up to 5 lines, then scrolls; Return adds a line. Sits inside a 56-tall field.
 */
export function GrowingInput({
  ref,
  value,
  onChangeText,
  placeholder,
  autoFocus,
}: {
  ref?: Ref<TextInput>;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const [h, setH] = useState(LINE);
  // Cleared after a send: back to one line (the web may not report the smaller size).
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    if (!value) setH(LINE);
  }
  return (
    <TextInput
      ref={ref}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      accessibilityLabel={placeholder}
      multiline
      scrollEnabled={h >= LINE * MAX_LINES}
      textAlignVertical="top"
      onContentSizeChange={(e) => setH(Math.min(LINE * MAX_LINES, Math.max(LINE, Math.ceil(e.nativeEvent.contentSize.height))))}
      style={[styles.input, { height: h }]}
      autoFocus={autoFocus}
      maxLength={2000}
    />
  );
}

/** The green / ink "Send" pill: its icon and the word, 56 tall. */
export function SendPill({ onPress, disabled, tone = 'ink' }: { onPress: () => void; disabled?: boolean; tone?: 'ink' | 'yolk' }) {
  const { t } = useWords();
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      haptic="medium"
      accessibilityRole="button"
      accessibilityLabel={t('messages.composer.send')}
      style={[styles.sendPill, { backgroundColor: tone === 'yolk' ? colors.yolk : colors.ink }, disabled ? styles.dim : null]}>
      <SendIcon size={20} color={tone === 'yolk' ? colors.ink : colors.card} />
      <Txt variant="label" size={16} weight={700} color={tone === 'yolk' ? colors.ink : colors.card}>
        {t('messages.composer.send')}
      </Txt>
    </PressableScale>
  );
}

export function KidComposer({
  placeholder,
  face,
  initialText,
  attachment,
  onRemoveAttachment,
  onAttach,
  onSendText,
  onSendVoice,
}: {
  placeholder: string;
  /** A lent phone: the person it is writing as. */
  face?: Pick<Profile, 'name' | 'avatar_key'> | null;
  initialText?: string;
  attachment?: ComposerDish | null;
  onRemoveAttachment?: () => void;
  /** Shows the "+": the recipe picked in "Attach a recipe". */
  onAttach?: (recipeId: string) => void;
  onSendText: (text: string) => void;
  onSendVoice: (rec: VoiceRecording) => void;
}) {
  const [text, setText] = useState(initialText ?? '');
  const toast = useToast();
  const { t } = useWords();
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
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => input.current?.focus(), FOCUS_AFTER_PICK_MS);
  };
  // Arriving with a dish attached: the field is ready for the question (after the screen slides in).
  const attached = !!attachment;
  useEffect(() => {
    if (!attached) return;
    const t = setTimeout(() => input.current?.focus(), 450);
    return () => clearTimeout(t);
  }, [attached]);
  const sendVoice = useRef(onSendVoice);
  useEffect(() => {
    sendVoice.current = onSendVoice;
  });
  const rec = useVoiceRecorder({ onAutoStop: (r) => r && sendVoice.current(r) });
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
  const hasText = text.trim().length > 0;
  const canTalk = rec.supported !== false;

  const submitText = () => {
    const words = text.trim();
    if (!words) return;
    onSendText(words);
    setText('');
  };

  const onMic = async () => {
    if (hasText) return submitText();
    if (recording) {
      const note = await rec.stop();
      if (note) onSendVoice(note);
      else toast.show(t('messages.composer.tooShort'), { tone: 'info' });
      return;
    }
    const ok = await rec.start();
    if (!ok && rec.supported === false) toast.show(t('messages.composer.appOnly'), { tone: 'info' });
  };

  // Surface microphone problems once.
  const lastError = useRef<string | null>(null);
  useEffect(() => {
    if (rec.error && rec.error !== lastError.current && rec.phase !== 'unsupported')
      toast.show(rec.error, { tone: 'error', durationMs: 3200 });
    lastError.current = rec.error;
  }, [rec.error, rec.phase, toast]);

  return (
    <View style={styles.wrap}>
      {attachment ? <AttachedDish dish={attachment} onRemove={onRemoveAttachment} /> : null}
      {canTalk ? null : (
        <Txt variant="meta" size={14} align="center">
          {t(NO_MIC_NOTE)}
        </Txt>
      )}
      <View style={styles.row}>
        {onAttach && !recording ? (
          <View style={styles.rowSlot}>
            <AttachButton onPress={() => setPicking(true)} />
          </View>
        ) : null}
        {recording ? (
          <RecordingStrip elapsed={rec.elapsed} level={rec.level} onCancel={rec.cancel} />
        ) : (
          <View style={styles.field}>
            {face ? <Avatar profile={face} size={28} style={styles.fieldFace} /> : null}
            <GrowingInput ref={input} value={text} onChangeText={setText} placeholder={placeholder} />
          </View>
        )}
        {(hasText && !recording) || !canTalk ? (
          <SendPill onPress={submitText} disabled={!hasText} />
        ) : (
          <MicButton recording={recording} busy={busy} level={rec.level} onPress={onMic} />
        )}
      </View>
      {onAttach ? (
        <RecipePickerSheet visible={picking} onClose={() => setPicking(false)} onPick={(e) => pick(e.id)} selectedId={attachment?.id ?? null} />
      ) : null}
    </View>
  );
}

/**
 * The attached dish above the field: thumb, title, and a × that takes it off. `flat` drops the
 * shadow and sits on the page colour (inside a cream panel).
 */
export function AttachedDish({
  dish,
  onRemove,
  flat,
  style,
}: {
  dish: ComposerDish;
  onRemove?: () => void;
  flat?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useWords();
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(150)}
      style={[styles.attach, flat ? styles.attachFlat : styles.attachRaised, onRemove ? null : styles.attachBare, style]}>
      {dish.poster ? (
        <Image source={{ uri: dish.poster }} style={styles.attachThumb} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.attachThumb, styles.attachThumbEmpty]} />
      )}
      <View style={styles.attachText} accessible accessibilityLabel={
          dish.title != null ? t('messages.composer.attached', { dish: dish.title }) : t('messages.composer.attachedNoName')
        }>
        {dish.title ? (
          <Txt variant="rowTitle" size={15} numberOfLines={2}>
            {dish.title}
          </Txt>
        ) : (
          <Skeleton width={140} height={15} radius={6} />
        )}
      </View>
      {onRemove ? (
        <PressableScale onPress={onRemove} haptic accessibilityLabel={dish.title != null ? t('messages.composer.remove', { dish: dish.title }) : t('messages.composer.removeNoName')} style={styles.attachRemove}>
          <View style={styles.attachX}>
            <CloseIcon size={14} color={colors.ink} strokeWidth={2.4} />
          </View>
        </PressableScale>
      ) : null}
    </Animated.View>
  );
}

function MicButton({ recording, busy, level, onPress }: { recording: boolean; busy: boolean; level: number; onPress: () => void }) {
  const reduce = useReducedMotion();
  const halo = useSharedValue(0);
  useEffect(() => {
    halo.value = recording
      ? reduce
        ? withTiming(1, { duration: 150 })
        : withSpring(1, { damping: 16, stiffness: 220, mass: 1 })
      : withTiming(0, { duration: 160 });
  }, [recording, reduce, halo]);
  const lvl = useSharedValue(0);
  const { t } = useWords();
  useEffect(() => {
    lvl.value = withTiming(level, { duration: 120 });
  }, [level, lvl]);
  const haloStyle = useAnimatedStyle(() => ({
    opacity: halo.value,
    transform: [{ scale: 1 + halo.value * (0.2 + lvl.value * 0.12) }],
  }));
  const label = recording ? t('messages.composer.stopAndSend') : t('messages.composer.tapToTalk');
  return (
    <View style={styles.micWrap}>
      <Animated.View pointerEvents="none" style={[styles.halo, haloStyle]} />
      <PressableScale
        onPress={onPress}
        disabled={busy}
        haptic={recording ? 'medium' : true}
        accessibilityLabel={label}
        accessibilityState={{ selected: recording, busy }}
        style={[styles.mic, { backgroundColor: recording ? colors.danger : colors.ink, opacity: busy ? 0.7 : 1 }]}>
        {recording ? <StopIcon size={24} color={colors.card} /> : <MicIcon size={24} color={colors.card} />}
      </PressableScale>
    </View>
  );
}

/** The field while recording: pulsing red dot, live bars from the mic level, time, Cancel. */
function RecordingStrip({ elapsed, level, onCancel }: { elapsed: number; level: number; onCancel: () => void }) {
  const reduce = useReducedMotion();
  const { t } = useWords();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduce) return;
    pulse.value = withRepeat(withTiming(0.35, { duration: 700 }), -1, true);
  }, [pulse, reduce]);
  const dot = useAnimatedStyle(() => ({ opacity: pulse.value }));
  // A rolling history of the mic level (one bar per meter update), derived during render.
  const [bars, setBars] = useState<number[]>(() => Array.from({ length: 14 }, () => 0.15));
  const [seenAt, setSeenAt] = useState(elapsed);
  if (elapsed !== seenAt) {
    setSeenAt(elapsed);
    setBars([...bars.slice(1), Math.max(0.15, level)]);
  }
  const nearEnd = elapsed > MAX_VOICE_S - 15;
  return (
    <View style={[styles.field, styles.strip]} accessibilityLiveRegion="polite" accessibilityLabel={t('messages.composer.recording', { time: mmss(elapsed) })}>
      <Animated.View style={[styles.recDot, dot]} />
      <Txt variant="label" size={16} weight={700} color={colors.danger} style={styles.tnum}>
        {mmss(elapsed)}
      </Txt>
      <View style={styles.bars}>
        {bars.map((b, i) => (
          <View key={i} style={[styles.bar, { height: 4 + Math.round(b * 20) }]} />
        ))}
      </View>
      <PressableScale onPress={onCancel} accessibilityLabel={t('messages.composer.cancelRecording')} hitSlop={10}>
        <Txt variant="label" size={15} weight={600} color={nearEnd ? colors.danger : colors.muted}>
          {t('messages.composer.cancel')}
        </Txt>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  // Buttons stay at the bottom while the field grows.
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  rowSlot: { height: 56, justifyContent: 'center' },
  attach: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 56,
    paddingLeft: 6,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  attachRaised: { backgroundColor: colors.card, boxShadow: shadows.composer },
  attachFlat: { backgroundColor: colors.page },
  attachBare: { paddingRight: 14 },
  attachThumb: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.well },
  attachThumbEmpty: { backgroundColor: colors.well },
  attachText: { flexShrink: 1, minWidth: 0, gap: 2, paddingVertical: 6 },
  // 48 pt to tap, a small 28 pt × to see.
  attachRemove: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  attachX: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.well, alignItems: 'center', justifyContent: 'center' },
  field: {
    flex: 1,
    minHeight: 56,
    paddingHorizontal: 20,
    paddingVertical: (56 - LINE) / 2,
    borderRadius: 28,
    backgroundColor: colors.card,
    boxShadow: shadows.composer,
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Exported layout for GrowingInput: no padding of its own (the field pads it), 16 on 22.
  input: {
    flex: 1,
    minWidth: 0,
    paddingTop: 0,
    paddingBottom: 0,
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: LINE,
    color: colors.ink,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  sendPill: { height: 56, paddingHorizontal: 16, borderRadius: 28, flexDirection: 'row', alignItems: 'center', gap: 6 },
  dim: { opacity: 0.45 },
  strip: { gap: 12, height: 56, paddingVertical: 0 },
  fieldFace: { marginLeft: -8, marginRight: 10 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
  tnum: { fontVariant: ['tabular-nums'], minWidth: 40 },
  bars: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3, overflow: 'hidden', height: 28 },
  bar: { width: 3, borderRadius: 1.5, backgroundColor: colors.danger, opacity: 0.55 },
  micWrap: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(154,79,71,0.18)' },
  mic: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
});
