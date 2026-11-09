// Motion spec 4 bottom sheet (Share sheet, Ask sheet, sign-up, record confirm).
//  - Backdrop: blur 30 + rgba(24,34,29,0.35), fades in over 220 ms. Tap it to dismiss.
//  - Sheet: white #FFFFFF, top corners 32, grabber 36x5 rgba(24,34,29,0.18); slides up from its
//    height on a spring (damping 20, stiffness 220, mass 0.9); closes in 240 ms Easing.in(cubic).
//  - Optional round close button top-right and a pinned `footer` (one big pill button).
//  - Drag the top of the sheet down to dismiss (bonus; tap and close always work). `dismissOnDrag={false}`
//    turns the drag off and hides the grabber (a sheet that only its own buttons may answer).
//  - `success={{ title, subtitle }}` runs the Luma confirmation: the content fades out, a
//    SuccessBurst plays at the top-centre, holds 1.4 s, then `onSuccessDone` (default: onClose).
// Renders in a transparent native Modal so it sits above tabs and navigators on iOS and web.
// Its lifecycle is the table in lib/sheets/machine.ts (hidden, held, open, closing), held in one place by
// lib/sheets/coordinator.ts. iOS: a sheet opening while another one is still animating out (or, created
// already open, while any other sheet's Modal is up) waits for that one's Modal to go
// (presenting a Modal mid-dismissal is a UIKit hazard), up to CLOSING_WAIT_MS, then SETTLE_MS more
// so UIKit's dismissal finishes before the next presentViewController.
import { BlurView } from 'expo-blur';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { useMachine } from '@/lib/machine';
import { forgetSheet, othersClosing as othersClosingNow, reportSheet, upCount, useOthersClosing } from '@/lib/sheets/coordinator';
import { heldWaitMs, initialSheetState, isUp, sheetMachine, showEvent } from '@/lib/sheets/machine';
import { alpha, colors, motion, radii } from '@/theme/tokens';

import { CloseIcon } from './icons';
import { IconButton } from './IconButton';
import { SuccessBurst } from './SuccessBurst';
import { ToastViewport } from './Toast';
import { Txt } from './Txt';

export type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  children?: ReactNode;
  /** Optional title row (Fraunces 24) under the grabber. */
  title?: string;
  /** Round close button top-right (default true). */
  showClose?: boolean;
  /** Pinned at the bottom, e.g. <ActionButton ... />. */
  footer?: ReactNode;
  /** When set, plays the success choreography in place of the content. */
  success?: { title: string; subtitle?: string } | null;
  onSuccessDone?: () => void;
  /** Sheet background (default white #FFFFFF). */
  background?: string;
  /** Max height as a fraction of the window (default 0.92). */
  maxHeightRatio?: number;
  /** Tap on the backdrop closes (default true). */
  dismissOnBackdrop?: boolean;
  /** Dragging the top down closes (default true). False: no drag and no grabber; Android back still calls onClose. */
  dismissOnDrag?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /** Lifecycle breadcrumbs ('modal mounted', 'modal shown', ...), e.g. into the share trail. */
  onTrace?: (what: string) => void;
  /** The native Modal finished presenting (Modal onShow). */
  onShown?: () => void;
};

/** How many sheets have their Modal up right now (root hosts like the push ask wait for 0). */
export { useSheetsUp } from '@/lib/sheets/coordinator';

