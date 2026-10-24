// The kid's postcard after "I made it" (retention PR 3, RETENTION-HANDOFF 3.4), when the dish's cook
// is someone else in the family. The `cooked` card already went to them the moment "I made it" was
// tapped; this puts a photo (and, if they like, a rating) on that same card:
//
//            ┌──────────────┐
//            │  (camera)    │   the postcard to be: a picture, then the photo (never a button)
//            └──────────────┘
//      Show Dad how it came out
//      [after the photo] How close to Dad’s?   ○ ○ ○ ○ ○   (optional)
//
//   [ Take a photo ]                 -> [ Send to Dad ]     (the one shutter / the one action)
//   Choose a photo · Not now         -> Take another · Not now
//   Share with someone else          (the existing share sheet: family, Messages, a link)
//
// Send: upload -> POST /messages/:id/postcard -> the postcard flies up and away (a fade under Reduce
// Motion) with "Sent to Dad" -> back to the recipe. "Not now" goes back without one. While it sends,
// the quiet links and the pots wait (the photo shown is the one that goes, and nothing can leave twice).
// A failed send says why at the top of the screen, clear of the button's "Try again".
// Hackathon (docs/build/STACK.md "Close the loop"): the photo also goes to Convex
// (messages.sharePhoto), Muse drafts a short note to the cook, and the note takes the pots' place: the
// kid's words to edit, labelled "AI-drafted" (Convex keeps the label even after an edit). Send sends
// both the postcard and the photo with the note (messages.send); either one getting through counts.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { ActionButton, CameraIcon, PressableScale, SendIcon, ToastViewport, Txt, txtStyle, useToast } from '@/components/ui';
import { errorMessage, isApiError, type Profile } from '@/lib/api';
import { sendPhoto, sharePhoto, type SharedPhoto } from '@/lib/live/convex';
import { sendPostcard, type CookedRef } from '@/lib/messaging';
import { choosePhoto, openPhotoSettings, takePhoto, type Photo, type PhotoResult } from '@/lib/photos';
import { postcardAsk } from '@/lib/postcardLogic';
import { useShare } from '@/lib/share';
import type { Recipe } from '@/lib/types';
import { colors, radii, space } from '@/theme/tokens';

import { useScreenBottom, useScreenTop } from '../recipe/parts';
import { PostcardPhoto } from './PostcardPhoto';

const FLY_MS = 650;
const FADE_MS = 250;

/** The server's own words for a refusal ("too big", "can't be sent"); our words when it was the network or the server. */
function failWords(e: unknown, cookName: string): string {
  const ours = `Couldn’t send it to ${cookName}. Try again.`;
  if (isApiError(e) && (e.kind === 'network' || e.kind === 'timeout' || e.status >= 500)) return ours;
  return errorMessage(e, ours);
}

