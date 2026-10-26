// The line under each face on "Who's in the kitchen?", from real data. Only unread news is green,
// and every green line comes with its unread dot (or the sun "New" badge). A line is about the face
// it sits under and names only the other person (never "you", never "Someone"):
//   cook     an unread question from a learner -> "Leo asked"   (request, step, or words with "?")
//            an unread "I cooked it"           -> "Leo cooked it"
//            any other unread message          -> "New from Dad" / "2 new notes"
//            else                              -> "2 recipes" / "Ready to teach"   (muted)
//   learner  an unread recipe sent to them     -> "Grandma sent a dish"    (sun "New" badge)
//            an unread reply from a cook       -> "Dad answered"
//            any other unread message          -> "New from Leo" / "2 new notes"
//            else                              -> relation / "All caught up" / "New here"   (muted)
//   anyone invited who hasn't joined yet      -> "Hasn't joined yet"   (muted; known from GET
//                                                /family, so it shows at once, before any messages
//                                                load; someone who already wrote here isn't)
//   anyone on their own phone (locked)        -> "On their phone"   (muted; GET /family too)
// The family circle counts like any thread, with the circle's last sender as "who" (its `other` is
// a stand-in, never a person).
// Threads are read per profile (GET /threads as that profile) and polled while the screen is open,
// never for someone only invited (they have nothing to read yet, and calls made as them would make
// an older family-code phone count as theirs on the server) and never for someone locked to their
// own phone (the server refuses anything done as them here, reads too, so their messages stay theirs).
// The last answer is kept in memory so coming back to this screen never flickers, and the lines are
// saved on the device so a cold start shows them straight away (then refreshes them).
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api, type Message, type Profile, type ThreadSummary } from '@/lib/api';
import { usePolling } from '@/lib/messaging';
import { recipesByCook, useLibrary } from '@/lib/recipes';
import { kvGetJson, kvSetJson } from '@/lib/storage';
import { english, type T, type WordKey } from '@/lib/words/words';

export type PersonMark = 'dot' | 'new' | null;
export type PersonStatus = { line: string; strong: boolean; mark: PersonMark };

const POLL_MS = 15_000;
/** Longest name that still fits "New from <Name>" on a 106 px tile at 13/700. */
const SHORT_NAME = 7;

type ThreadMap = Record<string, ThreadSummary[] | null>; // null = could not load

const invitedStatus = (t: T): PersonStatus => ({ line: t('profiles.status.invited'), strong: false, mark: null });
const lockedStatus = (t: T): PersonStatus => ({ line: t('profiles.status.locked'), strong: false, mark: null });

/** "1 recipe" / "3 recipes": the one or many word, with its count. */
const counted = (t: T, n: number, one: WordKey, many: WordKey) => t(n === 1 ? one : many, { count: n });

/** Whose messages this phone may read: not someone only invited, not someone on their own phone. */
const readable = (p: Profile) => !p.invited && !p.locked;

const EMPTY: ThreadMap = {};
let cache: { familyKey: string; threads: ThreadMap } | null = null;
const storeKey = (familyKey: string) => `profileLines:${familyKey}`;


/** A learner's message that asks something: a question, request, step question, or words with a "?". */
function isQuestion(m: Message): boolean {
  if (m.kind === 'question' || m.kind === 'request' || m.kind === 'step') return true;
  if (m.kind === 'text' || m.kind === 'voice') return /\?/.test(`${m.body ?? ''} ${m.transcript ?? ''}`);
  return false;
}

/** Who wrote a thread's last message, when it was someone other than `me` (circle: any member). */
function lastSender(t: ThreadSummary, me: Profile): Profile | null {
  const id = t.last?.sender_id;
  // A system note ("Sam signed in on a new phone") is nobody writing; a heart is a stamp, not news
  // (the server never makes one `last`; this is the guard).
  if (!id || id === me.id || t.last?.kind === 'system' || t.last?.kind === 'reaction') return null;
  if (t.kind === 'circle') return t.members?.find((m) => m.id === id) ?? null;
  return t.other.id === id ? t.other : null;
}

