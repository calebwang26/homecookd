// The dinner page's parts (Caleb's final Hearth Dinner mockup, Oct 24):
//   DinnerPhoto    the dish photo, 326x300 with a warm yolk glow and a small "DINNER" tag
//   HostPill       a cream pill: the host's initial, "Hosted by", the name
//   WhenWhere      one cream card: "Friday · 7 pm" | the place, and its address once it's yours to see
//   GoingRow       "You're in" (or "You're hosting") and a few faces, "4 going" (rolls up as it grows)
//   HostRequests   the host's open requests, each with Decline / Accept
// Every answer is live (dinners.get), so these redraw on both phones as requests and invite opens come in.
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { ActionButton, Avatar, CheckIcon, Pill, Txt, useToast } from '@/components/ui';
import { respond, type Dinner } from '@/lib/live/community';
import { alpha, colors, radii, shadows } from '@/theme/tokens';

import { DishPhoto } from './DishPhoto';
import { errorText } from './labels';
import { fadeIn } from './motion';

// From the mockup: a yolk ring at 14%, a soft yolk glow, and the usual drop shadow.
const GLOW = '0 0 0 10px rgba(242,162,58,0.14), 0 0 70px rgba(242,162,58,0.35), 0 18px 44px rgba(24,34,29,0.18)';
const PHOTO_RADIUS = 32;

export function DinnerPhoto({ uri, dish, width, height }: { uri: string | null; dish: string; width: number; height: number }) {
  return (
    <View style={[styles.photoWrap, { width, height }]}>
      <DishPhoto uri={uri} label={dish} size={200} style={styles.photo} />
      <View style={styles.tag}>
        <Txt variant="eyebrow" color={colors.ink}>
          Dinner
        </Txt>
      </View>
    </View>
  );
}

export function HostPill({ name }: { name: string }) {
  const who = name.trim() || 'A neighbor';
  return (
    <View style={styles.host} accessible accessibilityLabel={`Hosted by ${who}`}>
      <Avatar name={who} avatarKey={null} size={44} tileBg={colors.yolkTint} tileFg={colors.ink} />
      <View>
        <Txt variant="tiny" weight={600}>
          Hosted by
        </Txt>
        <Txt variant="title">{who}</Txt>
      </View>
    </View>
  );
}

export const CalendarIcon = () => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.green} strokeWidth={2} strokeLinecap="round">
    <Rect x={3.5} y={5} width={17} height={15} rx={3} />
    <Path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
);

const PinIcon = () => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.green} strokeWidth={2} strokeLinejoin="round">
    <Path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" />
    <Circle cx={12} cy={9.5} r={2.5} />
  </Svg>
);

export function WhenWhere({ when, placeName, address }: { when: string; placeName: string; address: string | null }) {
  return (
    <View style={styles.card}>
      <View style={[styles.line, styles.divider]} accessible accessibilityLabel={when}>
        <CalendarIcon />
        <Txt variant="heading">{when}</Txt>
      </View>
      <View style={styles.line} accessible accessibilityLabel={[placeName, address].filter(Boolean).join(', ')}>
        <PinIcon />
        <View style={styles.flex}>
          <Txt variant="heading">{placeName}</Txt>
          {address ? (
            <Txt variant="meta" selectable>
              {address}
            </Txt>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const FACE_TONES = [
  { bg: colors.yolkTint, fg: colors.ink },
  { bg: colors.yolkTint, fg: colors.ink },
  { bg: colors.greenTint, fg: colors.green },
];

export function GoingRow({ pill, faces, count, label }: { pill: string | null; faces: string[]; count: number; label: string }) {
  return (
    <View style={styles.going}>
      {pill ? (
        <Pill tone="greenTint" size="lg" fontSize={16} label={pill} leading={<CheckIcon size={18} strokeWidth={3} color={colors.green} />} />
      ) : (
        <View />
      )}
      <View style={styles.faces} accessible accessibilityLabel={label}>
        <View style={styles.faceRow}>
          {faces.map((f, i) => (
            <View key={`${i}:${f}`} style={[styles.face, i ? styles.overlap : null, { backgroundColor: FACE_TONES[i % 3].bg }]}>
              <Txt variant="label" size={13} weight={700} color={FACE_TONES[i % 3].fg}>
                {f}
              </Txt>
            </View>
          ))}
        </View>
        <RollingCount count={count} label={label} />
      </View>
    </View>
  );
}

/**
 * "4 going", live: when someone opens the invite (or the host says yes) the new number rolls up from
 * below; with Reduce Motion it fades in. The first number just shows.
 */
function RollingCount({ count, label }: { count: number; label: string }) {
  const reduce = useReducedMotion();
  const [first] = useState(count);
  const entering = count === first ? undefined : reduce ? fadeIn(220) : rollUp;
  return (
    <View style={styles.rolling} accessibilityLiveRegion="polite">
      <Animated.View key={count} entering={entering}>
        <Txt variant="body" size={15}>
          {label}
        </Txt>
      </Animated.View>
    </View>
  );
}

const rollUp = Platform.OS === 'web' ? FadeInDown.duration(320) : FadeInDown.springify().damping(14).stiffness(180).withInitialValues({ opacity: 0, transform: [{ translateY: 14 }] });

/** For the host of a dinner still ahead: the open requests (the guests already in count as going). */
export function HostRequests({ dinner }: { dinner: Dinner }) {
  const toast = useToast();
  const requests = (dinner.requests ?? []).filter((r) => r.status === 'pending');
  if (!requests.length) return null;
  const answer = (requestId: string, accept: boolean) => async () => {
    try {
      await respond(requestId, accept);
    } catch (e) {
      toast.show(errorText(e), { tone: 'error' });
      throw e;
    }
  };
  return (
    <View style={styles.card}>
      <Txt variant="label" color={colors.muted} accessibilityRole="header" style={styles.asked}>
        Asked to join
      </Txt>
      {requests.map((r, i) => {
        const name = r.guestName.trim() || 'A neighbor';
        return (
          <View key={r.requestId} style={[styles.request, i < requests.length - 1 ? styles.divider : null]}>
            <Avatar name={name} avatarKey={null} size={36} tileBg={colors.yolkTint} tileFg={colors.ink} />
            <Txt variant="heading" numberOfLines={1} style={styles.flex}>
              {name}
            </Txt>
            <ActionButton label="Decline" variant="outline" size="xs" padH={14} onPress={answer(r.requestId, false)} accessibilityLabel={`Decline ${name}`} />
            <ActionButton
              label="Accept"
              size="xs"
              padH={14}
              flat
              disabled={dinner.seatsLeft <= 0}
              onPress={answer(r.requestId, true)}
              accessibilityLabel={`Accept ${name}`}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  photoWrap: { borderRadius: PHOTO_RADIUS, boxShadow: GLOW, alignSelf: 'center' },
  photo: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: PHOTO_RADIUS },
  tag: { position: 'absolute', left: 14, top: 14, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.yolk },
  host: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    alignSelf: 'center',
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 18,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    boxShadow: shadows.button,
  },
  card: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 22, backgroundColor: colors.card, boxShadow: shadows.card },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  divider: { borderBottomWidth: 1, borderBottomColor: alpha.hairline },
  flex: { flex: 1, minWidth: 0 },
  going: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rolling: { overflow: 'hidden' },
  faces: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  faceRow: { flexDirection: 'row' },
  face: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: colors.page, alignItems: 'center', justifyContent: 'center' },
  overlap: { marginLeft: -8 },
  asked: { paddingTop: 10 },
  request: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, paddingVertical: 8 },
});
