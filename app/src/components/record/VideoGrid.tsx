// Parent-Send "Today's videos": a 3-column grid of 120 px thumbnails (radius 20). Picked = green
// 3 px ring + green check disc; not picked = 55% image + a dark disc with a cream border. Under each:
// "<b>2:10</b> · 12 min". A dashed tile at the end adds more (the bible's "Add family" tile style).
import { Image } from 'expo-image';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';

import { CheckIcon, listEnter, PlusIcon, PressableScale, Txt, VideoIcon } from '@/components/ui';
import { clock } from '@/lib/format';
import { alpha, colors, radii, shadows, space } from '@/theme/tokens';

import type { DraftClip } from './draft';
import { useVideoFrame } from './videoFrame';

const GAP = 10;
const TILE_H = 120;

/** "12 min", "1 hr 5 min", "42 sec". */
export function clipLength(ms: number | null | undefined): string {
  const s = Math.round((Number(ms) || 0) / 1000);
  if (s <= 0) return '';
  if (s < 60) return `${s} sec`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}

/** The bold part of the caption: the clock time it was recorded ("2:10"), else "Video 2". */
export function clipTime(clip: DraftClip, index: number): string {
  if (clip.recordedAt) return clock(clip.recordedAt).replace(/\s?(am|pm)$/, '');
  return `Video ${index + 1}`;
}

export function useTileWidth(): number {
  const { width } = useWindowDimensions();
  const inner = Math.min(width, 480) - space.gutter * 2;
  return Math.floor((inner - GAP * 2) / 3);
}

export function VideoGrid({
  clips,
  onToggle,
  onAdd,
}: {
  clips: DraftClip[];
  onToggle: (key: string) => void;
  onAdd: () => void;
}) {
  const w = useTileWidth();
  return (
    <View style={styles.grid}>
      {clips.map((c, i) => (
        <Animated.View key={c.key} entering={listEnter(i)} style={{ width: w }}>
          <VideoTile clip={c} index={i} onPress={() => onToggle(c.key)} />
        </Animated.View>
      ))}
      {clips.length === 0 ? (
        <Animated.View entering={listEnter(0)} style={styles.full}>
          <AddTile onPress={onAdd} />
        </Animated.View>
      ) : null}
    </View>
  );
}

function VideoTile({ clip, index, onPress }: { clip: DraftClip; index: number; onPress: () => void }) {
  const frame = useVideoFrame(clip.previewImage ? null : clip.asset.uri, clip.asset.duration);
  const on = useDerivedValue(() => withTiming(clip.selected ? 1 : 0, { duration: 180 }), [clip.selected]);
  const imgStyle = useAnimatedStyle(() => ({ opacity: 0.55 + 0.45 * on.value }));
  const time = clipTime(clip, index);
  const len = clipLength(clip.asset.duration);
  const source = clip.previewImage ? { uri: clip.previewImage } : frame;
  return (
    <PressableScale
      onPress={onPress}
      haptic
      scaleTo={0.97}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: clip.selected }}
      accessibilityLabel={`Your ${time} video${len ? `, ${len}` : ''}${clip.selected ? ', picked' : ''}`}
      accessibilityHint={clip.selected ? 'Leaves this video out' : 'Sends this video too'}
      style={styles.tileCol}>
      <View style={[styles.ring, clip.selected ? { boxShadow: shadows.ringSelected } : null]}>
        <View style={styles.thumb}>
          {source ? (
            <Animated.View style={[StyleSheet.absoluteFill, imgStyle]}>
              <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
            </Animated.View>
          ) : (
            <Animated.View style={[StyleSheet.absoluteFill, styles.noFrame, imgStyle]}>
              <VideoIcon size={28} color={colors.ink} />
            </Animated.View>
          )}
          <View
            style={[
              styles.check,
              clip.selected
                ? { backgroundColor: colors.yolk }
                : { backgroundColor: 'rgba(31,36,48,0.25)', borderWidth: 2, borderColor: colors.card },
            ]}>
            <CheckIcon size={14} strokeWidth={3.5} color={clip.selected ? colors.ink : colors.card} />
          </View>
        </View>
      </View>
      <Txt variant="meta" size={14} numberOfLines={1}>
        <Txt variant="meta" size={14} weight={700} color={colors.ink}>
          {time}
        </Txt>
        {len ? ` · ${len}` : ''}
      </Txt>
    </PressableScale>
  );
}

/** Empty grid: one dashed tile (the bible's "Add family" tile style). */
function AddTile({ onPress }: { onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} haptic scaleTo={0.97} accessibilityLabel="Add your videos" style={styles.add}>
      <PlusIcon size={28} color={colors.yolkDeep} />
      <Txt variant="label" size={15} weight={700} color={colors.yolkDeep} align="center">
        Add your videos
      </Txt>
    </PressableScale>
  );
}

/** Next to "Today's videos" once there are some: "+ Add more" (another part, or more from the roll). */
export function AddMoreLink({ onPress }: { onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} haptic accessibilityLabel="Add another video" hitSlop={8} style={styles.more}>
      <PlusIcon size={18} strokeWidth={2.2} color={colors.yolkDeep} />
      <Txt variant="label" size={15} weight={700} color={colors.yolkDeep}>
        Add more
      </Txt>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tileCol: { gap: 6 },
  ring: { height: TILE_H, borderRadius: radii.quote },
  thumb: { flex: 1, borderRadius: radii.quote, overflow: 'hidden', backgroundColor: colors.well },
  noFrame: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.well },
  check: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  full: { width: '100%' },
  more: { height: 22, flexDirection: 'row', alignItems: 'center', gap: 4 },
  add: {
    height: TILE_H,
    borderRadius: radii.quote,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: alpha.dashed,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
