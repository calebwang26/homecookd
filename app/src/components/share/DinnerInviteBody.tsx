// The share sheet as a dinner invite ("Invite friends" on a dinner page; Caleb's final canvas B): the big
// card with the dish photo, "Jollof Rice Night" and "Hosted by Mom", no family faces, then the app row
// (Copy link, Messages, WhatsApp when the phone has it, More). Every way out sends "Come to Jollof Rice
// Night with Mom: https://homecookd.app/d?t=…", the dinner's one invite link (dinners.inviteLink, asked
// as the sheet opens). Whoever opens it counts in the dinner's "X going".
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { inviteText } from '@/components/community/invite';
import { nightTitle } from '@/components/community/labels';
import { inviteLink, type InviteLink } from '@/lib/live/community';
import { alpha } from '@/theme/tokens';

import { ExternalRow } from './ExternalRow';
import { useRowMetrics } from './RoundTarget';
import { BYLINE_EXTRA, ShareCard, stageFor } from './ShareCard';
import { trail } from './trail';

export type DinnerInvite = { dinnerId: string; dish: string; hostName: string; photo: string | null };

const PHOTO_MIN = 64;

export function DinnerInviteBody({ dinner }: { dinner: DinnerInvite }) {
  const { height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { circle } = useRowMetrics();
  const linkRef = useRef<Promise<InviteLink> | null>(null);
  const { dinnerId, dish, hostName, photo: poster } = dinner;
  const host = hostName.trim();
  const title = nightTitle(dish);

  // Asked as the sheet opens, so the link is ready by the time a finger lands on the row.
  useEffect(() => {
    const p = inviteLink(dinnerId);
    p.then(
      () => trail('invite link ready'),
      () => trail('invite link failed (shown on tap)'),
    );
    linkRef.current = p;
  }, [dinnerId]);
  const getUrl = useCallback(async () => {
    try {
      return (await (linkRef.current ?? inviteLink(dinnerId))).url;
    } catch {
      const p = inviteLink(dinnerId); // one more try on tap
      linkRef.current = p;
      return (await p).url;
    }
  }, [dinnerId]);
  const text = useCallback((url: string) => inviteText(dish, host, url), [dish, host]);

  // The share sheet's budget (ShareSheet.tsx), with no swatches or faces: the card takes the rest,
  // with room for "Hosted by …" on two lines.
  const bodyMax = winH * 0.92 - 28 - (Math.max(insets.bottom, 16) + 8);
  const budget = bodyMax - (1 + 12 + rowHeight(circle)) - 12;
  const compact = budget < 300;
  const room = budget - stageFor(0, compact) - BYLINE_EXTRA;
  const photo = room < PHOTO_MIN ? 0 : Math.round(Math.min(168, room));

  return (
    <View style={styles.bleed}>
      <View style={styles.body}>
        <ShareCard
          data={{ title, cook: host || null, time: null, poster, byline: host ? `Hosted by ${host}` : undefined }}
          swatch="peach"
          photo={photo}
          stageHeight={stageFor(photo, compact) + BYLINE_EXTRA}
          compact={compact}
        />
      </View>
      <View style={styles.hairline} />
      <View style={styles.pinned}>
        <ExternalRow getUrl={getUrl} text={text} title={title} sentLabel="Invite sent" omit={['instagram']} onTrace={trail} />
      </View>
    </View>
  );
}

// One row of round targets (RoundTarget): 6 + circle + 8 + 18 label + 6.
const rowHeight = (circle: number) => 6 + circle + 8 + 18 + 6;

const styles = StyleSheet.create({
  bleed: { marginHorizontal: -24 },
  body: { paddingHorizontal: 24, paddingBottom: 12 },
  hairline: { height: 1, backgroundColor: alpha.hairline },
  pinned: { paddingTop: 12 },
});
