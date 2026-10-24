// "This week at the table" (RETENTION-HANDOFF 3.2): one compact row under the greeting on the cook
// Home (kid Home dropped it in round 2, Oct 22: a portal only).
// Up to 8 family faces, cooks first (lib/sundayTable.ts tableFaces), each with a small sun-yellow
// flame once that person has done their part this week. Unlit faces get nothing: no grey flame, no
// sad state, no copy about what didn't happen. Tap a face -> `onPressFace` (their chat, or PersonSheet
// for someone without a phone; the screen decides). While that chat opens, `busyId` names the face:
// a spinner over it, and the other cells dim and stop taking taps until it clears. My own face is
// shown ("You") but isn't a button: just my face and name. A memorial person never reaches the row
// (tableFaces leaves them out; TODO(caleb) #5); one passed by hand is shown unlit and isn't a button.
//
// One row, never a scroll: the cells share the measured width (64 pt each at most, 48 pt at least,
// the tap target), 8 cells at most. Pass the whole family: when they don't all fit (a 390-pt phone
// fits 7 cells), the last cell is "+N", N = everyone not shown, and opens the family list through
// `onPressMore` (MembersSheet); without it the "+N" is just a count.
//
// `large` is for the cook Home (big type for cooks in their 50s-70s): fewer, bigger cells (68-88 pt,
// 5 on a 375- or 390-pt phone), 56-pt faces and 16-pt names that wrap to a second line rather than
// cut off; the faces that don't fit go into the "+N".
//
// `dense` was the old kid Home's (unused since round 2): a 16-pt title, 40-pt faces, 13-pt names and
// tighter gaps (about 100 pt for the whole row, header included). The cells and tap targets stay
// 48 pt or more.
//
// `right` holds something for the header's right end (the old kid Home's "I miss home" pill). With no faces yet (first load,
// offline, the route not deployed, a kid alone in the family) the header still renders with just
// `right`, in the same spot. (The kid Home's pill is scoped by GET /table's `recordings`, so in
// practice it arrives with the faces.) With no faces and no `right`, nothing renders.
//
//   const { table } = useTable();
//   <TableRow faces={tableFaces(profiles, table, me?.id)} onPressFace={(p) => openChat(p.id)}
//     onPressMore={() => setMembersOpen(true)}
//     right={…} />                                                             // header extra
//   <TableRow large faces={…} onPressFace={…} onPressMore={…} />                   // cook Home
//
// Presentational: data & callbacks come in as props.
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Avatar, PressableScale, Txt } from '@/components/ui';
import { canTapFace, fitFaces, type TableFace, type TableFaceProfile } from '@/lib/sundayTable';
import { alpha, colors, space } from '@/theme/tokens';

import { FlameBadge } from './FlameBadge';

/** Cell widths (pt): `min` is also the tap target. */
const REGULAR = { min: 48, max: 64 };
/** `dense` faces are smaller, so a cell is wider than its face: room for "Grandma" at 13 pt. */
const DENSE = { min: 56, max: 64 };
const LARGE = { min: 68, max: 88 };
const LARGE_AVATAR = 56;
const LARGE_NAME = 16;

export type TableRowProps = {
  faces: TableFace[];
  onPressFace?: (profile: TableFaceProfile) => void;
  /** The face whose tap is still opening something (its chat): a spinner over it, the rest dimmed & not tappable. */
  busyId?: string | null;
  /** The "+N" cell when not every face fits: open the family list. */
  onPressMore?: () => void;
  /** Header slot on the right (the kid Home's "I miss home" pill). Shown even before faces load. */
  right?: ReactNode;
  /** The cook Home: bigger faces & names, fewer cells (more faces go into "+N"). */
  large?: boolean;
  /** The kid Home: smaller faces & tighter gaps, so the Home still fits a 375x812 phone. */
  dense?: boolean;
  title?: string;
  style?: StyleProp<ViewStyle>;
};

