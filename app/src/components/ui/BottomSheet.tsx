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
// iOS: a sheet opening while another one is still animating out (or, created already open, while any
// other sheet's Modal is up) waits for that one's Modal to go
// (presenting a Modal mid-dismissal is a UIKit hazard), up to CLOSING_WAIT_MS, then SETTLE_MS more
// so UIKit's dismissal finishes before the next presentViewController.
import { BlurView } from 'expo-blur';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
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

// Sheets whose Modal is still up while they animate out.
const closing = new Set<string>();
const closingListeners = new Set<() => void>();
const CLOSING_WAIT_MS = 600;
// After the other sheet's Modal has gone, a few frames before this one presents.
const SETTLE_MS = 60;
function setClosing(id: string, on: boolean) {
  const had = closing.has(id);
  if (on === had) return;
  if (on) closing.add(id);
  else closing.delete(id);
  closingListeners.forEach((l) => l());
}
function subscribeClosing(l: () => void) {
  closingListeners.add(l);
  return () => {
    closingListeners.delete(l);
  };
}

// Sheets whose Modal is up (open or closing). UIKit won't present a Modal from the root while
// another is up, so a sheet that isn't nested in another (the push ask) waits for none (useSheetsUp).
const up = new Set<string>();
function setUp(id: string, on: boolean) {
  if (on === up.has(id)) return;
  if (on) up.add(id);
  else up.delete(id);
  closingListeners.forEach((l) => l());
}

/** How many sheets have their Modal up right now. */
export function useSheetsUp(): number {
  return useSyncExternalStore(subscribeClosing, () => up.size, () => 0);
}

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
  const othersClosing = useSyncExternalStore(
    subscribeClosing,
    () => closing.size > (closing.has(sheetId) ? 1 : 0),
    () => false,
  );
  // True once this open has had to wait on another sheet; it then mounts from the timer below.
  // A sheet created already visible (the keyed sheets make a fresh one per opening: "New message" →
  // "Add family") starts held when another sheet's Modal is up, since that one may be closing in this
  // same tap and only says so in its effect. Mounting at once presented over a dismissing Modal on iOS:
  // nothing showed, and an invisible Modal took every tap on the screen (1.1, Nov 8).
  const [held, setHeld] = useState(() => visible && up.size > 0);
  const [mounted, setMounted] = useState(() => visible && !held);
  const { height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();

  const y = useSharedValue(winH); // sheet translateY
  const back = useSharedValue(0); // backdrop opacity
  const content = useSharedValue(1); // content opacity (fades out on success)
  const [sheetH, setSheetH] = useState(0);
  const [burst, setBurst] = useState(false);

  // Mount as soon as we become visible (derived during render), unless another sheet's Modal is
  // still going away; unmount after the close animation.
  const waiting = visible && !mounted && (held || othersClosing);
  if (waiting && !held) setHeld(true);
  if (!visible && held) setHeld(false);
  if (visible && !mounted && !waiting) setMounted(true);

  // Waiting on another sheet: mount SETTLE_MS after its Modal is gone, never later than
  // CLOSING_WAIT_MS while it is still closing.
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setMounted(true), othersClosing ? CLOSING_WAIT_MS : SETTLE_MS);
    return () => clearTimeout(t);
  }, [waiting, othersClosing]);

  // Registered as closing from the moment it is hidden until its Modal unmounts.
  useEffect(() => {
    setClosing(sheetId, mounted && !visible);
  }, [sheetId, mounted, visible]);
  useEffect(() => () => setClosing(sheetId, false), [sheetId]);
  useEffect(() => setUp(sheetId, mounted), [sheetId, mounted]);
  useEffect(() => () => setUp(sheetId, false), [sheetId]);

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
    if (waiting) traceRef.current?.(othersClosing ? 'waiting for another sheet to close' : 'other sheet gone, settling');
  }, [waiting, othersClosing]);

  useEffect(() => {
    if (visible || !mounted) return;
    back.set(withTiming(0, { duration: motion.backdropMs }));
    y.set(
      reduce
        ? withTiming(0, { duration: 1 })
        : withTiming(sheetH || winH, { duration: motion.sheetCloseMs, easing: Easing.in(Easing.cubic) }),
    );
    const t = setTimeout(() => {
      setMounted(false);
      setBurst(false);
      content.set(1);
    }, reduce ? motion.reducedFadeMs : motion.sheetCloseMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Slide in once the sheet has a height.
  useEffect(() => {
    if (!visible || !mounted || !sheetH) return;
    traceRef.current?.(`laid out ${Math.round(sheetH)}pt, sliding in`);
    back.set(withTiming(1, { duration: motion.backdropMs }));
    if (reduce) {
      y.set(0);
    } else {
      y.set(sheetH);
      y.set(withSpring(0, motion.sheet));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mounted, sheetH > 0]);

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
        <ToastViewport position="top" inSheet />
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
