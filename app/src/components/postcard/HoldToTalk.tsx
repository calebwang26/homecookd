// "Hold to talk" on the cook's postcard (retention PR 3, RETENTION-HANDOFF 3.4 & section 4): press
// and hold to record a voice reply right there, let go to send it to the kid (lib/voice.ts recorder;
// no new screen, no chat to open). While held: the pill turns the recording red with a soft ring
// (steady under Reduce Motion) and says "Let go to send", and the time so far ("0:04") sits just above
// it, clear of the thumb. A hold too short to be a note (lib/voice MIN_VOICE_S) shows "Hold longer" in
// the pill for a moment (a warning haptic; VoiceOver hears the whole hint). The pill keeps its size
// whatever it says. A release while the microphone is still starting (the first time asks for it)
// counts as too short. No microphone (denied, or a browser without a recorder): a toast says why, as
// the chat composer does.
//
// Letting go doesn't send at once: the note waits on the phone for 3 s (6 s with VoiceOver / TalkBack)
// as "Sending… Undo", with a thin bar running down (none under Reduce Motion). A touch on the pill in
// that time takes it back ("Not sent"; nothing reaches the kid); otherwise it uploads and sends
// ("Sending" -> "Sent", a success haptic, VoiceOver hears "Sent"). A sent voice note can't be taken
// back, so this is the one way out of a false start, a cough or half a thought. If the row goes away
// while the note waits (the sheet closed, the row cleared), it still goes: the cook let go to send
// (postcardLogic holdPress / holdWait).
//
// The pill sits in scrolling places (Parent Home, the "All updates" sheet), so the hold is the raw
// touch responder, not a Pressable: a Pressable lets a parent scroll take the touch and lets go when
// the finger drifts off it, both of which looked like a release and sent a cut-off note. Here only
// lifting the finger ends a hold (anywhere, even off the pill); the touch is never handed to a scroll
// (and on Android the scroll can't intercept it); the page holds still while a finger is down
// (ui/ScrollHold); and a touch the phone takes away (a call, the notification shade) throws the note
// away with "Not sent" (postcardLogic holdEnd). An Undo tap is an ordinary touch: a scroll may take
// it after it has undone. Reaching the recorder's limit waits to send what's there, as a lift does.
//
// VoiceOver / TalkBack: a double-tap is a tap, not a hold. While a note waits it is Undo; otherwise it
// hears how to record (double-tap and hold passes a real hold through) with a light haptic, so that
// tap never meets silence. It never starts the microphone.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { CheckIcon, haptic, MicIcon, Txt, useHoldPage, useToast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { mmss } from '@/lib/format';
import {
  HOLD_TAP_SPOKEN,
  holdEnd,
  holdPress,
  holdWait,
  undoWindowMs,
} from '@/lib/postcardLogic';
import { useVoiceRecorder, type VoiceRecording } from '@/lib/voice';
import { useWords } from '@/lib/words/useWords';
import { alpha, colors, motion, shadows } from '@/theme/tokens';

type State = 'idle' | 'waiting' | 'sending' | 'sent' | 'short' | 'cut' | 'undone' | 'error';
const PRESS_SCALE = 0.97;
const FLASH_MS = 2400;

/** VoiceOver / TalkBack on (native only: a browser always answers yes). */
function useScreenReader() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let live = true;
    AccessibilityInfo.isScreenReaderEnabled?.()
      .then((v) => live && setOn(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('screenReaderChanged', setOn);
    return () => {
      live = false;
      sub?.remove();
    };
  }, []);
  return on;
}

