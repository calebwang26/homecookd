// Watch / Hear in a bottom sheet, available anywhere:
//
//   <MediaSheetProvider> ... </MediaSheetProvider>        (root layout)
//   const media = useMediaSheet();
//   media.watch({ recipe, step });                         // a step's range
//   media.watch({ recipe, whole: true });                  // the whole recipe video
//   media.hear({ recipe, step });                          // the step's audio, quote as subtitle
//   media.hear({ recipe, start_s, end_s, quote, title });  // any range (a story)
//
// The sheet: title (step title, Fraunces 24), a line that says what plays ("Step 2 of 6 · Dad",
// "Full video · Dad", "A story · Dad"), then the player. Watch = the clip video sized to the video's
// shape, its controls inside; Hear = the green-tint HearCard. The cook's words (the quote) always show
// under Watch. With no recording, Hear is "Dad's words": the whole quote as text. With no video, a
// warm "Dad hasn't filmed this one yet" (never the word "sample").
// The title and the video stay put; only the words under them scroll (a long quote on a small
// phone), so reading never pushes the playing video away. Drag the grabber down to close.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { BottomSheet, ScrollHold, Txt, useScrollHold } from '@/components/ui';
import { useHeard } from '@/lib/listening';
import { stopAudio } from '@/lib/media';
import type { Recipe, Step } from '@/lib/types';
import { colors, radii } from '@/theme/tokens';

import { ClipVideo } from './ClipVideo';
import { HearCard } from './HearCard';

export type MediaRequest = {
  recipe: Recipe;
  /** Plays this step's [start_s, end_s] with its title and quote. */
  step?: Step | null;
  start_s?: number;
  end_s?: number;
  title?: string;
  /** Shown under the title, e.g. "A story · Dad". Defaults to "Step N of M · Cook" / "Full video · Cook". */
  subtitle?: string;
  quote?: string | null;
  /** Watch only: the full video with native controls. */
  whole?: boolean;
};

type Open = MediaRequest & { mode: 'watch' | 'hear' };

type Ctx = { watch: (r: MediaRequest) => void; hear: (r: MediaRequest) => void; close: () => void };

const MediaContext = createContext<Ctx | null>(null);

export function MediaSheetProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<Open | null>(null);
  const [visible, setVisible] = useState(false);

  const watch = useCallback((r: MediaRequest) => {
    stopAudio();
    setReq({ ...r, mode: 'watch' });
    setVisible(true);
  }, []);
  const hear = useCallback((r: MediaRequest) => {
    setReq({ ...r, mode: 'hear' });
    setVisible(true);
  }, []);
  const close = useCallback(() => {
    stopAudio();
    setVisible(false);
  }, []);

  const value = useMemo(() => ({ watch, hear, close }), [watch, hear, close]);

  return (
    <MediaContext value={value}>
      {children}
      <BottomSheet visible={visible} onClose={close} contentStyle={styles.sheetContent} accessibilityLabel={req ? headingFor(req).title : 'Player'}>
        {req && visible ? <SheetBody req={req} /> : null}
      </BottomSheet>
    </MediaContext>
  );
}

/** `{ watch, hear, close }`. Safe without the provider (no-ops, with a dev warning). */
export function useMediaSheet(): Ctx {
  const ctx = useContext(MediaContext);
  if (ctx) return ctx;
  return {
    watch: () => __DEV__ && console.warn('[media] MediaSheetProvider is not mounted'),
    hear: () => __DEV__ && console.warn('[media] MediaSheetProvider is not mounted'),
    close: () => {},
  };
}

function rangeOf(req: Open): { start: number; end: number | null } {
  const dur = req.recipe.media.duration_s || 0;
  if (req.whole) return { start: 0, end: null };
  const start = Math.max(0, Math.floor(req.start_s ?? req.step?.start_s ?? 0));
  let end = req.end_s ?? req.step?.end_s ?? start + 30;
  if (end <= start) end = start + 30;
  if (dur > 0) end = Math.min(end, dur);
  return { start, end };
}