/** A name for a short line: the last sender, else the other person; null when we can't say who. */
function whoIn(t: ThreadSummary, me: Profile): string | null {
  return lastSender(t, me)?.name ?? (t.kind === 'circle' ? null : t.other.name);
}

const short = (name: string | null): name is string => !!name && name.trim().length <= SHORT_NAME;

function cookStatus(p: Profile, threads: ThreadSummary[], recipeCount: number, t: T = english): PersonStatus {
  // Only news that is still unread gets the green line, and every green line has its dot.
  const unread = threads.filter((th) => th.unread > 0);
  const fromLearner = unread.filter((th) => lastSender(th, p)?.role === 'learner');
  const asking = fromLearner.filter((th) => isQuestion(th.last!));
  const cooked = fromLearner.filter((th) => th.last!.kind === 'cooked');
  if (asking.length === 1) {
    const who = whoIn(asking[0], p);
    return { line: short(who) ? t('profiles.status.asked', { name: who }) : t('profiles.status.newQuestion'), strong: true, mark: 'dot' };
  }
  if (asking.length > 1) return { line: t('profiles.status.peopleAsked', { count: asking.length }), strong: true, mark: 'dot' };
  if (cooked.length === 1) {
    const who = whoIn(cooked[0], p);
    return { line: short(who) ? t('profiles.status.cooked', { name: who }) : t('profiles.status.dishMade'), strong: true, mark: 'dot' };
  }
  if (unread.length) {
    const who = whoIn(unread[0], p);
    return {
      line: unread.length === 1 && short(who) ? t('profiles.status.newFrom', { name: who }) : counted(t, unread.length, 'profiles.status.newNoteOne', 'profiles.status.newNoteMany'),
      strong: true,
      mark: 'dot',
    };
  }
  if (recipeCount > 0) return { line: counted(t, recipeCount, 'profiles.status.recipeOne', 'profiles.status.recipeMany'), strong: false, mark: null };
  return { line: t('profiles.status.readyToTeach'), strong: false, mark: null };
}

function learnerStatus(p: Profile, threads: ThreadSummary[], t: T = english): PersonStatus {
  const waiting = threads.filter((th) => th.unread > 0);
  const recipe = waiting.find((th) => th.last?.kind === 'recipe' && th.last.sender_id !== p.id);
  if (recipe) {
    const who = whoIn(recipe, p);
    return { line: short(who) ? t('profiles.status.sentDish', { name: who }) : t('profiles.status.newDish'), strong: true, mark: 'new' };
  }
  // "answered" only when a cook wrote back; anything else is just a note.
  const answered = (th: ThreadSummary) => lastSender(th, p)?.role === 'cook';
  if (waiting.length === 1) {
    const th = waiting[0];
    const who = whoIn(th, p);
    if (answered(th)) return { line: short(who) ? t('profiles.status.answered', { name: who }) : t('profiles.status.newAnswer'), strong: true, mark: 'dot' };
    return { line: short(who) ? t('profiles.status.newFrom', { name: who }) : t('profiles.status.newNote'), strong: true, mark: 'dot' };
  }
  if (waiting.length > 1) {
    const line = waiting.every(answered)
      ? t('profiles.status.newAnswers', { count: waiting.length })
      : counted(t, waiting.length, 'profiles.status.newNoteOne', 'profiles.status.newNoteMany');
    return { line, strong: true, mark: 'dot' };
  }
  if (p.relation?.trim()) return { line: p.relation.trim(), strong: false, mark: null };
  if (threads.length) return { line: t('profiles.status.caughtUp'), strong: false, mark: null };
  return { line: t('profiles.status.newHere'), strong: false, mark: null };
}

