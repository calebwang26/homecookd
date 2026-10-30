// Month in the kitchen: the full-screen story (RETENTION-HANDOFF 3.7). Thin progress bars on top, one
// slide per screen in a Hearth colour, Fraunces titles whose numbers carry the slide's accent, and the
// app's own step controls at the bottom (round Back, a big Next; Done on the last slide), like cook
// mode. Taps work the stories way too: the left third goes back, anywhere else forward. No timer: each
// slide stays until the person moves on (older cooks read at their own pace).
//
// Presentational: the screen (RecapScreen) hands in the recap, how to name & draw people and dishes,
// the most-played clip already wired to the shared player, and the callbacks. One component per slide
// type, matching supabase/functions/api/recap.ts.
//
// Share: `shareSlide(view, slide)` renders the slide (its colour, photos, numbers and the homecookd
// mark at its foot) to an image and opens the share sheet (the route passes react-native-view-shot's
// captureRef + expo-sharing). Without `shareSlide`, and always on web (html2canvas can't read the
// signed photo URLs and expo-sharing can't share files there), there is no Share button. Share waits
// for the slide's photos to load, so the image is never half drawn.
//
// Guardrails: the cook's voice never plays by itself (the "voices" slide has a play button); her words
// show exactly as said; nothing here is in her voice; no guilt words; no gendered pronouns.
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, useWindowDimensions, View, type GestureResponderEvent } from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ActionButton,
  ArrowRightIcon,
  Avatar,
  BackIcon,
  Brand,
  CloseIcon,
  haptic,
  HeartIcon,
  IconButton,
  MessageIcon,
  PauseIcon,
  PlayIcon,
  EggMascot,
  ShareIcon,
  SpoonIcon,
  ToastViewport,
  Txt,
  useToast,
  Waveform,
} from '@/components/ui';
import { mmss } from '@/lib/format';
import type { Recap, RecapFace, RecapPhoto, RecapSlide } from '@/lib/recapApi';
import { alpha, colors, radii, space } from '@/theme/tokens';

import { barFilled, heartsShown, oneBigHeart, photosShown, SLIDE_TONES, stepStory, tapDirection, tiltOf, titleParts, type SlideTone } from './story';

export type RecapPerson = { id: string; name: string; avatar_key?: string | null };
export type RecapDish = { title: string; poster_url?: string | null };

/** The month's most-played clip, found & wired to the shared player by the screen. */
export type RecapVoice = {
  cookName: string;
  /** Exactly what the cook said in that moment. */
  words: string;
  playing: boolean;
  loading: boolean;
  /** 0..1 through the clip. */
  progress: number;
  /** The clip's length, for "Hear Mom · 0:24". */
  durationS?: number | null;
  toggle: () => void;
};

export type RecapStoryProps = {
  recap: Recap;
  /** A family member by id (faces, the cook of the most-made dish), or null. */
  person: (id: string) => RecapPerson | null;
  /** A dish's poster, when the library has one. */
  dish?: (recipeId: string) => RecapDish | null;
  /** The "voices" slide's play button; null or missing = the slide shows the number alone. */
  voice?: RecapVoice | null;
  onClose: () => void;
  /** Image + share sheet for one slide (see the header). Missing, or on web: no Share button. */
  shareSlide?: (view: View, slide: RecapSlide) => Promise<void>;
  initialIndex?: number;
  onIndexChange?: (index: number, slide: RecapSlide) => void;
};

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (at: string) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : `${MON[d.getMonth()]} ${d.getDate()}`;
};
/** How many images a slide draws (Share waits for them). */
function imagesIn(slide: RecapSlide, dish: RecapStoryProps['dish']): number {
  switch (slide.type) {
    case 'cooked':
    case 'postcards':
      return photosShown(slide.photos).length;
    case 'then_now':
      return 2;
    case 'most_made':
    case 'most_loved':
      return dish?.(slide.recipe_id)?.poster_url ? 1 : 0;
    default:
      return 0;
  }
}