function headingFor(req: Open): { title: string; subtitle: string } {
  const cook = req.recipe.cook.name;
  const title = req.title ?? (req.whole ? req.recipe.title : req.step?.title) ?? req.recipe.title;
  const who = req.mode === 'hear' ? (req.recipe.media.audio_url ? `${cook}’s voice` : `${cook}’s words`) : cook;
  const scope = req.whole ? (req.mode === 'watch' ? 'Full video' : 'Full recording') : req.step ? `Step ${req.step.order} of ${req.recipe.steps.length}` : 'A clip';
  const subtitle = req.subtitle ?? `${scope} · ${who}`;
  return { title, subtitle };
}

function SheetBody({ req }: { req: Open }) {
  const { title, subtitle } = headingFor(req);
  const { height } = useWindowDimensions();
  const { start, end } = rangeOf(req);
  const r = req.recipe;
  const quote = req.quote !== undefined ? req.quote : req.step?.quote ?? null;
  const aspect = r.media.width && r.media.height ? r.media.width / r.media.height : null;
  // Every Hear (recipe page, cook mode, a step's story) plays here: 3 s or more logs 'heard'.
  const heard = useHeard(r);
  // Dragging the Hear bar holds the words still (ui/ScrollHold).
  const hold = useScrollHold();
  const words = useRef<ScrollView>(null);
  // iOS shows the scroll bar only while scrolling: flash it once, so long words look scrollable.
  useEffect(() => {
    const t = setTimeout(() => words.current?.flashScrollIndicators(), 400);
    return () => clearTimeout(t);
  }, []);

  const scroll = (children: ReactNode) => (
    <ScrollHold value={hold.set}>
      <ScrollView
        ref={words}
        style={styles.words}
        scrollEnabled={!hold.held}
        alwaysBounceVertical={false}
        showsVerticalScrollIndicator>
        {children}
      </ScrollView>
    </ScrollHold>
  );

  return (
    <View style={styles.body}>
      <View style={styles.head}>
        <Txt variant="chatName" numberOfLines={2} accessibilityRole="header">
          {title}
        </Txt>
        <Txt variant="meta">{subtitle}</Txt>
      </View>

      {req.mode === 'watch' ? (
        <>
          {r.media.video_url ? (
            <ClipVideo
              url={r.media.video_url}
              poster={req.step?.image_url ?? r.media.poster_url}
              start_s={start}
              end_s={end}
              whole={req.whole}
              autoPlay
              fitVideo
              showScope={false}
              aspectHint={aspect}
              radius={radii.panel}
              style={{ maxHeight: Math.min(460, height * 0.42) }}
            />
          ) : (
            <NoVideo cook={r.cook.name} />
          )}
          {quote
            ? scroll(
                <View style={styles.quote}>
                  <Txt variant="quote">“{quote.trim()}”</Txt>
                </View>,
              )
            : null}
        </>
      ) : (
        scroll(
          <HearCard
            clip={{ url: r.media.audio_url, start_s: start, end_s: end, heard }}
            quote={quote}
            cookName={r.cook.name}
            autoPlay
          />,
        )
      )}
    </View>
  );
}

function NoVideo({ cook }: { cook: string }) {
  return (
    <View style={styles.noVideo}>
      <Txt variant="section" size={20} align="center">
        {cook} hasn’t filmed this one yet
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  // The sheet stops at 92% of the screen; these let the words give way, not the video.
  sheetContent: { flexShrink: 1 },
  body: { flexShrink: 1, gap: 16, paddingBottom: 8 },
  head: { gap: 4, paddingRight: 48 },
  words: { flexGrow: 0 },
  quote: { backgroundColor: colors.greenTint, borderRadius: radii.quote, padding: 18, gap: 8 },
  noVideo: { backgroundColor: colors.well, borderRadius: radii.panel, paddingVertical: 36, paddingHorizontal: 20, gap: 8, alignItems: 'center' },
});
