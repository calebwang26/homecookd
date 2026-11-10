'use client';
// isAndroid() for anything drawn on the server too: the pages are prerendered, where there's no phone to ask. The
// server's answer is false, and React swaps in the phone's own answer right after hydration (no mismatch). Something
// drawn only after a tap can call isAndroid() directly.
import { useSyncExternalStore } from 'react';
import { isAndroid } from './app-links';

const never = () => () => {};

export function useAndroid(): boolean {
  return useSyncExternalStore(never, isAndroid, () => false);
}
