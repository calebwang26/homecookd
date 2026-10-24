// Toasts ("Link copied"). An ink pill with a green check disc (an error: a red disc with an x),
// rising 16 px into place above the tab bar, gone after ~2.2 s.
//
//   <ToastProvider> ... </ToastProvider>         (root layout)
//   const toast = useToast(); toast.show('Link copied');
//
// Toasts must also show above a bottom sheet, which on iOS is a separate native Modal. So the
// provider renders into the most recently mounted <ToastViewport/>: the root one by default, and the
// one inside an open BottomSheet while it is up (BottomSheet mounts its own viewport).
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, useReducedMotion, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, tabBar } from '@/theme/tokens';

import { haptic } from './haptics';
import { CheckIcon, CloseIcon } from './icons';
import { Txt } from './Txt';

export type ToastTone = 'success' | 'info' | 'error';
export type ToastOptions = { tone?: ToastTone; icon?: ReactNode; durationMs?: number };
type ToastItem = { id: number; message: string } & ToastOptions;

type Ctx = {
  show: (message: string, opts?: ToastOptions) => void;
  hide: () => void;
  register: (id: string) => () => void;
  activeViewport: string | null;
  current: ToastItem | null;
};

const ToastContext = createContext<Ctx | null>(null);

export function ToastProvider({ children, bottom = tabBar.clearance - 4 }: { children: ReactNode; bottom?: number }) {
  const [current, setCurrent] = useState<ToastItem | null>(null);
  const [viewports, setViewports] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setCurrent(null);
  }, []);

  const show = useCallback((message: string, opts: ToastOptions = {}) => {
    if (timer.current) clearTimeout(timer.current);
    seq.current += 1;
    setCurrent({ id: seq.current, message, ...opts });
    haptic(opts.tone === 'error' ? 'error' : 'light');
    timer.current = setTimeout(() => setCurrent(null), opts.durationMs ?? 2200);
  }, []);

  const register = useCallback((id: string) => {
    setViewports((v) => [...v.filter((x) => x !== id), id]);
    return () => setViewports((v) => v.filter((x) => x !== id));
  }, []);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const value = useMemo<Ctx>(
    () => ({ show, hide, register, current, activeViewport: viewports[viewports.length - 1] ?? null }),
    [show, hide, register, current, viewports],
  );

  return (
    <ToastContext value={value}>
      {children}
      <ToastViewport bottom={bottom} />
    </ToastContext>
  );
}

const noop: Pick<Ctx, 'show' | 'hide'> = {
  show: (m) => {
    if (__DEV__) console.warn(`[toast] no ToastProvider mounted: "${m}"`);
  },
  hide: () => {},
};

/** `{ show(message, {tone, icon, durationMs}), hide() }`. Safe without a provider (no-op). */
export function useToast(): Pick<Ctx, 'show' | 'hide'> {
  const ctx = useContext(ToastContext);
  return ctx ? { show: ctx.show, hide: ctx.hide } : noop;
}

/** Where toasts render. Mount one inside any native overlay (BottomSheet does this for you). */
export function ToastViewport({ bottom = 32, position = 'bottom' }: { bottom?: number; position?: 'top' | 'bottom' }) {
  const ctx = useContext(ToastContext);
  const id = useId();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const register = ctx?.register;
  useEffect(() => register?.(id), [register, id]);
  if (!ctx || ctx.activeViewport !== id || !ctx.current) return null;
  const t = ctx.current;
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.layer, position === 'top' ? styles.layerTop : null]}>
      <Animated.View
        key={t.id}
        entering={reduce ? FadeIn.duration(150) : Platform.OS === 'web' ? FadeInDown.duration(220) : customRise}
        exiting={FadeOut.duration(180)}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={[
          styles.toast,
          position === 'top' ? { marginTop: insets.top + 12 } : { marginBottom: bottom + Math.max(insets.bottom - 24, 0) },
        ]}>
        <View style={[styles.disc, t.tone === 'error' ? { backgroundColor: colors.danger } : null]}>
          {t.icon ??
            (t.tone === 'error' ? <CloseIcon size={14} strokeWidth={3.2} color={colors.card} /> : <CheckIcon size={14} strokeWidth={3.5} color={colors.card} />)}
        </View>
        <Txt variant="label" size={15} weight={600} color={colors.card} numberOfLines={2} style={styles.msg}>
          {t.message}
        </Txt>
      </Animated.View>
    </View>
  );
}

// Rise 16 px + fade in, on a soft spring (motion: "fast in, gentle settle").
function customRise() {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 16 }, { scale: 0.98 }] },
    animations: {
      opacity: withTiming(1, { duration: 180 }),
      transform: [{ translateY: withSpring(0, { damping: 18, stiffness: 220, mass: 1 }) }, { scale: withSpring(1, { damping: 18, stiffness: 220, mass: 1 }) }],
    },
  };
}

const styles = StyleSheet.create({
  layer: { justifyContent: 'flex-end', alignItems: 'center', zIndex: 1000 },
  layerTop: { justifyContent: 'flex-start' },
  toast: {
    minHeight: 48,
    maxWidth: 340,
    paddingLeft: 8,
    paddingRight: 20,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    boxShadow: '0 10px 30px rgba(30,36,16,0.22)',
  },
  disc: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  msg: { flexShrink: 1 },
});
