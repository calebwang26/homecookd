// Cook mode's finish, over the whole screen once "I made it" is tapped:
//   1. the SuccessBurst ("You made it" / "We told Dad."; a milestone title for a learner), held 1.8 s
//   2. when the dish's cook is someone else in the family (not a memorial profile), the postcard
//      (retention PR 3, components/postcard/PostcardStep): "Show Dad how it came out", one big shutter,
//      an optional "How close to Dad’s?" in pots, Send -> the photo lands on the `cooked` card "I made
//      it" already sent; a quiet "Share with someone else" keeps the share sheet, and "Not now"
//   3. otherwise (my own dish, a cook outside the family) the calm share prompt as before: the dish
//      photo, "Want to share the love?", a big "Send to someone" (the share sheet: family in the app,
//      anyone else by Messages, WhatsApp or a link) and a quiet "Not now".
// `onFinished` runs when the burst ends (clear progress). `onLeave` runs when the postcard is sent or
// skipped, on the share prompt's "Not now", or once its share sheet has really shown and closed again
// (sent or dismissed); a failed open stays there.
// Gentle fades only; Reanimated skips them under Reduce Motion.
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { PostcardStep } from '@/components/postcard';
import { ActionButton, PotMark, PressableScale, SendIcon, SuccessBurst, Txt } from '@/components/ui';
import type { Profile } from '@/lib/api';
import type { CookedRef } from '@/lib/messaging';
import { canPostcard } from '@/lib/postcardLogic';
import { useShare } from '@/lib/share';
import type { Recipe } from '@/lib/types';
import { colors, motion, radii, shadows, space } from '@/theme/tokens';

import { useScreenBottom, useScreenTop } from './parts';

// The share sheet also closes itself when an open fails: UIKit refused the Modal (its watchdog
// gives up after 1.2 s) or the sheet crashed. A sheet that was up for less than this counts as
// never shown, so the prompt stays and the person can try again or tap "Not now".
const SHOWN_MIN_MS = 1500;

export function MadeItOverlay({
  recipe,
  poster,
  title,
  subtitle,
  cook,
  meId,
  cooked,
  onFinished,
  onLeave,
}: {
  recipe: Recipe;
  poster: string | null;
  title: string;
  subtitle?: string;
  /** The dish's cook when they're someone else in the family: the postcard instead of the share prompt. */
  cook: Profile | null;
  /** Who made it (the acting person). */
  meId: string | null | undefined;
  /** The `cooked` card "I made it" sent, which the postcard goes on (null when it couldn't send). */
  cooked: CookedRef | null;
  onFinished: () => void;
  onLeave: () => void;
}) {
  const [stage, setStage] = useState<'burst' | 'postcard' | 'share'>('burst');
  const postcard = canPostcard(cook, meId);
  const finishedRef = useRef(onFinished);
  const leaveRef = useRef(onLeave);
  useEffect(() => {
    finishedRef.current = onFinished;
    leaveRef.current = onLeave;
  });
  // Stable for SuccessBurst, which reads onDone once when it starts.
  const afterBurst = useCallback(() => {
    finishedRef.current();
    setStage(postcard ? 'postcard' : 'share');
  }, [postcard]);
  const leave = useCallback(() => leaveRef.current(), []);

  return (
    <Animated.View entering={FadeIn.duration(220)} style={[StyleSheet.absoluteFill, styles.page]}>
      {stage === 'postcard' && cook ? (
        <PostcardStep recipe={recipe} cook={cook} cooked={cooked} onDone={leave} />
      ) : stage !== 'burst' ? (
        <ShareLove recipe={recipe} poster={poster} onLeave={leave} />
      ) : (
        <Animated.View exiting={FadeOut.duration(200)} style={[StyleSheet.absoluteFill, styles.burst]}>
          <SuccessBurst title={title} subtitle={subtitle} holdMs={1800} onDone={afterBurst} steam />
        </Animated.View>
      )}
    </Animated.View>
  );
}

function ShareLove({ recipe, poster, onLeave }: { recipe: Recipe; poster: string | null; onLeave: () => void }) {
  const share = useShare();
  const top = useScreenTop();
  const bottom = useScreenBottom();
  const { width } = useWindowDimensions();
  const photo = Math.min(240, width - 2 * space.gutter);
  const dish = recipe.title?.trim();

  // Leave once the sheet we asked for has shown and gone again.
  const [asked, setAsked] = useState(false);
  const shownAt = useRef<number | null>(null);
  useEffect(() => {
    if (!asked) return;
    if (share.visible) {
      shownAt.current = Date.now();
      return;
    }
    if (shownAt.current === null) return; // still opening
    const lasted = Date.now() - shownAt.current;
    shownAt.current = null;
    if (lasted < SHOWN_MIN_MS) return;
    // Let the sheet finish sliding away before the screen changes under it.
    const t = setTimeout(onLeave, motion.sheetCloseMs + 80);
    return () => clearTimeout(t);
  }, [asked, share.visible, onLeave]);

  return (
    <Animated.View entering={FadeIn.duration(320).delay(120)} style={[StyleSheet.absoluteFill, styles.ask, { paddingTop: top, paddingBottom: bottom }]}>
      <View style={styles.body}>
        <View style={[styles.photoShadow, { width: photo, height: photo }]}>
          <View style={styles.photo}>
            {poster ? (
              <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} accessibilityLabel={dish || 'The dish'} />
            ) : (
              <PotMark size={72} />
            )}
          </View>
        </View>
        <Txt variant="display" size={30} leading={1.15} align="center" accessibilityRole="header" style={styles.words}>
          Want to share the love?
        </Txt>
      </View>

      <View style={styles.actions}>
        <ActionButton
          label="Send to someone"
          icon={<SendIcon size={20} color={colors.card} />}
          onPress={() => {
            setAsked(true);
            share.open({ recipeId: recipe.id });
          }}
        />
        <PressableScale onPress={onLeave} accessibilityLabel="Not now" accessibilityHint="Goes back to the recipe" style={styles.quiet}>
          <Txt variant="label" size={16} weight={600} color={colors.muted}>
            Not now
          </Txt>
        </PressableScale>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: colors.page },
  burst: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xxxl },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xxxl },
  ask: { paddingHorizontal: space.gutter },
  // The shadow sits on an outer view: overflow hidden would clip it.
  photoShadow: { borderRadius: radii.panel, boxShadow: shadows.card },
  photo: { flex: 1, borderRadius: radii.panel, overflow: 'hidden', backgroundColor: colors.peach, alignItems: 'center', justifyContent: 'center' },
  words: { maxWidth: 340 },
  actions: { gap: space.sm },
  quiet: { height: 52, alignItems: 'center', justifyContent: 'center' },
});
