// Motion spec 4 bottom sheet (Share sheet, Ask sheet, sign-up, record confirm).
//  - Backdrop: blur 30 + rgba(24,34,29,0.35), fades in over 220 ms. Tap it to dismiss.
//  - Sheet: white #FFFFFF, top corners 32, grabber 36x5 rgba(24,34,29,0.18); slides up from its
//    height on a spring (damping 20, stiffness 220, mass 0.9); closes in 240 ms Easing.in(cubic).
//  - Optional round close button top-right and a pinned `footer` (one big pill button).
//  - Drag the top of the sheet down to dismiss (bonus; tap and close always work). `dismissOnDrag={false}`
//    turns the drag off and hides the grabber (a sheet that only its own buttons may answer).
//  - `success={{ title, subtitle }}` runs the Luma confirmation: the content fades out, a
//    SuccessBurst plays at the top-centre, holds 1.4 s, then `onSuccessDone` (default: onClose).
//  - `placement="center"` (the "Update homecookd" popup, Caleb Nov 10): the same sheet in the middle of the
//    screen over blurred glass (a light blur, no grey-out), all corners round, no grabber or drag; it fades and
//    grows in (0.94 -> 1) and fades out on the same timings. Its lifecycle is the same as every sheet's.
// Renders in a transparent native Modal so it sits above tabs and navigators on iOS and web.
// Its lifecycle is the table in lib/sheets/machine.ts (hidden, held, open, closing), held in one place by
// lib/sheets/coordinator.ts. iOS: a sheet that becomes visible while any other sheet's Modal is up (one
// still sliding out included) waits until every one has gone, then SETTLE_MS more so UIKit's dismissal
// finishes before the next presentViewController; presenting over a Modal that is up is refused, and the
// screen then takes no taps (#402, iOS journey 4). A sheet rendered inside another sheet's content
// presents over it and doesn't wait for it. Held for HELD_MAX_MS, it gives up (onDropped).
import { BlurView } from 'expo-blur';
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { forgetSheet, holdSheet, modalGone, moveSheet, showEventFor } from '@/lib/sheets/coordinator';
import { isUp, sheetMachine } from '@/lib/sheets/machine';
import { alpha, colors, motion, radii, shadows } from '@/theme/tokens';

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
  /**
   * It was held behind another sheet for HELD_MAX_MS and gave up without showing. Default: onClose. A sheet
   * whose onClose records an answer (the push ask's 30-day snooze) passes one that records nothing.
   */
  onDropped?: () => void;
  /** 'bottom' (default): slides up from the bottom. 'center': a popup in the middle of the screen over blurred glass. */
  placement?: 'bottom' | 'center';
};