export function HoldToTalk({
  toName,
  onSend,
  style,
}: {
  /** Who hears it ("Leo"), for VoiceOver. */
  toName: string;
  /** Uploads and sends the note; reject = "Try again". */
  onSend: (rec: VoiceRecording) => Promise<unknown>;
  style?: StyleProp<ViewStyle>;
}) {
  // The recorder's limit (lib/voice MAX_VOICE_S) stops it with the finger still down: wait to send what's there.
  const rec = useVoiceRecorder({ onAutoStop: (note) => void (note ? wait(note) : undefined) });
  const toast = useToast();
  const reduce = useReducedMotion();
  const reader = useScreenReader();
  const holdPage = useHoldPage();
  const [state, setState] = useState<State>('idle');
  const released = useRef(true);
  /** This touch is an Undo tap, not a hold. */
  const tapOnly = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The note waiting out its Undo time (the source of truth: a tap and the timer race on it).
  const waiting = useRef<VoiceRecording | null>(null);
  const waitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // For the unmount flush, which outlives this render.
  const { t: words } = useWords();
  const latest = useRef({ onSend, toast, toName, words });
  useEffect(() => {
    latest.current = { onSend, toast, toName, words };
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (waitTimer.current) clearTimeout(waitTimer.current);
      // Gone while a note waited: it still goes (holdWait 'leave'); only Undo un-sends.
      const note = waiting.current;
      waiting.current = null;
      if (note && holdWait('leave') === 'send') {
        const { onSend: go, toast: t, toName: name, words: w } = latest.current;
        void go(note).catch((e) => t.show(errorMessage(e, w('messages.hold.sendFailed', { name })), { tone: 'error' }));
      }
    },
    [],
  );
  const flash = useCallback((s: State) => {
    if (timer.current) clearTimeout(timer.current);
    setState(s);
    const w = latest.current.words;
    if (s === 'short') AccessibilityInfo.announceForAccessibility?.(w('messages.hold.hintSpoken'));
    if (s === 'cut') AccessibilityInfo.announceForAccessibility?.(w('messages.hold.cutSpoken'));
    if (s === 'undone') AccessibilityInfo.announceForAccessibility?.(w('messages.hold.undoneSpoken'));
    if (s !== 'idle' && s !== 'sending' && s !== 'waiting') timer.current = setTimeout(() => setState('idle'), FLASH_MS);
  }, []);

  const recording = rec.phase === 'recording';
  // Let go while the microphone was still starting: throw it away once it has (too short to be a note).
  const cancel = rec.cancel;
  useEffect(() => {
    if (!recording || !released.current) return;
    void cancel();
    haptic('warning');
    flash('short');
  }, [recording, cancel, flash]);

  // Microphone trouble, once each time it changes (no recorder at all is said on press instead).
  const lastError = useRef<string | null>(null);
  useEffect(() => {
    if (rec.error && rec.error !== lastError.current && rec.phase !== 'unsupported') toast.show(rec.error, { tone: 'error', durationMs: 3200 });
    lastError.current = rec.error;
  }, [rec.error, rec.phase, toast]);

  // Unmounted mid-hold (the row went): let the page scroll again.
  useEffect(
    () => () => {
      if (!released.current) holdPage(false);
    },
    [holdPage],
  );

  // Press-in: a gentle scale and fade, as every button (PressableScale); a plain fade under Reduce Motion.
  const pressed = useSharedValue(0);
  const pressStyle = useAnimatedStyle(() => ({
    opacity: 1 - pressed.value * (1 - motion.pressOpacity),
    transform: reduce ? [] : [{ scale: 1 - pressed.value * (1 - PRESS_SCALE) }],
  }));
  const press = (v: number) => {
    pressed.value = reduce ? withTiming(v, { duration: motion.reducedFadeMs }) : withSpring(v, motion.press);
  };

  // The Undo time running down: a thin bar along the pill's foot (none under Reduce Motion).
  const left = useSharedValue(0);
  const leftStyle = useAnimatedStyle(() => ({ width: `${left.value * 100}%` }));

  const down = async () => {
    released.current = false;
    holdPage(true);
    press(1);
    if (!rec.supported) {
      toast.show(rec.error ?? words('messages.hold.appOnly'), { tone: 'info' });
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setState('idle');
    haptic('medium');
    await rec.start();
  };

  // `lift`: the finger came up (wait, then send). `cut`: the phone took the touch away (never send).
  const up = async (how: 'lift' | 'cut') => {
    released.current = true;
    holdPage(false);
    press(0);
    if (!recording) return; // still starting: the effect above throws it away
    let note: VoiceRecording | null = null;
    if (how === 'lift') note = await rec.stop();
    else await rec.cancel();
    const next = holdEnd(how, !!note);
    if (next === 'wait' && note) return wait(note);
    haptic('warning');
    flash(next === 'cut' ? 'cut' : 'short');
  };

  // The note waits on the phone ("Sending… Undo") before it goes.
  function wait(note: VoiceRecording) {
    if (timer.current) clearTimeout(timer.current);
    if (waitTimer.current) clearTimeout(waitTimer.current);
    const ms = undoWindowMs(reader);
    waiting.current = note;
    setState('waiting');
    haptic('light');
    AccessibilityInfo.announceForAccessibility?.(words('messages.hold.waitSpoken', { name: toName.trim() }));
    left.value = 1;
    if (!reduce) left.value = withTiming(0, { duration: ms, easing: Easing.linear });
    waitTimer.current = setTimeout(() => {
      waitTimer.current = null;
      const n = waiting.current;
      waiting.current = null;
      if (n && holdWait('time') === 'send') void send(n);
    }, ms);
  }

  // A screen reader's double-tap: Undo while a note waits; otherwise say how to hold (never silence).
  function activate() {
    if (waiting.current) return undo();
    if (state === 'sending' || recording) return;
    haptic('light');
    AccessibilityInfo.announceForAccessibility?.(HOLD_TAP_SPOKEN);
  }

  // A touch while it waits: take it back. Nothing has left the phone.
  function undo() {
    if (!waiting.current) return;
    if (waitTimer.current) clearTimeout(waitTimer.current);
    waitTimer.current = null;
    waiting.current = null;
    if (holdWait('tap') !== 'undone') return;
    haptic('selection');
    flash('undone');
  }

  async function send(note: VoiceRecording) {
    setState('sending');
    try {
      await onSend(note);
      haptic('success');
      AccessibilityInfo.announceForAccessibility?.(words('messages.hold.sent'));
      flash('sent');
    } catch (e) {
      haptic('error');
      toast.show(errorMessage(e, words('messages.hold.sendFailed', { name: toName })), { tone: 'error' });
      flash('error');
    }
  }

  // A soft ring breathing around the pill while it records (none under Reduce Motion).
  const ring = useSharedValue(0);
  useEffect(() => {
    ring.value = recording && !reduce ? withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0.35, { duration: 700 })), -1) : withTiming(recording ? 1 : 0, { duration: 150 });
  }, [recording, reduce, ring]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: ring.value }));

  const waitingNow = state === 'waiting';
  const label =
    recording
      ? words('messages.hold.letGo')
      : state === 'sending'
        ? words('messages.hold.sending')
        : state === 'sent'
          ? words('messages.hold.sent')
          : state === 'short'
            ? words('messages.hold.hint')
            : state === 'cut'
              ? words('messages.hold.cut')
              : state === 'undone'
                ? words('messages.hold.undone')
                : state === 'error'
                  ? words('messages.hold.tryAgain')
                  : words('messages.hold.idle');
  const sending = state === 'sending';
  const ink = recording ? colors.card : waitingNow ? colors.butterInk : colors.sageInk;
  return (
    <View style={[styles.wrap, style]}>
      <Animated.View pointerEvents="none" style={[styles.ring, ringStyle]} />
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={recording ? words('messages.hold.recordingLabel') : waitingNow ? words('messages.hold.waitingLabel', { name: toName }) : words('messages.hold.idleLabel', { name: toName })}
        accessibilityHint={waitingNow ? words('messages.hold.waitingHint') : words('messages.hold.idleHint')}
        accessibilityState={{ disabled: sending, busy: sending, selected: recording }}
        // VoiceOver / TalkBack double-tap: Undo while it waits, else how to hold (their double-tap-and-hold
        // is a real hold and comes in as touches below).
        accessibilityActions={[{ name: 'activate', label: waitingNow ? words('messages.hold.undo') : words('messages.hold.howTo') }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'activate') activate();
        }}
        onStartShouldSetResponder={() => holdPress(waiting.current ? 'waiting' : state) !== 'busy'}
        // A hold never gives its touch up (a drift can't end it); an Undo tap may, once it has undone.
        onResponderTerminationRequest={() => tapOnly.current}
        onResponderGrant={() => {
          if (holdPress(waiting.current ? 'waiting' : state) === 'undo') {
            tapOnly.current = true;
            press(1);
            undo(); // on touch-down: a tap just in time always wins over the timer
            return false;
          }
          tapOnly.current = false;
          void down();
          return true; // Android: the scroll view may not intercept this touch
        }}
        onResponderRelease={() => {
          if (tapOnly.current) {
            tapOnly.current = false;
            press(0);
            return;
          }
          void up('lift');
        }}
        onResponderTerminate={() => {
          if (tapOnly.current) {
            tapOnly.current = false;
            press(0);
            return;
          }
          void up('cut');
        }}
        style={[styles.pill, recording ? styles.pillRec : waitingNow ? styles.pillWait : null, pressStyle]}>
        {waitingNow && !reduce ? <Animated.View pointerEvents="none" style={[styles.left, leftStyle]} /> : null}
        {sending ? (
          <ActivityIndicator size="small" color={colors.sageInk} />
        ) : state === 'sent' ? (
          <CheckIcon size={16} color={ink} />
        ) : recording ? (
          <View style={styles.recDot} />
        ) : waitingNow ? null : (
          <MicIcon size={18} color={ink} />
        )}
        {waitingNow ? (
          <Txt variant="label" size={15} weight={500} color={ink} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.words}>
            {words('messages.hold.wait')}{' '}
            <Txt variant="label" size={15} weight={700} color={ink} style={styles.undo}>
              {words('messages.hold.undo')}
            </Txt>
          </Txt>
        ) : (
          <Txt variant="label" size={15} weight={700} color={ink} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.words}>
            {label}
          </Txt>
        )}
      </Animated.View>
      {recording ? (
        // The time so far, on the pill's top edge where the thumb doesn't cover it.
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.clockRow}>
          <View style={styles.clock}>
            <Txt variant="label" size={14} weight={700} color={colors.danger} style={styles.tnum}>
              {mmss(rec.elapsed)}
            </Txt>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { justifyContent: 'center' },
  ring: { position: 'absolute', top: -4, bottom: -4, left: -4, right: -4, borderRadius: 999, backgroundColor: alpha.recordHalo },
  // A tab on the pill's top edge, centred: above the thumb, clear of the line above.
  clockRow: { position: 'absolute', left: 0, right: 0, top: -14, alignItems: 'center', zIndex: 1 },
  clock: {
    minWidth: 52,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: alpha.border,
    boxShadow: shadows.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tnum: { fontVariant: ['tabular-nums'] },
  pill: {
    height: 52,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.sage,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    overflow: 'hidden',
  },
  pillRec: { backgroundColor: colors.danger },
  pillWait: { backgroundColor: colors.butter },
  // The Undo time left, shrinking from the full width to nothing along the foot of the pill.
  left: { position: 'absolute', left: 0, bottom: 0, height: 4, backgroundColor: colors.sun },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.card },
  words: { flexShrink: 1 },
  undo: { textDecorationLine: 'underline' },
});
