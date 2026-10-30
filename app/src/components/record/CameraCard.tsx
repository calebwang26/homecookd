// What the phone's camera sees while she films in the app (components/record/useInAppCamera): a rounded
// portrait card above the record button, so she can check the stove is in the shot. A small pill on it
// says "● 4:07" while filming and "Stopped" while paused. The one camera view lives here for the whole
// recording (the camera can only show in one place): for homie's plate photo the same card grows from
// its slot into the middle of the screen (`big`), on the UI thread (Reanimated), and shrinks back after.
// It's positioned absolutely over the slot the screen reserves for it (CAMERA_SLOT), so the plate
// moment's dim can sit under it. Reduce Motion: it fades between the two places instead of moving.
// Mirroring is VisionCamera's own default (no `isMirrored` prop): the back camera's video isn't mirrored, the
// front camera's preview, video and stills are, like a selfie. Never pass `isMirrored={false}` for the front
// camera: iOS mirrors front-camera frames itself, and VisionCamera only takes that over (and turns its
// rotation to match) when mirroring is on, so `false` stored front clips upside down (Oct 25, TestFlight).
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { Txt } from '@/components/ui';
import { colors, motion, radii } from '@/theme/tokens';

import { clockLabel } from './cameraLogic';
import type { CameraHandle, InAppCamera } from './useInAppCamera';

export type SlotFrame = { x: number; y: number; width: number; height: number };

/** The card's slot in the column: a portrait 3:4, at most this share of the screen's height. */
export function cameraSlotSize(screen: { width: number; height: number }, side: number) {
  const height = Math.round(Math.min(screen.height * 0.28, ((screen.width - 2 * side) * 4) / 3, 300));
  return { width: Math.round((height * 3) / 4), height };
}

/** Where the card goes for the plate photo: about the middle, leaving room for homie's words above and the shutter below. */
export function plateFrame(screen: { width: number; height: number }, side: number): SlotFrame {
  const width = Math.min(screen.width - 2 * side, (screen.height * 0.42 * 3) / 4);
  const height = (width * 4) / 3;
  return { x: (screen.width - width) / 2, y: screen.height * 0.48 - height / 2, width, height };
}

const GROW_MS = 380;

export function CameraCard({
  cam,
  attach,
  slot,
  big,
  side,
  photo,
  standIn = null,
}: {
  cam: InAppCamera;
  /** cam.setCamera: the <Camera> element's ref. */
  attach: (camera: CameraHandle | null) => void;
  slot: SlotFrame | null;
  big: boolean;
  side: number;
  photo: string | null;
  /** Dev previews on the web (no camera there): this picture in its place, filming at 4:07. */
  standIn?: number | null;
}) {
  const reduce = useReducedMotion();
  const screen = useWindowDimensions();
  const grow = useSharedValue(big ? 1 : 0);
  useEffect(() => {
    grow.set(withTiming(big ? 1 : 0, { duration: reduce ? motion.reducedFadeMs : GROW_MS, easing: Easing.inOut(Easing.cubic) }));
  }, [big, reduce, grow]);

  const to = plateFrame(screen, side);
  const from = slot ?? to;
  const style = useAnimatedStyle(() => {
    const t = grow.value;
    if (reduce) return { opacity: 1, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    const scale = 1 + (to.width / from.width - 1) * t;
    const dx = (to.x + to.width / 2 - (from.x + from.width / 2)) * t;
    const dy = (to.y + to.height / 2 - (from.y + from.height / 2)) * t;
    return { opacity: 1, transform: [{ translateX: dx }, { translateY: dy }, { scale }] };
  });

  const Camera = cam.Camera;
  if (!slot || (!standIn && (!Camera || !cam.device || !cam.usable))) return null;
  // Reduce Motion: no movement, the card is simply drawn where it belongs.
  const frame = reduce && big ? to : from;
  return (
    <Animated.View pointerEvents="none" style={[styles.card, { left: frame.x, top: frame.y, width: frame.width, height: frame.height }, style]}>
      {standIn ? (
        <Image source={standIn} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : Camera && cam.device ? (
        <Camera
          // A new key is a fresh camera session (filming.ts: a camera that didn't come back).
          key={cam.cameraKey}
          ref={attach}
          style={StyleSheet.absoluteFill}
          device={cam.device}
          format={cam.format}
          fps={cam.fps}
          isActive={cam.active}
          video
          audio
          videoBitRate={cam.bitRate}
          outputOrientation="device"
          resizeMode="cover"
          onInitialized={cam.onInitialized}
          onError={cam.onError}
        />
      ) : null}
      {photo ? <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel="Your plate" /> : null}
      {!big ? <Status cam={cam} preview={!!standIn} /> : null}
    </Animated.View>
  );
}

/** "● 4:07" while filming (the dot breathes), "Stopped" while paused. */
function Status({ cam, preview }: { cam: InAppCamera; preview: boolean }) {
  const reduce = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());
  const filming = preview || cam.phase === 'filming';
  useEffect(() => {
    if (!filming) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [filming]);
  const dot = useSharedValue(1);
  useEffect(() => {
    if (!filming || reduce) return void dot.set(1);
    dot.set(withRepeat(withSequence(withTiming(0.35, { duration: 700 }), withTiming(1, { duration: 700 })), -1, false));
  }, [filming, reduce, dot]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: dot.value }));
  if (!preview && (cam.phase === 'idle' || cam.phase === 'done')) return null;
  const clock = clockLabel(preview ? 247_000 : cam.filmedMs(now));
  return (
    <View style={styles.pill} accessible accessibilityLabel={filming ? `Recording, ${clock}` : 'Recording stopped'}>
      <Animated.View style={[styles.dot, filming ? dotStyle : styles.dotOff]} />
      <Txt variant="meta" size={13} weight={700} color={colors.card}>
        {filming ? clock : 'Stopped'}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', borderRadius: radii.card, overflow: 'hidden', backgroundColor: colors.ink, transformOrigin: 'center' },
  pill: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(31,36,48,0.55)',
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  dotOff: { backgroundColor: colors.card, opacity: 0.6 },
});
