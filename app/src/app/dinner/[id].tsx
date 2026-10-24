// One Community dinner (dinners.get, live), Caleb's final Hearth Dinner mockup (Oct 24): the kid's
// lavender wash and a cream back button; centred, the dish photo with a warm glow and a "DINNER" tag,
// "Jollof Rice Night" and "Hosted by Mom"; one card with when and where (the address only once the host
// said yes); "You're in" with a few faces, "4 going"; and one button. Before you ask: "Ask to join";
// waiting: "Asked · waiting"; in (or hosting): "Add to calendar". The host also answers requests here.
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addToCalendar } from '@/components/community/calendar';
import { coverFor, useNow, useWaited } from '@/components/community/data';
import { goBack } from '@/components/community/DetailPage';
import { DinnerPhoto, GoingRow, HostPill, HostRequests, WhenWhere } from '@/components/community/DinnerParts';
import { dinnerAction, dinnerWhen, errorText, goingFaces, nightTitle } from '@/components/community/labels';
import { ActionButton, BackIcon, EmptyState, IconButton, ScreenWash, Skeleton, Txt, useToast } from '@/components/ui';
import { requestJoin, useDinner, type Dinner } from '@/lib/live/community';
import { useSession } from '@/lib/session';
import { colors, radii } from '@/theme/tokens';

/** dinners.get answers null while it loads and for a dinner that's gone: wait this long to say so. */
const MISSING_MS = 4000;
const PHOTO_W = 326;
const PHOTO_H = 300;
const SIDE = 20;
const FOOTER = 56 + 30 + 16;

export default function DinnerPage() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const dinner = useDinner(id || null);
  const now = useNow();
  const waited = useWaited(MISSING_MS);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const top = Math.max(56, insets.top + 9);
  const photoW = Math.min(PHOTO_W, width - 2 * 32);
  const photoH = Math.round((photoW * PHOTO_H) / PHOTO_W);

  return (
    <View style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingTop: top + 48, paddingBottom: FOOTER + insets.bottom }]}>
        <ScreenWash tone="kid" height={360} />
        {dinner ? (
          <Details dinner={dinner} now={now} photo={{ width: photoW, height: photoH }} />
        ) : waited || !id ? (
          <EmptyState title="This dinner isn’t here anymore" actionLabel="Back" onAction={() => goBack()} />
        ) : (
          <View style={styles.center}>
            <Skeleton width={photoW} height={photoH} radius={32} />
            <Skeleton width="60%" height={32} />
            <Skeleton width={160} height={56} radius={radii.pill} />
          </View>
        )}
      </ScrollView>
      <IconButton
        tone="cream"
        size={44}
        accessibilityLabel="Back"
        icon={(c) => <BackIcon size={22} color={c} />}
        onPress={() => goBack()}
        style={[styles.back, { top }]}
      />
      {dinner ? <Footer dinner={dinner} now={now} bottom={Math.max(30, insets.bottom + 8)} /> : null}
    </View>
  );
}

function Details({ dinner, now, photo }: { dinner: Dinner; now: number; photo: { width: number; height: number } }) {
  const { me } = useSession();
  const action = dinnerAction(dinner, now);
  const going = goingFaces(dinner, me?.name ?? '');
  const pill = action.kind === 'calendar' ? (dinner.isHost ? 'You’re hosting' : 'You’re in') : null;
  return (
    <>
      <View style={styles.center}>
        <DinnerPhoto uri={dinner.coverUrl ?? coverFor(dinner.recipeId)} dish={dinner.dish} width={photo.width} height={photo.height} />
        <Txt variant="display" size={32} align="center" accessibilityRole="header">
          {nightTitle(dinner.dish)}
        </Txt>
        <HostPill name={dinner.isHost ? 'You' : dinner.hostName} />
      </View>
      <View style={styles.side}>
        <WhenWhere when={dinnerWhen(dinner.startsAt, now)} placeName={dinner.placeName} address={dinner.address} />
        <GoingRow pill={pill} faces={going.faces} label={going.label} />
        {dinner.isHost && action.kind === 'calendar' ? <HostRequests dinner={dinner} /> : null}
      </View>
    </>
  );
}

/** The page's one button, pinned at the bottom. */
function Footer({ dinner, now, bottom }: { dinner: Dinner; now: number; bottom: number }) {
  const toast = useToast();
  const action = dinnerAction(dinner, now);
  const host = dinner.hostName.trim() || 'The host';
  let body;
  if (action.kind === 'ask') {
    body = (
      <ActionButton
        label="Ask to join"
        accessibilityHint={`${host} sees your name and says yes or no`}
        onPress={async () => {
          try {
            await requestJoin(dinner.dinnerId);
          } catch (e) {
            toast.show(errorText(e), { tone: 'error' });
            throw e;
          }
        }}
      />
    );
  } else if (action.kind === 'calendar') {
    body = (
      <ActionButton
        label="Add to calendar"
        accessibilityHint="Saves this dinner to your calendar"
        onPress={async () => {
          try {
            await addToCalendar({
              uid: dinner.dinnerId,
              title: nightTitle(dinner.dish),
              startsAt: dinner.startsAt,
              location: dinner.address ? `${dinner.placeName}, ${dinner.address}` : dinner.placeName,
              description: dinner.isHost ? 'You’re hosting' : `Hosted by ${host}`,
              now: Date.now(),
            });
          } catch (e) {
            toast.show('Couldn’t open your calendar. Try again.', { tone: 'error' });
            throw e;
          }
        }}
      />
    );
  } else {
    const waiting = action.kind === 'waiting';
    body = (
      <View style={[styles.status, { backgroundColor: waiting ? colors.butter : colors.well }]} accessibilityLiveRegion="polite">
        <Txt variant="title" size={18} color={waiting ? colors.butterInk : colors.ink} align="center">
          {waiting ? action.label : action.text}
        </Txt>
      </View>
    );
  }
  return <View style={[styles.footer, { bottom }]}>{body}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { flexGrow: 1, gap: 16 },
  center: { alignItems: 'center', gap: 16, paddingHorizontal: SIDE },
  side: { paddingHorizontal: SIDE, gap: 16 },
  back: { position: 'absolute', left: SIDE },
  footer: { position: 'absolute', left: 16, right: 16 },
  status: { height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
});