export function PostcardStep({
  recipe,
  cook,
  cooked,
  onDone,
}: {
  recipe: Pick<Recipe, 'id'>;
  /** The dish's cook: someone else in the family (lib/postcardLogic canPostcard). */
  cook: Pick<Profile, 'id' | 'name'>;
  /** The card "I made it" sent (null when it couldn't: the postcard then sends one). */
  cooked: CookedRef | null;
  /** Back to the recipe (sent, or "Not now"). */
  onDone: () => void;
}) {
  const toast = useToast();
  const share = useShare();
  const reduce = useReducedMotion();
  const top = useScreenTop();
  const bottom = useScreenBottom();
  const { width, height } = useWindowDimensions();
  const size = Math.max(160, Math.min(240, width - 2 * space.gutter, Math.round(height * 0.3)));
  const [photo, setPhoto] = useState<Photo | null>(null);
  // Muse's draft for this photo, and the kid's words (null = still drafting).
  const [shared, setShared] = useState<SharedPhoto | null>(null);
  const draft = shared?.draft ?? null;
  const [note, setNote] = useState<string | null>(null);
  // `sending`: from the Send tap until it answers. `flying`: sent, on its way out.
  const [sending, setSending] = useState(false);
  const [flying, setFlying] = useState(false);
  const busy = sending || flying;
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    };
  }, []);

  // The postcard on its way: up, a little turn, smaller, gone (Reduce Motion: it simply fades).
  const fly = useSharedValue(0);
  const cardStyle = useAnimatedStyle(() =>
    reduce
      ? { opacity: 1 - fly.value }
      : {
          opacity: 1 - fly.value * fly.value,
          transform: [{ translateY: -fly.value * height * 0.55 }, { rotate: `${-9 * fly.value}deg` }, { scale: 1 - 0.4 * fly.value }],
        },
  );
  const restStyle = useAnimatedStyle(() => ({ opacity: 1 - fly.value }));

  const pick = async (get: () => Promise<PhotoResult>) => {
    if (busy) return;
    const r = await get();
    if (r.ok) {
      setPhoto(r.photo);
      setShared(null);
      setNote(null);
      sharePhoto(recipe.id, r.photo.uri).then(
        (d) => {
          if (!alive.current) return;
          setShared(d);
          setNote(d.draft);
        },
        (e) => {
          console.warn('[postcard] sharePhoto failed', String(e));
          if (alive.current) setNote('');
        },
      );
      return;
    }
    if (r.cancelled) return;
    toast.show(r.error, { tone: 'error' });
    if (r.settings) openPhotoSettings();
  };

  const send = async () => {
    if (!photo || busy) return;
    setSending(true);
    try {
      const words = note?.trim() ?? '';
      const sent = await Promise.allSettled([
        sendPostcard({ recipeId: recipe.id, cooked, photo, rating: null }),
        shared ? sendPhoto(shared, words) : Promise.reject(new Error('The photo didn’t reach homecookd.')),
      ]);
      const ok = sent.find((r) => r.status === 'fulfilled');
      if (!ok) throw (sent[0] as PromiseRejectedResult).reason;
    } catch (e) {
      if (alive.current) setSending(false);
      toast.show(failWords(e, cook.name), { tone: 'error' });
      throw e; // the button says "Try again"
    }
    toast.show(`Sent to ${cook.name}`, { tone: 'success' });
    // Gone before it answered: the toast says it went, and nothing navigates a second time.
    if (!alive.current) return;
    const ms = reduce ? FADE_MS : FLY_MS;
    setSending(false);
    setFlying(true);
    fly.value = withTiming(1, { duration: ms, easing: Easing.in(Easing.cubic) });
    leaveTimer.current = setTimeout(onDone, ms + 120);
  };

  const ask = postcardAsk(cook.name);
  return (
    <Animated.View entering={FadeIn.duration(320).delay(120)} style={[StyleSheet.absoluteFill, styles.page, { paddingTop: top, paddingBottom: bottom }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <View style={styles.body}>
          {/* The postcard to be: a picture, never a second shutter ("Take a photo" is the one). */}
          <Animated.View style={[cardStyle, { width: size, height: size }]}>
            {photo ? (
              <PostcardPhoto uri={photo.uri} id={recipe.id} tilt={false} label="Your dish" style={StyleSheet.absoluteFill} />
            ) : (
              <View style={styles.shutter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <CameraIcon size={56} color={colors.peachInk} />
              </View>
            )}
          </Animated.View>
          <Animated.View style={[styles.words, restStyle]}>
            <Txt variant="display" size={30} leading={1.15} align="center" accessibilityRole="header" style={styles.ask}>
              {ask}
            </Txt>
            {photo ? (
              <Animated.View entering={FadeIn.duration(220)} style={styles.note}>
                {note === null ? (
                  <ActivityIndicator color={colors.muted} />
                ) : (
                  <>
                    <TextInput
                      value={note}
                      onChangeText={setNote}
                      editable={!busy}
                      multiline
                      maxLength={500}
                      placeholder={`A note to ${cook.name}`}
                      placeholderTextColor={colors.muted}
                      accessibilityLabel={`Your note to ${cook.name}`}
                      style={[txtStyle('body', 17), styles.noteInput]}
                    />
                    {draft && note.trim() === draft.trim() ? (
                      <Txt variant="meta" size={13} color={colors.lavenderInk} align="center">
                        AI-drafted · tap to change it
                      </Txt>
                    ) : null}
                  </>
                )}
              </Animated.View>
            ) : null}
          </Animated.View>
        </View>

        <Animated.View style={[styles.actions, restStyle]} pointerEvents={flying ? 'none' : 'auto'}>
          {photo ? (
            <ActionButton label={`Send to ${cook.name}`} icon={<SendIcon size={20} color={colors.card} />} successLabel="Sent" onPress={send} disabled={flying} />
          ) : (
            <ActionButton label="Take a photo" icon={<CameraIcon size={20} color={colors.card} />} onPress={() => void pick(takePhoto)} />
          )}
          <View style={styles.row}>
            <Quiet label={photo ? 'Take another' : 'Choose a photo'} color={colors.greenDeep} disabled={busy} onPress={() => void pick(photo ? takePhoto : choosePhoto)} />
            <Quiet label="Not now" hint="Goes back to the recipe" color={colors.muted} disabled={busy} onPress={onDone} />
          </View>
          <Quiet label="Share with someone else" hint="Family in the app, or anyone by a link" color={colors.muted} disabled={busy} onPress={() => share.open({ recipeId: recipe.id })} />
        </Animated.View>
      </KeyboardAvoidingView>
      {/* Toasts here show at the top, clear of "Try again"; once it flies, "Sent" shows where they always do. */}
      {flying ? null : <ToastViewport position="top" />}
    </Animated.View>
  );
}

function Quiet({ label, hint, color, disabled, onPress }: { label: string; hint?: string; color: string; disabled?: boolean; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} disabled={disabled} accessibilityLabel={label} accessibilityHint={hint} style={styles.quiet}>
      {/* Dimmed on the words: PressableScale animates its own opacity. */}
      <Txt variant="label" size={16} weight={600} color={color} style={disabled ? styles.waiting : undefined}>
        {label}
      </Txt>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { paddingHorizontal: space.gutter, backgroundColor: colors.page },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xxl },
  // Flat (no shadow): a picture of the postcard to be, not a button.
  shutter: {
    flex: 1,
    borderRadius: radii.panel,
    backgroundColor: colors.peach,
    alignItems: 'center',
    justifyContent: 'center',
  },
  words: { alignItems: 'center', gap: space.lg, maxWidth: 340 },
  // Narrow enough that the line breaks in two even halves ("Show Dad how it / came out"), never one word alone.
  ask: { maxWidth: 300 },
  note: { alignSelf: 'stretch', gap: space.xs, minHeight: 48, justifyContent: 'center' },
  noteInput: { minHeight: 72, maxHeight: 140, borderRadius: radii.quote, backgroundColor: colors.card, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, color: colors.ink, textAlignVertical: 'top' },
  actions: { gap: space.xs },
  row: { flexDirection: 'row', justifyContent: 'center', gap: space.lg },
  quiet: { minHeight: 48, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center' },
  waiting: { opacity: 0.5 },
});