export function RecapStory({ recap, person, dish, voice, onClose, shareSlide, initialIndex = 0, onIndexChange }: RecapStoryProps) {
  const slides = recap.slides;
  const count = slides.length;
  // The slide on screen, and which of its images have settled (loaded or failed), by photo id or
  // poster URL. Moving to a slide starts it over with none, also when going back to one seen before:
  // its images mount again, so Share waits for them again.
  const [pos, setPos] = useState<{ index: number; settled: ReadonlySet<string> }>(() => ({
    index: Math.min(Math.max(0, initialIndex), Math.max(0, count - 1)),
    settled: new Set(),
  }));
  const index = pos.index;
  const slide = slides[index];
  const tone = SLIDE_TONES[slide.type];
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduce = useReducedMotion();
  const toast = useToast();
  const slideRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);

  // Share waits until every image on this slide has settled. A late onLoad from a slide that is fading
  // out (its `at` is no longer the slide on screen) is ignored, and each image counts once.
  const settle = useCallback(
    (at: number, key: string) =>
      setPos((p) => (p.index !== at || p.settled.has(key) ? p : { index: at, settled: new Set(p.settled).add(key) })),
    [],
  );
  const expected = imagesIn(slide, dish);
  const imagesReady = expected === 0 || pos.settled.size >= expected;

  useEffect(() => {
    onIndexChange?.(index, slides[index]);
  }, [index, slides, onIndexChange]);

  const go = useCallback(
    (dir: 1 | -1) => {
      const next = stepStory(index, count, dir);
      if (next.done) {
        onClose();
        return;
      }
      if (next.index !== index) {
        // The one haptic for Next, Back and the tap zones (the buttons pass none of their own).
        haptic('selection');
        setPos({ index: next.index, settled: new Set() });
      }
    },
    [index, count, onClose],
  );

  const onStagePress = (e: GestureResponderEvent) => go(tapDirection(e.nativeEvent.pageX, width));

  const canShare = !!shareSlide && Platform.OS !== 'web';
  async function share() {
    const view = slideRef.current;
    if (!view || !shareSlide || sharing) return;
    haptic('light');
    setSharing(true);
    try {
      await shareSlide(view, slide);
    } catch {
      haptic('error');
      toast.show('Couldn’t share that one. Try again.', { tone: 'error' });
    } finally {
      setSharing(false);
    }
  }

  // Gentle crossfades; under Reduce Motion, a quicker plain fade (no movement anywhere).
  const fadeMs = reduce ? 150 : 260;
  const enter = FadeIn.duration(fadeMs).reduceMotion(ReduceMotion.Never);
  const exit = FadeOut.duration(fadeMs).reduceMotion(ReduceMotion.Never);
  const last = index === count - 1;

  return (
    <View style={[styles.screen, { backgroundColor: tone.bg }]}>
      <Animated.View key={`bg-${index}`} entering={enter} exiting={exit} style={[StyleSheet.absoluteFill, { backgroundColor: tone.bg }]} />

      <View style={[styles.top, { paddingTop: insets.top + space.md }]}>
        <View style={styles.bars} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {slides.map((s, i) => (
            <View key={`${s.type}-${i}`} style={[styles.bar, { backgroundColor: barFilled(i, index) ? tone.barOn : tone.barOff }]} />
          ))}
        </View>
        <View style={styles.topRow}>
          <Txt variant="label" color={tone.soft} accessibilityLabel={`Slide ${index + 1} of ${count}`}>
            {`${index + 1} of ${count}`}
          </Txt>
          <View style={styles.topActions}>
            {canShare ? (
              <IconButton
                tone={tone.dark ? 'glassDark' : 'cream'}
                accessibilityLabel="Share this slide"
                disabled={!imagesReady || sharing}
                onPress={() => void share()}
                icon={(c) => (sharing ? <ActivityIndicator color={c} /> : <ShareIcon size={22} color={c} />)}
              />
            ) : null}
            <IconButton
              tone={tone.dark ? 'glassDark' : 'cream'}
              accessibilityLabel="Close"
              haptic
              onPress={onClose}
              icon={(c) => <CloseIcon size={22} color={c} />}
            />
          </View>
        </View>
      </View>

      <Pressable style={styles.stage} onPress={onStagePress} accessible={false}>
        <Animated.View key={`slide-${index}`} entering={enter} exiting={exit} style={StyleSheet.absoluteFill}>
          {/* What Share captures: the slide on its colour, with the homecookd mark. Opaque & not collapsed. */}
          <View ref={slideRef} collapsable={false} style={[styles.capture, { backgroundColor: tone.bg }]}>
            <View style={styles.body}>
              <SlideBody slide={slide} tone={tone} person={person} dish={dish} voice={voice} onImage={(key) => settle(index, key)} />
            </View>
            <Brand size={16} reversed={tone.dark} style={styles.mark} />
          </View>
        </Animated.View>
      </Pressable>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
        {index > 0 ? (
          <IconButton
            tone={tone.dark ? 'glassDark' : 'cream'}
            size={60}
            accessibilityLabel="Back"
            onPress={() => go(-1)}
            icon={(c) => <BackIcon size={24} color={c} />}
          />
        ) : null}
        <ActionButton
          label={last ? 'Done' : 'Next'}
          variant={tone.dark ? 'cream' : 'primary'}
          iconRight={last ? undefined : <ArrowRightIcon size={22} color={tone.dark ? colors.ink : colors.card} />}
          onPress={() => go(1)}
          haptics={false}
          style={styles.next}
          accessibilityHint={last ? 'Closes your month' : 'Shows the next moment'}
        />
      </View>

      <ToastViewport position="top" />
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// Slides

type BodyProps = {
  slide: RecapSlide;
  tone: SlideTone;
  person: RecapStoryProps['person'];
  dish: RecapStoryProps['dish'];
  voice: RecapStoryProps['voice'];
  /** An image settled (loaded or failed): its photo id, or the poster's URL. */
  onImage: (key: string) => void;
};

function SlideBody({ slide, tone, person, dish, voice, onImage }: BodyProps) {
  switch (slide.type) {
    case 'cover':
      return <CoverSlide title={slide.title} tone={tone} />;
    case 'cooked':
      return <PhotosSlide title={slide.title} tone={tone} photos={slide.photos} onImage={onImage} empty={<SpoonIcon size={56} color={tone.accent} />} />;
    case 'most_made':
      return <DishSlide title={slide.title} tone={tone} poster={dish?.(slide.recipe_id)?.poster_url ?? null} cook={person(slide.cook_id)} onImage={onImage} />;
    case 'voices':
      return <VoicesSlide title={slide.title} tone={tone} voice={voice ?? null} seed={`${slide.clip.recipe_id}#${slide.clip.start_s ?? ''}`} />;
    case 'hearts_left':
      return <HeartsSlide title={slide.title} tone={tone} count={slide.value} />;
    case 'then_now':
      return <ThenNowSlide title={slide.title} tone={tone} photos={slide.photos} onImage={onImage} />;
    case 'dishes_cooked':
      return <FacesSlide title={slide.title} tone={tone} faces={slide.faces} person={person} />;
    case 'most_loved':
      return <DishSlide title={slide.title} tone={tone} poster={dish?.(slide.recipe_id)?.poster_url ?? null} cook={null} heart onImage={onImage} />;
    case 'postcards':
      return <PhotosSlide title={slide.title} tone={tone} photos={slide.photos} onImage={onImage} empty={<EggMascot mood="sleepy" size={64} />} />;
    case 'answered':
      return <IconSlide title={slide.title} tone={tone} icon={<MessageIcon size={52} color={tone.accent} />} />;
    case 'close':
      // TODO(caleb) #4: the cookbook offer goes here once printing exists.
      return <CoverSlide title={slide.title} tone={tone} closing />;
  }
}

/** The slide's title in Fraunces, its numbers in the slide's accent. */
function Headline({ title, tone, size = 36 }: { title: string; tone: SlideTone; size?: number }) {
  return (
    <Txt variant="display" size={size} leading={1.12} color={tone.fg} accessibilityRole="header">
      {titleParts(title).map((p, i) =>
        p.accent ? (
          <Txt key={i} variant="display" size={size} leading={1.12} color={tone.accent}>
            {p.text}
          </Txt>
        ) : (
          p.text
        ),
      )}
    </Txt>
  );
}

function CoverSlide({ title, tone, closing }: { title: string; tone: SlideTone; closing?: boolean }) {
  return (
    <View style={styles.center}>
      <View style={[styles.disc, { backgroundColor: colors.card }]}>
        <EggMascot mood={closing ? 'made-it' : 'hello'} size={64} />
      </View>
      <Headline title={title} tone={tone} size={closing ? 34 : 40} />
    </View>
  );
}

function IconSlide({ title, tone, icon }: { title: string; tone: SlideTone; icon: React.ReactNode }) {
  return (
    <View style={styles.center}>
      <View style={[styles.disc, { backgroundColor: alpha.glassButton }]}>{icon}</View>
      <Headline title={title} tone={tone} />
    </View>
  );
}

function Photo({ photo, style, onImage, tilt = 0 }: { photo: RecapPhoto; style: object; onImage: (key: string) => void; tilt?: number }) {
  const onSettled = () => onImage(photo.message_id);
  return (
    <View style={[styles.photoFrame, style, tilt ? { transform: [{ rotate: `${tilt}deg` }] } : null]}>
      <Image
        source={{ uri: photo.photo_url }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={150}
        onLoad={onSettled}
        onError={onSettled}
        accessibilityLabel="A photo of the dish"
      />
    </View>
  );
}

function PhotosSlide({ title, tone, photos, onImage, empty }: { title: string; tone: SlideTone; photos: RecapPhoto[]; onImage: (key: string) => void; empty: React.ReactNode }) {
  const shown = photosShown(photos);
  return (
    <View style={styles.stack}>
      <Headline title={title} tone={tone} />
      {shown.length ? (
        <View style={styles.grid}>
          {shown.map((p, i) => (
            <Photo
              key={p.message_id}
              photo={p}
              onImage={onImage}
              tilt={tiltOf(i, shown.length)}
              style={shown.length === 1 ? styles.photoOne : styles.photoGrid}
            />
          ))}
        </View>
      ) : (
        <View style={[styles.disc, styles.discLeft, { backgroundColor: alpha.glassButton }]}>{empty}</View>
      )}
    </View>
  );
}

function DishSlide({ title, tone, poster, cook, heart, onImage }: { title: string; tone: SlideTone; poster: string | null; cook: RecapPerson | null; heart?: boolean; onImage: (key: string) => void }) {
  const onSettled = () => {
    if (poster) onImage(poster);
  };
  return (
    <View style={styles.stack}>
      {poster ? (
        <View style={styles.poster}>
          <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} onLoad={onSettled} onError={onSettled} accessibilityLabel="The dish" />
          {cook ? <Avatar profile={cook} size={56} ring style={styles.posterAvatar} /> : null}
        </View>
      ) : cook ? (
        <Avatar profile={cook} size={88} ring />
      ) : heart ? (
        <View style={[styles.disc, styles.discLeft, { backgroundColor: alpha.glassButton }]}>
          <HeartIcon filled size={52} color={colors.danger} />
        </View>
      ) : null}
      <Headline title={title} tone={tone} />
    </View>
  );
}

function VoicesSlide({ title, tone, voice, seed }: { title: string; tone: SlideTone; voice: RecapVoice | null; seed: string }) {
  return (
    <View style={styles.stack}>
      <Headline title={title} tone={tone} />
      <Waveform seed={seed} bars={22} height={56} color={tone.soft} progress={voice?.playing || (voice?.progress ?? 0) > 0 ? voice?.progress : undefined} />
      {voice ? (
        <View style={styles.voice}>
          <ActionButton
            label={voice.playing ? 'Pause' : voice.durationS ? `Hear ${voice.cookName} · ${mmss(voice.durationS)}` : `Hear ${voice.cookName}`}
            variant="outline"
            size="md"
            labelWeight={700}
            icon={
              voice.loading ? (
                <ActivityIndicator color={colors.ink} />
              ) : voice.playing ? (
                <PauseIcon size={20} color={colors.ink} />
              ) : (
                <PlayIcon size={20} color={colors.ink} />
              )
            }
            onPress={voice.toggle}
            accessibilityHint="Plays the clip you played most"
            style={styles.voiceButton}
          />
          <Txt variant="quote" size={19} leading={1.35} color={tone.fg}>
            {`“${voice.words}”`}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

function HeartsSlide({ title, tone, count }: { title: string; tone: SlideTone; count: number }) {
  const n = heartsShown(count);
  return (
    <View style={styles.stack}>
      {oneBigHeart(count) ? (
        <View
          style={[styles.disc, styles.discLeft, { backgroundColor: alpha.glassButton }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          <HeartIcon filled size={56} color={tone.accent} />
        </View>
      ) : (
        <View style={styles.hearts} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {Array.from({ length: n }, (_, i) => (
            <HeartIcon key={i} filled size={34} color={tone.accent} />
          ))}
        </View>
      )}
      <Headline title={title} tone={tone} />
    </View>
  );
}

function ThenNowSlide({ title, tone, photos, onImage }: { title: string; tone: SlideTone; photos: [RecapPhoto, RecapPhoto]; onImage: (key: string) => void }) {
  return (
    <View style={styles.stack}>
      <Headline title={title} tone={tone} />
      <View style={styles.pair}>
        {photos.map((p, i) => (
          <View key={p.message_id} style={styles.pairItem}>
            <Photo photo={p} onImage={onImage} tilt={i === 0 ? -1.5 : 1.5} style={styles.photoPair} />
            <Txt variant="label" color={tone.soft} align="center">
              {`${i === 0 ? 'Then' : 'Now'} · ${dayLabel(p.at)}`}
            </Txt>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * The kids who cooked the cook's dishes: a face & a name each, in the server's order (first cook of
 * the month). Never a count per kid or an order by how often: no sibling rankings (guardrail 4).
 */
function FacesSlide({ title, tone, faces, person }: { title: string; tone: SlideTone; faces: RecapFace[]; person: RecapStoryProps['person'] }) {
  const shown = faces.flatMap((f) => {
    const who = person(f.profile_id);
    return who ? [who] : [];
  }).slice(0, 6);
  return (
    <View style={styles.stack}>
      <Headline title={title} tone={tone} />
      {shown.length ? (
        <View style={styles.faces}>
          {shown.map((who) => (
            <View key={who.id} style={styles.face}>
              <Avatar profile={who} size={64} ring />
              <Txt variant="label" color={tone.fg} align="center" numberOfLines={1}>
                {who.name}
              </Txt>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { paddingHorizontal: space.lg, gap: space.md },
  bars: { flexDirection: 'row', gap: 4 },
  bar: { flex: 1, height: 4, borderRadius: radii.step },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topActions: { flexDirection: 'row', gap: space.sm },
  stage: { flex: 1 },
  capture: { flex: 1, paddingHorizontal: space.gutter, paddingTop: space.lg, paddingBottom: space.lg },
  body: { flex: 1, justifyContent: 'center' },
  mark: { alignSelf: 'center', opacity: 0.9 },
  center: { alignItems: 'flex-start', gap: space.xxl },
  stack: { gap: space.xxl },
  disc: { width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center' },
  discLeft: { alignSelf: 'flex-start' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  photoFrame: { overflow: 'hidden', borderRadius: radii.quote, backgroundColor: colors.well },
  photoOne: { width: '100%', aspectRatio: 4 / 3 },
  photoGrid: { width: '47%', aspectRatio: 1 },
  pair: { flexDirection: 'row', gap: space.md },
  pairItem: { flex: 1, gap: space.sm },
  photoPair: { width: '100%', aspectRatio: 3 / 4 },
  poster: { width: '100%', aspectRatio: 4 / 3, borderRadius: radii.card, overflow: 'hidden', backgroundColor: colors.well },
  posterAvatar: { position: 'absolute', left: space.lg, bottom: space.lg },
  voice: { gap: space.lg },
  voiceButton: { alignSelf: 'flex-start' },
  hearts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, maxWidth: 6 * 34 + 5 * space.sm },
  faces: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  face: { width: 84, alignItems: 'center', gap: 4 },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.gutter, paddingTop: space.md },
  next: { flex: 1 },
});
