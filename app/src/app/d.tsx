// /d?t=<token>: a dinner's invite link opened in the app (homecookd://d?t=…, or homecookd.app/d?t=…
// where the app is installed). No sign-in needed: it tells the server this phone opened it (once per
// install: lib/live/invite.ts), which counts it in the dinner's "X going", and shows what the website's
// /d shows: "You’re going to Jollof Rice Night", "Hosted by Mom", "Friday · 7 pm". Never the place or the
// address: those are for the guests the host says yes to.
// Dev (web only): ?fixture=going|past|gone|offline draws each state without the server.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import { CalendarIcon, HostPill } from '@/components/community/DinnerParts';
import { openedWords } from '@/components/community/invite';
import { useNow } from '@/components/community/data';
import { riseIn } from '@/components/community/motion';
import { ActionButton, EmptyState, PotMark, ScreenWash, Skeleton, Txt } from '@/components/ui';
import { useHomieScreen } from '@/lib/homie';
import { openInvite, type Opened } from '@/lib/live/invite';
import { useSession } from '@/lib/session';
import { colors, radii, shadows } from '@/theme/tokens';

const DEV_WEB = __DEV__ && Platform.OS === 'web';
/** Next Friday, 7 pm (the fixture's dinner). */
const nextFriday = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
  d.setHours(19, 0, 0, 0);
  return d.getTime();
};
const FIXTURES: Record<string, Opened> = {
  going: { ok: true, dinner: { dish: 'Jollof Rice', hostFirstName: 'Mom', startsAt: nextFriday() } },
  past: { ok: true, dinner: { dish: 'Jollof Rice', hostFirstName: 'Mom', startsAt: Date.now() - 86_400_000 } },
  gone: { ok: false, why: 'gone' },
  offline: { ok: false, why: 'offline' },
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function DinnerInviteScreen() {
  const params = useLocalSearchParams<{ t?: string; fixture?: string }>();
  const token = one(params.t);
  const fixture = DEV_WEB ? FIXTURES[one(params.fixture) ?? ''] : undefined;
  const { me, homeFor } = useSession();
  // A link screen, like /i and /r: no pot in the corner.
  useHomieScreen({ hidden: true });
  const insets = useSafeAreaInsets();
  const now = useNow();
  const reduce = useReducedMotion();
  const [opened, setOpened] = useState<Opened | null>(fixture ?? null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (fixture) return;
    let live = true;
    void openInvite(token).then((r) => {
      if (live) setOpened(r);
    });
    return () => {
      live = false;
    };
  }, [token, fixture, attempt]);

  const done = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(me ? homeFor(me) : '/');
  }, [me, homeFor]);

  let body;
  if (!opened) {
    body = (
      <View style={styles.center} accessibilityLabel="Opening the invite" accessibilityState={{ busy: true }}>
        <Skeleton width={136} height={136} radius={68} />
        <Skeleton width="80%" height={34} />
        <Skeleton width={180} height={56} radius={radii.pill} />
      </View>
    );
  } else if (!opened.ok) {
    body =
      opened.why === 'gone' ? (
        <EmptyState title="This invite doesn’t work anymore" body="Ask whoever sent it for a new link." actionLabel="Done" onAction={done} />
      ) : (
        <EmptyState
          title="We couldn’t reach homecookd"
          body="Check your connection, then try again."
          actionLabel="Try again"
          onAction={() => {
            setOpened(null);
            setAttempt((a) => a + 1);
          }}
        />
      );
  } else {
    const words = openedWords(opened.dinner, now);
    body = (
      <Animated.View entering={riseIn(reduce)} style={styles.center}>
        <View style={styles.glow}>
          <PotMark size={96} mood="waving" />
        </View>
        <Txt variant="display" size={32} align="center" accessibilityRole="header">
          {words.title}
        </Txt>
        {opened.dinner.hostFirstName.trim() ? <HostPill name={opened.dinner.hostFirstName} /> : null}
        {words.when ? (
          <View style={styles.when} accessible accessibilityLabel={words.when}>
            <CalendarIcon />
            <Txt variant="heading">{words.when}</Txt>
          </View>
        ) : null}
      </Animated.View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 48, paddingBottom: Math.max(30, insets.bottom + 8) }]}>
      <ScreenWash tone="kid" height={420} />
      <View style={styles.middle}>{body}</View>
      {opened?.ok ? <ActionButton label="Done" onPress={done} style={styles.done} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  middle: { flex: 1, justifyContent: 'center', paddingHorizontal: 20 },
  center: { alignItems: 'center', gap: 18 },
  // The dinner photo's warm sun glow, round.
  glow: {
    width: 136,
    height: 136,
    borderRadius: 68,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 0 0 10px rgba(254,190,41,0.14), 0 0 70px rgba(254,190,41,0.35), 0 18px 44px rgba(30,36,16,0.12)',
  },
  when: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 22,
    backgroundColor: colors.card,
    boxShadow: shadows.card,
  },
  done: { marginHorizontal: 16 },
});
