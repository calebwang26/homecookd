// The dinner page's parts, one per person's view of it:
//   GuestStatus   accepted: the sage "You're in. Shreya said yes." card with the place and the exact
//                 address; asked: waiting; declined: a gentle no; nobody yet: "Ask to join"
//   HostPanel     the host's own address card and the open requests, each with Accept / Decline
//   WhoComing     the "Who's coming" chips
// Every answer is live (dinners.get), so these redraw on both phones as requests come and go.
import { StyleSheet, View } from 'react-native';

import { ActionButton, Avatar, Pill, Txt, useToast } from '@/components/ui';
import { requestJoin, respond, type Dinner } from '@/lib/live/community';
import { colors, radii, shadows, space } from '@/theme/tokens';

import { errorText, whoComing } from './labels';

function Address({ placeName, address, ink }: { placeName: string; address: string | null; ink: string }) {
  return (
    <View style={styles.address}>
      <Txt variant="rowTitle" size={17} color={ink}>
        {placeName}
      </Txt>
      {address ? (
        <Txt variant="bodyInk" size={16} leading={1.4} color={ink} selectable>
          {address}
        </Txt>
      ) : null}
    </View>
  );
}

/** For a dinner still ahead and not called off (the page says so otherwise). */
export function GuestStatus({ dinner }: { dinner: Dinner }) {
  const toast = useToast();
  const host = dinner.hostName.trim() || 'The host';
  const status = dinner.myRequest?.status;

  if (status === 'accepted') {
    return (
      <View style={[styles.card, { backgroundColor: colors.sage }]} accessibilityLiveRegion="polite">
        <Txt variant="title" size={18} color={colors.sageInk}>
          You’re in. {host} said yes.
        </Txt>
        <Address placeName={dinner.placeName} address={dinner.address} ink={colors.sageInk} />
      </View>
    );
  }
  if (status === 'pending') {
    return (
      <View style={[styles.card, { backgroundColor: colors.butter }]} accessibilityLiveRegion="polite">
        <Txt variant="title" size={18} color={colors.butterInk}>
          Asked. Waiting for {host}.
        </Txt>
        <Txt variant="body" size={15} color={colors.butterInk}>
          At {dinner.placeName}
        </Txt>
      </View>
    );
  }
  if (status === 'declined') {
    return (
      <View style={[styles.card, { backgroundColor: colors.well }]}>
        <Txt variant="title" size={18}>
          {host} can’t fit you this time.
        </Txt>
      </View>
    );
  }
  if (dinner.status !== 'open' || dinner.seatsLeft <= 0) {
    return (
      <View style={[styles.card, { backgroundColor: colors.well }]}>
        <Txt variant="title" size={18}>
          Every seat is taken.
        </Txt>
      </View>
    );
  }
  return (
    <View style={styles.ask}>
      <Txt variant="body" size={16}>
        At {dinner.placeName}
      </Txt>
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
    </View>
  );
}

/** For a dinner still ahead and not called off. */
export function HostPanel({ dinner }: { dinner: Dinner }) {
  const toast = useToast();
  // Only open requests: the guests already in show under "Who's coming".
  const requests = (dinner.requests ?? []).filter((r) => r.status === 'pending');
  const anyIn = (dinner.requests ?? []).some((r) => r.status === 'accepted');
  const answer = (requestId: string, accept: boolean) => async () => {
    try {
      await respond(requestId, accept);
    } catch (e) {
      toast.show(errorText(e), { tone: 'error' });
      throw e;
    }
  };
  return (
    <>
      <View style={[styles.card, styles.raised]}>
        <Address placeName={dinner.placeName} address={dinner.address} ink={colors.ink} />
        <Txt variant="caption">Only guests you say yes to see the address.</Txt>
      </View>

      <View style={styles.section}>
        <Txt variant="heading" accessibilityRole="header">
          Asked to join
        </Txt>
        {requests.length ? (
          requests.map((r) => {
            const name = r.guestName.trim() || 'A neighbor';
            return (
              <View key={r.requestId} style={styles.request}>
                <Avatar name={name} avatarKey={null} size={40} />
                <Txt variant="rowTitle" size={17} numberOfLines={1} style={styles.flex}>
                  {name}
                </Txt>
                <View style={styles.answers}>
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
              </View>
            );
          })
        ) : (
          <Txt variant="body" size={16}>
            {anyIn ? 'No new requests.' : 'No one has asked yet.'}
          </Txt>
        )}
      </View>
    </>
  );
}

export function WhoComing({ dinner }: { dinner: Dinner }) {
  return (
    <View style={styles.section}>
      <Txt variant="heading" accessibilityRole="header">
        Who’s coming
      </Txt>
      <View style={styles.chips}>
        {whoComing(dinner).map((label, i) => (
          <Pill key={`${i}:${label}`} tone="lavender" size="md" label={label} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10, padding: 20, borderRadius: radii.card },
  raised: { backgroundColor: colors.card, boxShadow: shadows.card },
  address: { gap: 2 },
  ask: { gap: 12 },
  section: { gap: 12 },
  request: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  flex: { flex: 1, minWidth: 0 },
  answers: { flexDirection: 'row', gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
