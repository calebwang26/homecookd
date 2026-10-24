// Month in the kitchen, the screen body (RETENTION-HANDOFF 3.7), rendered by the modal route
// app/src/app/recap.tsx (registered in _layout.tsx's AppStack as a fullScreenModal). The Home card and
// the 1st-of-month push both open /recap?month=YYYY-MM.
//
// It loads GET /recap for the person this phone acts as, marks the month opened (the Home card goes
// away), names people from the session, finds dish posters in the library, and wires the "voices"
// slide to the shared player with the cook's exact words (lib/missHome's clip pool: a family cook's
// real recording only, and only this family's own recordings: GET /table's `recordings`, the same
// scope as "I miss home", so another family's same-named cook never plays here). The clip never
// plays by itself, pauses when the person moves off that slide, and carries the `heard` tag (lib/
// listening.ts), so a listen here counts toward next month's minutes of family voices. With no
// person picked yet it says "Pick who you are first" (never an endless spinner); a failed load
// (offline, or the server's 503 while the library is down) offers Try again and leaves the month
// unopened. Share comes from the route (`shareSlide`: react-native-view-shot + expo-sharing).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CloseIcon, EmptyState, IconButton } from '@/components/ui';
import { useHeard } from '@/lib/listening';
import { useClipAudio } from '@/lib/media';
import { clipPool } from '@/lib/missHome';
import { isEmptyRecap, markRecapOpened, monthName, monthOrPrevious, recapApi, type RecapResult, type RecapSlide } from '@/lib/recapApi';
import { useLibrary, useRecipes } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import { familyRecordings } from '@/lib/sundayTable';
import { useTable } from '@/lib/tableApi';
import { colors, space } from '@/theme/tokens';

import { RecapStory, type RecapDish, type RecapPerson, type RecapVoice } from './RecapStory';
import { findVoiceClip, SLIDE_TONES } from './story';

/** The last answer, for the request it answered (another key = still loading). */
type Load = { key: string } & ({ status: 'ready'; recap: RecapResult } | { status: 'error' });

export type RecapScreenProps = {
  /** The route's ?month= (YYYY-MM); missing or malformed = last month. */
  month?: string | string[] | null;
  onClose: () => void;
  /** See RecapStory: renders a slide to an image & opens the share sheet. Hidden on web regardless. */
  shareSlide?: (view: View, slide: RecapSlide) => Promise<void>;
  /** Tests & screenshots: the clock and the loader. */
  now?: Date;
  load?: (month: string) => Promise<RecapResult>;
};

