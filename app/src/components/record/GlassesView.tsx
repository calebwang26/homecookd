// What the glasses see while she records from them (the laptop bridge, glasses/BRIDGE.md): the newest
// frame (about seven a second, from liveEvents.frame), whether the glasses are live, and what the live
// pass has seen so far (liveEvents.forRecording). A picture that stops updating says so after 5 s, so a
// stopped laptop receiver or a dropped hotspot is visible instead of silent.
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Txt } from '@/components/ui';
import type { LiveFrame } from '@/lib/live/convex';
import { colors, radii } from '@/theme/tokens';

import { COLUMN } from './RecordWash';

/** A frame older than this means the glasses (or the laptop) stopped sending. */
export const FRESH_MS = 5000;
const MAX_WIDTH = 360;
const MAX_HEIGHT_SHARE = 0.26; // of the screen, so the record button and its line still fit

/** The live-view state from the newest frame's age. */
export function glassesState(frame: LiveFrame | null, now: number): 'live' | 'stale' | 'waiting' {
  if (!frame) return 'waiting';
  return now - frame.at < FRESH_MS ? 'live' : 'stale';
}

export function GlassesView({ frame, filming, lastStep, steps }: { frame: LiveFrame | null; filming: boolean; lastStep: string | null; steps: number }) {
  const { width, height } = useWindowDimensions();
  const w = Math.min(width - 2 * COLUMN.side, MAX_WIDTH, height * MAX_HEIGHT_SHARE * (4 / 3));

  // Re-render every second so "live" turns into "waiting" when frames stop coming.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // The previous frame stays as the placeholder, so the picture never flashes blank between frames.
  const prev = useRef<string | null>(null);
  const [shown, setShown] = useState<{ url: string; before: string | null } | null>(null);
  useEffect(() => {
    if (!frame || frame.url === shown?.url) return;
    setShown({ url: frame.url, before: prev.current });
    prev.current = frame.url;
  }, [frame, shown?.url]);

  const state = glassesState(frame, now);
  const status = state === 'live' ? 'Glasses live' : state === 'stale' ? 'Glasses paused. Is the laptop receiver running?' : 'Waiting for your glasses…';
  const seen = !filming ? null : lastStep ? `Seen so far: ${lastStep} · ${steps} ${steps === 1 ? 'step' : 'steps'}` : state === 'live' ? 'Watching…' : null;

  return (
    <View style={styles.col}>
      <View style={[styles.card, { width: w, height: (w * 3) / 4 }]}>
        {shown ? (
          <Image
            source={{ uri: shown.url }}
            placeholder={shown.before ? { uri: shown.before } : undefined}
            transition={0}
            cachePolicy="memory"
            contentFit="cover"
            style={StyleSheet.absoluteFill}
            accessibilityLabel="What your glasses see"
          />
        ) : null}
        {state !== 'live' ? <View style={styles.dim} /> : null}
      </View>
      <View style={styles.statusRow} accessible accessibilityLabel={seen ? `${status}. ${seen}` : status}>
        <View style={[styles.dot, { backgroundColor: state === 'live' ? colors.green : colors.danger }]} />
        <Txt variant="meta" size={14} weight={600} color={state === 'live' ? colors.greenDeep : colors.danger}>
          {status}
        </Txt>
      </View>
      {seen ? (
        <Txt variant="meta" size={14} color={colors.muted} align="center" numberOfLines={2} style={styles.seen}>
          {seen}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  col: { alignItems: 'center', marginBottom: 20 },
  card: { borderRadius: radii.card, overflow: 'hidden', backgroundColor: colors.ink },
  dim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(30,36,16,0.45)' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  seen: { marginTop: 4, maxWidth: MAX_WIDTH },
});
