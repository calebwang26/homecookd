// Share a recipe from anywhere:
//   <ShareSheetProvider> ... </ShareSheetProvider>      (root layout)
//   const share = useShare(); share.open({ recipeId: recipe.id });
// The provider renders the one ShareSheet (components/share/ShareSheet.tsx) above everything.
// Web dev aid (like `?as=`): `?share=<recipe id>` opens the sheet on load, for headless screenshots.
//
// iOS safety: the sheet is a native Modal, so `open` waits two frames (the tap's press-out and any
// screen transition settle first) and repeated taps while it is opening or open do nothing. If the
// Modal has not reported itself shown within PRESENT_TIMEOUT_MS (UIKit can refuse a presentation
// silently), the sheet is marked closed so the next tap works. A render error anywhere in the sheet
// is caught here (the app stays up; the next open starts clean).
import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { ShareSheet } from '@/components/share/ShareSheet';
import { useToast } from '@/components/ui';
import { trail, trailStart } from '@/components/share/trail';

type ShareCtx = {
  open: (input: { recipeId: string }) => void;
  close: () => void;
  /** The recipe being shared while the sheet is open. */
  recipeId: string | null;
  visible: boolean;
};

const Ctx = createContext<ShareCtx | null>(null);

// The sheet may first wait up to ~660 ms for another sheet's Modal to go (BottomSheet).
const PRESENT_TIMEOUT_MS = 1200;

/** Two animation frames (falls back to a timer where rAF is missing). */
function afterFrames(fn: () => void): () => void {
  let cancelled = false;
  let a = 0;
  let b = 0;
  const raf: (cb: () => void) => number =
    typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(cb) : (cb) => setTimeout(cb, 16) as unknown as number;
  const caf: (id: number) => void =
    typeof cancelAnimationFrame === 'function' ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id);
  a = raf(() => {
    b = raf(() => {
      if (!cancelled) fn();
    });
  });
  return () => {
    cancelled = true;
    caf(a);
    caf(b);
  };
}

export function ShareSheetProvider({ children }: { children: ReactNode }) {
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  // Bumped after a caught crash so the next open mounts a brand-new sheet.
  const [generation, setGeneration] = useState(0);
  const pending = useRef<(() => void) | null>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleRef = useRef(false);
  const toast = useToast();

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);
  const clearWatchdog = useCallback(() => {
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = null;
  }, []);
  useEffect(
    () => () => {
      pending.current?.();
      clearWatchdog();
    },
    [clearWatchdog],
  );

  const open = useCallback((input: { recipeId: string }) => {
    const id = input?.recipeId?.trim();
    if (!id) return;
    if (visibleRef.current || pending.current) {
      trail('open ignored: sheet already opening or open');
      return;
    }
    trailStart(`open requested for ${id}`);
    pending.current = afterFrames(() => {
      pending.current = null;
      trail('presenting');
      setRecipeId(id);
      setVisible(true);
      clearWatchdog();
      watchdog.current = setTimeout(() => {
        watchdog.current = null;
        trail('present timed out');
        setVisible(false);
      }, PRESENT_TIMEOUT_MS);
    });
  }, [clearWatchdog]);
  const shown = useCallback(() => {
    if (watchdog.current) trail('presented');
    clearWatchdog();
  }, [clearWatchdog]);
  // Keep recipeId while the sheet animates out; it is replaced on the next open.
  const close = useCallback(() => {
    pending.current?.();
    pending.current = null;
    clearWatchdog();
    trail('close');
    setVisible(false);
  }, [clearWatchdog]);

  const crashed = useCallback(() => {
    pending.current?.();
    pending.current = null;
    clearWatchdog();
    setVisible(false);
    setGeneration((g) => g + 1);
    toast.show('Sharing didn’t open. Try again.', { tone: 'error' });
  }, [toast, clearWatchdog]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let id: string | null = null;
    try {
      id = new URLSearchParams(globalThis.location?.search ?? '').get('share');
    } catch {}
    if (!id?.trim()) return;
    const t = setTimeout(() => open({ recipeId: id.trim() }), 600);
    return () => clearTimeout(t);
  }, [open]);

  const value = useMemo(() => ({ open, close, recipeId, visible }), [open, close, recipeId, visible]);
  return (
    <Ctx value={value}>
      {children}
      <SheetGuard key={generation} onCrash={crashed}>
        <ShareSheet visible={visible} recipeId={recipeId} onClose={close} onShown={shown} />
      </SheetGuard>
    </Ctx>
  );
}

/** Keeps a sheet error from taking the whole app down; it renders nothing until the next open. */
class SheetGuard extends Component<{ children: ReactNode; onCrash: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    trail('share sheet crashed (caught)', error);
    this.props.onCrash();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const fallback: ShareCtx = {
  open: () => __DEV__ && console.warn('[share] ShareSheetProvider is not mounted'),
  close: () => {},
  recipeId: null,
  visible: false,
};

export function useShare(): ShareCtx {
  return useContext(Ctx) ?? fallback;
}