export function BottomSheet({
  visible,
  onClose,
  children,
  title,
  showClose = true,
  footer,
  success,
  onSuccessDone,
  background = colors.card,
  maxHeightRatio = 0.92,
  dismissOnBackdrop = true,
  dismissOnDrag = true,
  contentStyle,
  accessibilityLabel,
  onTrace,
  onShown,
}: BottomSheetProps) {
  const sheetId = useId();
  const othersClosing = useOthersClosing(sheetId);
  // Created already visible, it waits while any other sheet's Modal is up: that one may be closing in
  // this same tap ("New message" → "Add family") and only reports it from its effect. Presenting over a
  // dismissing Modal on iOS showed nothing, and an invisible Modal took every tap (1.1, Nov 8).
  const [state, send] = useMachine(sheetMachine, () => initialSheetState(visible, upCount(sheetId) > 0));
  const mounted = isUp(state);
  const { height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();

  const y = useSharedValue(winH); // sheet translateY
  const back = useSharedValue(0); // backdrop opacity
  const content = useSharedValue(1); // content opacity (fades out on success)
  const [sheetH, setSheetH] = useState(0);
  const [burst, setBurst] = useState(false);

  // `visible` becomes an event before paint (the frame the sheet used to set its flags in during render).
  const lastVisible = useRef(visible);
  useLayoutEffect(() => {
    if (visible === lastVisible.current) return;
    lastVisible.current = visible;
    send(visible ? showEvent(othersClosingNow(sheetId)) : 'hide');
  }, [visible, send, sheetId]);

  // Held: present SETTLE_MS after the other sheet's Modal is gone, never later than CLOSING_WAIT_MS while
  // it is still closing.
  useEffect(() => {
    if (state !== 'held') return;
    const t = setTimeout(() => send('settled'), heldWaitMs(othersClosing));
    return () => clearTimeout(t);
  }, [state, othersClosing, send]);

  // The coordinator holds every sheet's state; this sheet is the only one that reports it.
  useEffect(() => reportSheet(sheetId, state), [sheetId, state]);
  useEffect(() => () => forgetSheet(sheetId), [sheetId]);

  // Latest callbacks behind stable handlers (react-native-web re-fires onShow when it changes).
  const traceRef = useRef(onTrace);
  const shownRef = useRef(onShown);
  useLayoutEffect(() => {
    traceRef.current = onTrace;
    shownRef.current = onShown;
  });
  const handleShow = useCallback(() => {
    traceRef.current?.('modal shown');
    shownRef.current?.();
  }, []);

  // Layout effect, so 'mounted' is logged before the Modal's onShow.
  useLayoutEffect(() => {
    if (!mounted) return;
    traceRef.current?.('modal mounted');
    return () => traceRef.current?.('modal unmounted');
  }, [mounted]);
  useEffect(() => {
    if (state === 'held') traceRef.current?.(othersClosing ? 'waiting for another sheet to close' : 'other sheet gone, settling');
  }, [state, othersClosing]);

  const closing = state === 'closing';
  useEffect(() => {
    if (!closing) return;
    back.set(withTiming(0, { duration: motion.backdropMs }));
    y.set(
      reduce
        ? withTiming(0, { duration: 1 })
        : withTiming(sheetH || winH, { duration: motion.sheetCloseMs, easing: Easing.in(Easing.cubic) }),
    );
    const t = setTimeout(() => {
      send('closeDone');
      // Gone: the next opening starts with its content and no burst.
      setBurst(false);
      content.set(1);
    }, reduce ? motion.reducedFadeMs : motion.sheetCloseMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  // Slide in once the sheet has a height.
  const open = state === 'open';
  useEffect(() => {
    if (!open || !sheetH) return;
    traceRef.current?.(`laid out ${Math.round(sheetH)}pt, sliding in`);
    back.set(withTiming(1, { duration: motion.backdropMs }));
    if (reduce) {
      y.set(0);
    } else {
      y.set(sheetH);
      y.set(withSpring(0, motion.sheet));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sheetH > 0]);

  // Success: fade the content out, then burst.
  useEffect(() => {
    if (!success) return;
    content.set(withTiming(0, { duration: 200 }));
    const t = setTimeout(() => setBurst(true), 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [success?.title]);

  const sheetStyle = useAnimatedStyle(() =>
    reduce ? { opacity: back.value, transform: [{ translateY: 0 }] } : { opacity: 1, transform: [{ translateY: Math.max(y.value, -24) }] },
  );
  const backStyle = useAnimatedStyle(() => ({ opacity: back.value }));
  const contentStyleA = useAnimatedStyle(() => ({ opacity: content.value }));

  const drag = Gesture.Pan()
    .enabled(dismissOnDrag)
    .activeOffsetY(8)
    .onChange((e) => {
      y.set(Math.max(0, y.get() + e.changeY));
    })
    .onEnd((e) => {
      if (y.get() > Math.min(140, sheetH * 0.3) || e.velocityY > 900) {
        scheduleOnRN(onClose);
      } else {
        y.set(withSpring(0, motion.sheet));
      }
    });

  if (!mounted) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      onShow={handleShow}>
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View style={[StyleSheet.absoluteFill, backStyle]}>
          <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: alpha.backdrop }]} />
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={dismissOnBackdrop && !success ? onClose : undefined}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
        </Animated.View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.anchor} pointerEvents="box-none">
          <Animated.View
            accessibilityViewIsModal
            accessibilityLabel={accessibilityLabel ?? title}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              // Ignore a NaN / zero first pass; the slide-in waits for a real height.
              if (Number.isFinite(h) && h > 0) setSheetH(h);
            }}
            style={[
              styles.sheet,
              { backgroundColor: background, maxHeight: winH * maxHeightRatio, paddingBottom: Math.max(insets.bottom, 16) + 8 },
              sheetStyle,
            ]}>
            <GestureDetector gesture={drag}>
              <View style={styles.handleZone}>
                {dismissOnDrag ? <View style={styles.grabber} /> : null}
              </View>
            </GestureDetector>
            {showClose ? (
              <IconButton
                icon={(c) => <CloseIcon size={18} color={c} />}
                tone="well"
                size={40}
                accessibilityLabel="Close"
                onPress={onClose}
                style={styles.close}
              />
            ) : null}
            <Animated.View style={[styles.content, contentStyleA, contentStyle]} pointerEvents={success ? 'none' : 'auto'}>
              {title ? (
                <Txt variant="chatName" style={styles.title}>
                  {title}
                </Txt>
              ) : null}
              {children}
              {footer ? <View style={styles.footer}>{footer}</View> : null}
            </Animated.View>
            {success && burst ? (
              <View style={styles.burst} pointerEvents="none">
                <SuccessBurst title={success.title} subtitle={success.subtitle} onDone={onSuccessDone ?? onClose} />
              </View>
            ) : null}
          </Animated.View>
        </KeyboardAvoidingView>
        <ToastViewport position="top" inSheet sheetId={sheetId} />
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  anchor: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    overflow: 'hidden',
    boxShadow: '0 -10px 30px rgba(24,34,29,0.10)',
  },
  handleZone: { height: 24, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 8 },
  grabber: { width: 36, height: 5, borderRadius: 2.5, backgroundColor: alpha.grabber },
  close: { position: 'absolute', right: 16, top: 16, zIndex: 2 },
  content: { paddingHorizontal: 24, paddingTop: 8, gap: 16 },
  title: { paddingRight: 48 },
  footer: { marginTop: 8 },
  // The badge sits in the middle of the emptied sheet (content-height sheets would otherwise leave
  // a blank lower half under a top-anchored badge).
  burst: { position: 'absolute', left: 24, right: 24, top: 24, bottom: 24, alignItems: 'center', justifyContent: 'center' },
});
