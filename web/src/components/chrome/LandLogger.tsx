'use client';
// One event per full page load: which version the visitor landed on and why, or which switch
// button brought them here (src/lib/audience-route.ts logLand). Renders nothing. It sits in the
// Lander's first-screen tree so it hydrates with the page; keep it free of 'motion' (guardrail E1).
import { useEffect } from 'react';
import type { Audience } from '@/content/audience';
import { logLand } from '@/lib/audience-route';

export function LandLogger({ audience }: { audience: Audience }) {
  useEffect(() => {
    logLand(audience);
  }, [audience]);
  return null;
}