/** Without their messages: recipes or relation only (never "nothing new", which we can't know). */
function quietStatus(p: Profile, recipeCount: number, t: T = english): PersonStatus {
  if (p.role === 'cook' && recipeCount > 0) return { line: counted(t, recipeCount, 'profiles.status.recipeOne', 'profiles.status.recipeMany'), strong: false, mark: null };
  return { line: p.relation?.trim() || (p.role === 'cook' ? t('profiles.status.cook') : t('profiles.status.learning')), strong: false, mark: null };
}

/**
 * Status line per profile id. `undefined` for a profile means "still loading" (render a quiet
 * placeholder, never a guess that would flip a moment later). `t`: the lines in the phone's words.
 */
export function useFamilyStatus(profiles: Profile[], familyKey: string | null, t: T = english): Record<string, PersonStatus | undefined> {
  const focused = useIsFocused();
  const { entries } = useLibrary();
  const key = familyKey ?? '';
  // Threads are tagged with their family, so a different family never shows the old one's lines.
  const [state, setState] = useState<{ key: string; map: ThreadMap }>(() => ({
    key,
    map: cache && cache.familyKey === key ? cache.threads : {},
  }));
  const threads: ThreadMap = state.key === key ? state.map : cache && cache.familyKey === key ? cache.threads : EMPTY;
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  const ids = profiles
    .filter(readable)
    .map((p) => p.id)
    .join(',');
  const load = useCallback(async () => {
    if (!ids || !key) return;
    const list = ids.split(',');
    const results = await Promise.all(
      list.map((id) =>
        api
          .threads({ profileId: id })
          .then((t) => [id, t] as const)
          .catch(() => [id, null] as const),
      ),
    );
    if (keyRef.current !== key) return; // switched family while this was in flight
    setState((prev) => {
      const next: ThreadMap = { ...(prev.key === key ? prev.map : {}) };
      for (const [id, t] of results) {
        // Keep the last good answer through a failed poll.
        if (t || !(id in next)) next[id] = t;
      }
      cache = { familyKey: key, threads: next };
      return { key, map: next };
    });
  }, [ids, key]);

  const enabled = focused && !!ids && !!familyKey;
  usePolling(load, POLL_MS, enabled);

  // New faces (someone added here or on another device) or a new family: fetch now, not at the
  // next tick. The first run is the poll's own first tick.
  const firstLoad = useRef(true);
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    if (enabled) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // Last launch's lines, shown until the first poll answers.
  const [saved, setSaved] = useState<{ key: string; lines: Record<string, PersonStatus> } | null>(null);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    kvGetJson<Record<string, PersonStatus>>(storeKey(key)).then((lines) => {
      if (alive && lines) setSaved({ key, lines });
    });
    return () => {
      alive = false;
    };
  }, [key]);

  const lines = useMemo(() => {
    const out: Record<string, PersonStatus | undefined> = {};
    const savedLine = (id: string) => (saved?.key === key ? saved.lines[id] : undefined);
    for (const p of profiles) {
      if (p.invited) {
        out[p.id] = invitedStatus(t);
        continue;
      }
      if (p.locked) {
        out[p.id] = lockedStatus(t);
        continue;
      }
      const th = threads[p.id];
      if (th === undefined) {
        // Not read yet: last launch's line, else a quiet placeholder (never a guess).
        out[p.id] = savedLine(p.id);
        continue;
      }
      if (th === null) {
        // Their messages couldn't be read: last known line, else only what we know for sure.
        out[p.id] = savedLine(p.id) ?? quietStatus(p, recipesByCook(entries, p.name).length, t);
        continue;
      }
      out[p.id] = p.role === 'cook' ? cookStatus(p, th, recipesByCook(entries, p.name).length, t) : learnerStatus(p, th, t);
    }
    return out;
  }, [profiles, threads, entries, saved, key, t]);

  const allRead = profiles.length > 0 && profiles.every((p) => !readable(p) || !!threads[p.id]);
  useEffect(() => {
    if (key && allRead) void kvSetJson(storeKey(key), lines);
  }, [key, allRead, lines]);

  return lines;
}
