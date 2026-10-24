// What's new for the person signed in, ready before they tap homie (lib/homie/tap):
//   const news = useHomieNews()   { facts, written }: convex homie.news (live, soft: nothing until it's
//                                 deployed), and Claude's words for each fact, asked of the voice service
//                                 (POST /homie/line) as soon as the fact appears, so a tap only waits for
//                                 /speak. A fact Claude hasn't written yet is said in its plain words.
import { fetch } from 'expo/fetch';
import { useEffect, useState } from 'react';

import { convexSession, useLive } from '@/lib/live/convex';
import { useSession } from '@/lib/session';

import { voiceHttpBase } from './logic';
import type { TapFact } from './tap';

const BASE = voiceHttpBase(process.env.EXPO_PUBLIC_VOICE_URL ?? '');
/** The query's clock, rounded so the subscription changes only this often. */
const CLOCK_MS = 10 * 60_000;
const TIMEOUT_MS = 8000;

const none = (onData: (v: TapFact[]) => void) => {
  onData([]);
  return () => {};
};

// Claude's words per fact id (this run), and the asks on their way.
const written = new Map<string, string>();
const asking = new Set<string>();

async function askLine(fact: TapFact, profileId: string | undefined): Promise<void> {
  if (!BASE || written.has(fact.id) || asking.has(fact.id)) return;
  asking.add(fact.id);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const sessionToken = await convexSession(profileId);
    if (!sessionToken || sessionToken === 'stub') return;
    const res = await fetch(`${BASE}/homie/line`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken, factId: fact.id }),
      signal: abort.signal,
    });
    if (!res.ok) return;
    const body = (await res.json()) as { text?: unknown; written?: unknown };
    if (body.written === true && typeof body.text === 'string' && body.text.trim()) written.set(fact.id, body.text.trim());
  } catch {
    // the plain line still works
  } finally {
    clearTimeout(timer);
    asking.delete(fact.id);
  }
}

export function useHomieNews(): { facts: TapFact[]; written: ReadonlyMap<string, string> } {
  const { me } = useSession();
  const [now, setNow] = useState(() => Math.floor(Date.now() / CLOCK_MS) * CLOCK_MS);
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / CLOCK_MS) * CLOCK_MS), CLOCK_MS);
    return () => clearInterval(t);
  }, []);
  const facts = useLive<TapFact[]>('homie:news', [], none, !!me, { now }, true);
  const meId = me?.id;
  useEffect(() => {
    for (const f of facts) void askLine(f, meId);
  }, [facts, meId]);
  return { facts, written };
}
