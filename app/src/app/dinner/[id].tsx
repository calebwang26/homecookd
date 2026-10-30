// One Community dinner (dinners.get, live), Caleb's final Dinner canvas (Oct 24): the kid's yolk-tint
// wash and a cream back button; centred, the dish photo with a warm glow and a "DINNER" tag, "Jollof
// Rice Night" and "Hosted by Mom"; one card with when and where (the address only once the host said
// yes); "You're in" with a few faces and "4 going" (live: it rolls up when someone opens the invite);
// and one button. Before you ask: "Ask to join"; waiting: "Asked · waiting"; in, or hosting: "Invite
// friends", which opens the share sheet as a dinner invite. One step at a time for the host: while
// people are waiting on an answer the button says "2 asked to join" and takes them to the requests.
// Another family's dinner ends with a quiet "Report or block" (ReportSheet).
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { coverFor, useNow, useWaited } from '@/components/community/data';
import { goBack } from '@/components/community/DetailPage';
import { DinnerPhoto, GoingRow, HostPill, HostRequests, WhenWhere } from '@/components/community/DinnerParts';
import { dinnerAction, dinnerWhen, errorText, goingFaces, nightTitle, type DinnerAction } from '@/components/community/labels';
import { ReportOrBlock } from '@/components/community/ReportSheet';
import { ActionButton, BackIcon, EmptyState, IconButton, ScreenWash, Skeleton, Txt, useToast } from '@/components/ui';
import { requestJoin, useDinner, type Dinner } from '@/lib/live/community';
import { useSession } from '@/lib/session';
import { useShare } from '@/lib/share';
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
  const live = useDinner(id || null);
  // While "Report or block" is open the page keeps what it showed: a report empties the live answer.
  const [held, setHeld] = useState<Dinner | null>(null);
  const dinner = held ?? live;
  const now = useNow();
  const waited = useWaited(MISSING_MS);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduce = useReducedMotion();
  const scroller = useRef<ScrollView>(null);
  const top = Math.max(56, insets.top + 9);
  const photoW = Math.min(PHOTO_W, width - 2 * 32);
  const photoH = Math.round((photoW * PHOTO_H) / PHOTO_W);
  const action = dinner ? dinnerAction(dinner, now) : null;

  return (
    <View style={styles.screen}>
      <ScrollView
        ref={scroller}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingTop: top + 48, paddingBottom: FOOTER + insets.bottom }]}>
        <ScreenWash tone="kid" height={360} />
        {dinner && action ? (
          <Details dinner={dinner} action={action} now={now} photo={{ width: photoW, height: photoH }} onReportOpen={(open) => setHeld(open ? dinner : null)} />
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
        accessibilityLabel="Back"
        icon={(c) => <BackIcon size={22} color={c} />}
        onPress={() => goBack()}
        style={[styles.back, { top }]}
      />
      {dinner && action ? (
        <Footer
          dinner={dinner}
          action={action}
          bottom={Math.max(30, insets.bottom + 8)}
          // The requests are the page's last part: scrolled to the end they sit just above this button.
          showRequests={() => {
            scroller.current?.scrollToEnd({ animated: !reduce });
            AccessibilityInfo.announceForAccessibility?.('Asked to join, below');
          }}
        />
      ) : null}
    </View>
  );
}

function Details({
  dinner,
  action,
  now,
  photo,
  onReportOpen,
}: {
  dinner: Dinner;
  action: DinnerAction;
  now: number;
  photo: { width: number; height: number };
  onReportOpen: (open: boolean) => void;
}) {
  const { me } = useSession();
  const going = goingFaces(dinner, me?.name ?? '');
  const inIt = action.kind === 'invite' || action.kind === 'requests';
  const pill = inIt ? (dinner.isHost ? 'You’re hosting' : 'You’re in') : null;
  return (
    <>
      <View style={styles.center}>
        <DinnerPhoto uri={dinner.coverUrl ?? coverFor(dinner.recipeId)} dish={dinner.dish} width={photo.width} height={photo.height} />
        <Txt variant="display" size={32} align="center" accessibilityRole="header">
          {nightTitle(dinner.dish)}
        </Txt>
        <HostPill name={dinner.hostName} />
      </View>
      <View style={styles.side}>
        <WhenWhere when={dinnerWhen(dinner.startsAt, now)} placeName={dinner.placeName} address={dinner.address} />
        <GoingRow pill={pill} faces={going.faces} count={going.count} label={going.label} />
        {dinner.isHost && inIt ? <HostRequests dinner={dinner} /> : null}
        {dinner.ours === false ? (
          <ReportOrBlock target={{ kind: 'dinner', id: dinner.dinnerId, familyName: dinner.familyName ?? '' }} onOpenChange={onReportOpen} />
        ) : null}
      </View>
    </>
  );
}

/** The page's one button, pinned at the bottom. */
function Footer({ dinner, action, bottom, showRequests }: { dinner: Dinner; action: DinnerAction; bottom: number; showRequests: () => void }) {
  const toast = useToast();
  const share = useShare();
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
  } else if (action.kind === 'requests') {
    body = <ActionButton label={action.label} accessibilityHint="Shows who asked, to say yes or no" onPress={showRequests} />;
  } else if (action.kind === 'invite') {
    body = (
      <ActionButton
        label="Invite friends"
        accessibilityHint="Sends a link to this dinner. Whoever opens it counts as going."
        onPress={() =>
          share.open({
            dinner: { dinnerId: dinner.dinnerId, dish: dinner.dish, hostName: dinner.hostName, photo: dinner.coverUrl ?? coverFor(dinner.recipeId) },
          })
        }
      />
    );
  } else {
    const waiting = action.kind === 'waiting';
    body = (
      <View style={[styles.status, { backgroundColor: waiting ? colors.yolkTint : colors.well }]} accessibilityLiveRegion="polite">
        <Txt variant="title" size={18} color={waiting ? colors.ink : colors.ink} align="center">
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