export function RecapScreen({ month: param, onClose, shareSlide, now, load = recapApi.get }: RecapScreenProps) {
  const { me, status, profiles, profileById } = useSession();
  const month = monthOrPrevious(Array.isArray(param) ? param[0] : param, now ?? new Date());
  const [answer, setAnswer] = useState<Load | null>(null);
  const [attempt, setAttempt] = useState(0);
  const meId = me?.id ?? null;
  const key = `${meId}|${month}|${attempt}`;

  useEffect(() => {
    if (!meId) return;
    let alive = true;
    load(month)
      .then((recap) => {
        if (!alive) return;
        setAnswer({ key, status: 'ready', recap });
        if (!isEmptyRecap(recap)) void markRecapOpened(meId, month);
      })
      .catch(() => {
        if (alive) setAnswer({ key, status: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [key, meId, month, load]);

  const state = answer?.key === key ? answer : null;
  const recap = state?.status === 'ready' && !isEmptyRecap(state.recap) ? state.recap : null;

  // People & dishes for the slides.
  const person = useCallback((id: string): RecapPerson | null => profileById(id), [profileById]);
  const { entries } = useLibrary();
  const posters = useMemo(() => new Map(entries.map((e) => [e.id, { title: e.title, poster_url: e.poster_url }])), [entries]);
  const dish = useCallback((id: string): RecapDish | null => posters.get(id) ?? null, [posters]);

  // The most-played clip, with her words, on the shared player: only from this family's own
  // recordings (GET /table's list; none known yet = no play button, the number still shows).
  const clip = recap?.slides.find((s): s is Extract<RecapSlide, { type: 'voices' }> => s.type === 'voices')?.clip ?? null;
  const { table } = useTable({ enabled: !!clip });
  const own = useMemo(() => familyRecordings(table), [table]);
  const clipRecipes = useRecipes(clip ? [clip.recipe_id] : []);
  const moment = useMemo(
    () => (clip ? findVoiceClip(clipPool(Object.values(clipRecipes), profiles, meId, own), clip) : null),
    [clip, clipRecipes, profiles, meId, own],
  );
  const heard = useHeard(moment ? clipRecipes[moment.recipeId] : null);
  const hear = useClipAudio(
    moment ? { url: moment.url, start_s: moment.start_s, end_s: moment.end_s, key: `recap:${moment.key}`, heard } : null,
  );
  const voice: RecapVoice | null = moment
    ? {
        cookName: moment.cookName,
        words: moment.words,
        playing: hear.playing,
        loading: hear.phase === 'loading',
        progress: hear.progress,
        durationS: moment.end_s - moment.start_s,
        toggle: hear.toggle,
      }
    : null;

  // Moving off the "voices" slide pauses the clip: its Pause button is gone with the slide.
  const pauseClip = hear.pause;
  const onIndexChange = useCallback(
    (_index: number, slide: RecapSlide) => {
      if (slide.type !== 'voices') pauseClip();
    },
    [pauseClip],
  );

  if (recap) {
    return (
      <RecapStory recap={recap} person={person} dish={dish} voice={voice} onClose={onClose} shareSlide={shareSlide} onIndexChange={onIndexChange} />
    );
  }
  return (
    <Waiting
      state={
        // No person on this phone yet (e.g. a push tapped on "Who's in the kitchen?"): nothing to load.
        !meId ? (status === 'loading' ? 'loading' : 'noone') : !state ? 'loading' : state.status === 'ready' ? 'empty' : 'error'
      }
      month={month}
      onClose={onClose}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  );
}

type WaitingState = 'loading' | 'noone' | 'empty' | 'error';

/** Loading (on the cover's colour), no person yet, an empty month, or a failed load: always with a way out. */
function Waiting({ state, month, onClose, onRetry }: { state: WaitingState; month: string; onClose: () => void; onRetry: () => void }) {
  const insets = useSafeAreaInsets();
  const tone = SLIDE_TONES.cover;
  const loading = state === 'loading';
  return (
    <View style={[styles.screen, { backgroundColor: loading ? tone.bg : colors.page, paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.lg }]}>
      <View style={styles.top}>
        <IconButton
          tone={loading ? 'glassDark' : 'cream'}
          accessibilityLabel="Close"
          haptic
          onPress={onClose}
          icon={(c) => <CloseIcon size={22} color={c} />}
        />
      </View>
      <View style={styles.middle}>
        {loading ? (
          <ActivityIndicator color={tone.fg} size="large" accessibilityLabel="Loading your month" />
        ) : state === 'noone' ? (
          <EmptyState title="Pick who you are first" body="Then your month will be here." actionLabel="Done" onAction={onClose} />
        ) : state === 'empty' ? (
          // A month that's over: quiet and timeless, never "yet" (nothing more is coming) or a guilt word.
          <EmptyState title={`A quiet ${monthName(month) || 'month'} in the kitchen`} actionLabel="Done" onAction={onClose} />
        ) : (
          <EmptyState
            title="Couldn’t load your month"
            body="Check your connection and try again."
            actionLabel="Try again"
            onAction={onRetry}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: space.gutter },
  top: { alignItems: 'flex-end' },
  middle: { flex: 1, justifyContent: 'center' },
});