/** The sheets a sheet's content sits inside: a sheet rendered there presents over them, so they don't hold it. */
const NO_ANCESTORS: readonly string[] = [];
const SheetAncestors = createContext<readonly string[]>(NO_ANCESTORS);

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
  onDropped,
  placement = 'bottom',
}: BottomSheetProps) {
  const center = placement === 'center';
  const sheetId = useId();
  const ancestors = useContext(SheetAncestors);
  const inside = useMemo(() => [...ancestors, sheetId], [ancestors, sheetId]);
  // Every sheet starts hidden; one created visible opens from the layout effect below, exactly as one shown
  // later, so both wait behind any other sheet's Modal ("New message" → "Add family", #402).
  const [state, send] = useMachine(sheetMachine, 'hidden');
  const mounted = isUp(state);
  const { height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();

  const y = useSharedValue(winH); // sheet translateY
  const back = useSharedValue(0); // backdrop opacity
  const content = useSharedValue(1); // content opacity (fades out on success)
  const [sheetH, setSheetH] = useState(0);
  const [burst, setBurst] = useState(false);

  // Latest state and callbacks for the decisions below, set before the layout effects that read them
  // (react-native-web re-fires onShow when its handler changes, so that one stays stable).
  const stateRef = useRef(state);
  const traceRef = useRef(onTrace);
  const shownRef = useRef(onShown);
  const closeRef = useRef(onClose);
  const droppedRef = useRef(onDropped);
  useLayoutEffect(() => {
    stateRef.current = state;
    traceRef.current = onTrace;
    shownRef.current = onShown;
    closeRef.current = onClose;
    droppedRef.current = onDropped;
  });

  // `visible` becomes an event before paint, on mount too: held while any other sheet's Modal is up (one
  // hiding in this same tap included), else open. The move is recorded in the coordinator here (moveSheet),
  // so a sheet deciding after this one in the same commit already sees it.
  const lastVisible = useRef(false);
  useLayoutEffect(() => {
    if (visible === lastVisible.current) return;
    lastVisible.current = visible;
    const event = visible ? showEventFor(sheetId, ancestors) : 'hide';
    moveSheet(sheetId, stateRef.current, event);
    send(event);
  }, [visible, send, sheetId, ancestors]);

  // Held: it presents SETTLE_MS after every other sheet's Modal is gone (coordinator.holdSheet), and after
  // HELD_MAX_MS it gives up rather than present over one that is still up. The trace says only that.
  useEffect(() => {
    if (state !== 'held') return;
    traceRef.current?.('waiting for another sheet to go');
    return holdSheet(sheetId, ancestors, {
      settle: () => {
        traceRef.current?.('other sheets gone, presenting');
        moveSheet(sheetId, 'held', 'settled');
        send('settled');
      },
      drop: () => {
        traceRef.current?.('still waiting after 30 s: dropped, not shown');
        moveSheet(sheetId, 'held', 'drop');
        send('drop');
        (droppedRef.current ?? closeRef.current)();
      },
    });
  }, [state, sheetId, ancestors, send]);

  // Every move is recorded where it's decided (moveSheet: the layout effect above, holdSheet's settle and
  // drop), and its Modal's going in the commit that unmounts it (modalGone, below); never again from a passive
  // effect: a render's passive effect can flush after a newer move (React flushes them before the next sync
  // render) and would write a stale state back.
  useEffect(() => () => forgetSheet(sheetId), [sheetId]);

  const handleShow = useCallback(() => {
    traceRef.current?.('modal shown');
    shownRef.current?.();
  }, []);

  // Layout effect, so 'mounted' is logged before the Modal's onShow. Its cleanup runs in the very commit that
  // unmounts the Modal (closeDone, or the owner unmounting): only then does the coordinator hear this sheet is
  // gone, so a held sheet's SETTLE_MS never starts before UIKit is told to take this Modal away.
  useLayoutEffect(() => {
    if (!mounted) return;
    traceRef.current?.('modal mounted');
    return () => {
      modalGone(sheetId);
      traceRef.current?.('modal unmounted');
    };
  }, [mounted, sheetId]);
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
      // Only the dispatch: the coordinator hears the sheet is gone from the commit that unmounts its Modal.
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

  // A centred popup fades and grows in with the backdrop; a bottom sheet slides.
  const sheetStyle = useAnimatedStyle(() =>
    center
      ? { opacity: back.value, transform: [{ scale: reduce ? 1 : 0.94 + 0.06 * back.value }] }
      : reduce
        ? { opacity: back.value, transform: [{ translateY: 0 }] }
        : { opacity: 1, transform: [{ translateY: Math.max(y.value, -24) }] },
  );
  const backStyle = useAnimatedStyle(() => ({ opacity: back.value }));
  const contentStyleA = useAnimatedStyle(() => ({ opacity: content.value }));

  const drag = Gesture.Pan()
    .enabled(dismissOnDrag && !center)
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
      <SheetAncestors.Provider value={inside}>
        <GestureHandlerRootView style={styles.fill}>
          <Animated.View style={[StyleSheet.absoluteFill, backStyle]}>
            {center ? (
              <>
                <BlurView intensity={GLASS_BLUR} tint="light" style={StyleSheet.absoluteFill} />
                <View style={[StyleSheet.absoluteFill, { backgroundColor: alpha.glass }]} />
              </>
            ) : (
              <>
                <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
                <View style={[StyleSheet.absoluteFill, { backgroundColor: alpha.backdrop }]} />
              </>
            )}
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={dismissOnBackdrop && !success ? onClose : undefined}
              accessibilityRole="button"
              accessibilityLabel="Close"
            />
          </Animated.View>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={center ? [styles.middle, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }] : styles.anchor}
            pointerEvents="box-none">
            <Animated.View
              accessibilityViewIsModal
              role={center ? 'dialog' : undefined}
              accessibilityLabel={accessibilityLabel ?? title}
              onLayout={(e) => {
                const h = e.nativeEvent.layout.height;
                // Ignore a NaN / zero first pass; the slide-in waits for a real height.
                if (Number.isFinite(h) && h > 0) setSheetH(h);
              }}
              style={[
                center ? styles.popup : styles.sheet,
                { backgroundColor: background, maxHeight: winH * maxHeightRatio, paddingBottom: center ? 24 : Math.max(insets.bottom, 16) + 8 },
                sheetStyle,
              ]}>
              {center ? (
                <View style={styles.popupTop} />
              ) : (
                <GestureDetector gesture={drag}>
                  <View style={styles.handleZone}>
                    {dismissOnDrag ? <View style={styles.grabber} /> : null}
                  </View>
                </GestureDetector>
              )}
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
      </SheetAncestors.Provider>
    </Modal>
  );
}

/** The centred popup's backdrop: a light blur, so Home shows through as frosted glass (Caleb: "like blurry glass"). */
const GLASS_BLUR = 50;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  anchor: { flex: 1, justifyContent: 'flex-end' },
  middle: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  sheet: {
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    overflow: 'hidden',
    boxShadow: '0 -10px 30px rgba(24,34,29,0.10)',
  },
  popup: { width: '100%', maxWidth: 440, borderRadius: radii.sheet, overflow: 'hidden', boxShadow: shadows.popup },
  popupTop: { height: 20 },
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