export function TableRow({ faces, onPressFace, busyId = null, onPressMore, right, large = false, dense = false, title = 'This week at the table', style }: TableRowProps) {
  const window = useWindowDimensions();
  // The usual spot is full width inside the page gutters; the real width replaces it after layout.
  const [measured, setMeasured] = useState<number | null>(null);
  if (!faces.length && !right) return null;
  const size = large ? LARGE : dense ? DENSE : REGULAR;
  const width = Math.max(size.min * 2, measured ?? window.width - space.gutter * 2);

  const { shown, more } = fitFaces(faces, Math.floor(width / size.min));
  const cells = shown.length + (more ? 1 : 0);
  const cell = cells ? Math.min(size.max, Math.floor(width / cells)) : size.max;
  const look: Look = large
    ? { avatar: LARGE_AVATAR, name: LARGE_NAME, lines: 2, minHeight: 84 }
    : dense
      ? { avatar: 40, name: 13, lines: 1, minHeight: 60, gap: 4 }
      : { avatar: cell >= 60 ? 48 : cell >= 54 ? 44 : 40, name: cell >= 56 ? 14 : 13, lines: 1, minHeight: 72 };

  return (
    <View style={[styles.wrap, dense && styles.wrapDense, style]}>
      <View style={[styles.header, dense && styles.headerDense]}>
        {faces.length ? (
          <Txt variant="heading" size={dense ? 16 : undefined} numberOfLines={1} accessibilityRole="header" style={styles.title}>
            {title}
          </Txt>
        ) : (
          <View style={styles.title} />
        )}
        {right}
      </View>
      {faces.length ? (
        <Animated.View
          entering={FadeIn.duration(200)}
          style={styles.faces}
          accessibilityRole="list"
          onLayout={(e) => {
            const w = Math.floor(e.nativeEvent.layout.width);
            if (w > 0 && w !== measured) setMeasured(w);
          }}>
          {shown.map((f) => (
            <Face
              key={f.profile.id}
              face={f}
              cell={cell}
              look={look}
              busy={busyId === f.profile.id}
              resting={!!busyId && busyId !== f.profile.id}
              onPress={onPressFace}
            />
          ))}
          {more ? <More count={more} cell={cell} look={look} resting={!!busyId} onPress={onPressMore} /> : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

/** How big a row's faces & names are: avatar & name in pt, name lines, cell height, face-to-name gap. */
type Look = { avatar: number; name: number; lines: number; minHeight: number; gap?: number };

/** `busy`: this face's tap is still opening (a spinner over the face). `resting`: another one is (dimmed, no taps). */
type CellState = { busy?: boolean; resting?: boolean };

function Face({ face, cell, look, busy = false, resting = false, onPress }: { face: TableFace; cell: number; look: Look; onPress?: (p: TableFaceProfile) => void } & CellState) {
  const { profile, lit, isMe } = face;
  const { avatar } = look;
  const memorial = profile.memorial === true;
  const name = isMe ? 'You' : profile.name;
  const label = lit && !memorial ? `${name}, at the table this week` : name;
  const body = (
    <>
      <View style={{ width: avatar, height: avatar }}>
        <Avatar profile={{ name: profile.name, avatar_key: profile.avatar_key ?? null }} size={avatar} />
        {busy ? (
          <View style={[styles.busy, { borderRadius: avatar / 2 }]} pointerEvents="none">
            <ActivityIndicator size="small" color={colors.card} />
          </View>
        ) : null}
        {lit && !memorial ? <FlameBadge avatarSize={avatar} /> : null}
      </View>
      <Txt variant="caption" size={look.name} color={colors.text} numberOfLines={look.lines} align="center" style={{ width: cell - 2 }}>
        {name}
      </Txt>
    </>
  );
  const cellStyle = [styles.cell, { width: cell, minHeight: look.minHeight }, look.gap !== undefined && { gap: look.gap }];
  if (!canTapFace(face) || !onPress) {
    return (
      <View style={[cellStyle, resting && styles.resting]} accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  // The dim sits on a wrapper: PressableScale's own press opacity would override it on the cell.
  return (
    <View style={resting ? styles.resting : undefined}>
      <PressableScale
        haptic
        disabled={busy || resting}
        accessibilityLabel={label}
        aria-busy={busy}
        onPress={() => onPress(profile)}
        style={cellStyle}>
        {body}
      </PressableScale>
    </View>
  );
}

function More({ count, cell, look, resting = false, onPress }: { count: number; cell: number; look: Look; onPress?: () => void } & CellState) {
  const { avatar } = look;
  const body = (
    <>
      <View style={[styles.more, { width: avatar, height: avatar, borderRadius: avatar / 2 }]}>
        <Txt variant="label" size={avatar >= 56 ? 18 : avatar >= 44 ? 16 : 15} weight={700} color={colors.text}>
          {`+${count}`}
        </Txt>
      </View>
      {/* Keeps the circle level with the faces beside it, whose names sit below. */}
      <Txt variant="caption" size={look.name} numberOfLines={1}>
        {' '}
      </Txt>
    </>
  );
  const label = `${count} more`;
  const cellStyle = [styles.cell, { width: cell, minHeight: look.minHeight }, look.gap !== undefined && { gap: look.gap }];
  if (!onPress) {
    return (
      <View style={[cellStyle, resting && styles.resting]} accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  return (
    <View style={resting ? styles.resting : undefined}>
      <PressableScale
        haptic
        disabled={resting}
        accessibilityLabel={label}
        accessibilityHint="Shows everyone in the family"
        onPress={onPress}
        style={cellStyle}>
        {body}
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  wrapDense: { gap: 6 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 32 },
  headerDense: { minHeight: 36, gap: 10 },
  title: { flexShrink: 1, flexGrow: 1 },
  faces: { flexDirection: 'row', paddingVertical: 2 },
  cell: { alignItems: 'center', gap: 6 },
  more: { backgroundColor: colors.well, alignItems: 'center', justifyContent: 'center' },
  // Over the face while its chat opens: the face still shows through, the spinner reads on any photo.
  busy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: alpha.backdrop, alignItems: 'center', justifyContent: 'center' },
  // The same dim as a disabled ActionButton (MembersSheet's other "Message" pills while one opens).
  resting: { opacity: 0.45 },
});
