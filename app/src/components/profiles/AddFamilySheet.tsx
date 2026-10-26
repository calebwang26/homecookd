// "+ Add family" / "Invite family": a Spotify-style share sheet with no questions
// (docs/build/FEEDBACK-OCT16c.md E2; the logic is lib/invites.ts).
//
//   ┌──────────── grabber ──────── (x) ┐
//   │  ┌──────── peach stage ───────┐  │  InviteCard: the family round a table with the pot in
//   │  │   (Mom)  (pot)  (Dad)      │  │  the middle and one open seat at the front,
//   │  │  Join The Wangs on homecookd │  "Join <Family> on homecookd"
//   │  └────────────────────────────┘  │
//   ├──────────────────────────────────┤
//   │  (⛓) (✉) (◎) (✆) (…)            │  the app row (components/share/ExternalRow, the same one as
//   │  Copy link Messages Instagram …  │  the recipe share sheet): Copy link, Messages, Instagram,
//   ├──────────────────────────────────┤  WhatsApp (when it can open), More
//   │  No phone? Add them to this phone│  for Grandpa Joe: closes this sheet and opens "Add someone
//   └──────────────────────────────────┘  without a phone" (AddPhonelessSheet) in its place. Not on a
//                                         phone that hasn't added itself yet (deviceNeedsProfile).
//                                         After adding, the same person stays in (Done), or "Switch
//                                         to Grandpa Joe" cooks as him from his home.
//
// One family invite per opening (POST /invites {}: one use, 14 days), made on the first tap and
// reused by every button after it; the next opening makes a new link. Opening the sheet writes
// nothing. The text: "Join our family table on homecookd: <url>". Whoever opens the link picks
// their own name and role (E3), so there are no inputs, no role choice and no contact picker.
//
// The sender (the /i page says "Mom invited you.") is the current person, else whoever
// signed in on this phone, else the only person here. On an older family-code phone with nobody
// picked, a tap says "Tap your face first, then invite family."
//
// Reusable anywhere: <AddFamilySheet visible onClose />. `initialRole` is accepted and ignored.
// Someone invited the old way who hasn't joined gets "Send again" elsewhere (lib/invites sendInvite).
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ExternalRow } from '@/components/share/ExternalRow';
import { cooksFirst } from '@/components/share/FamilyRow';
import { InviteCard } from '@/components/share/InviteCard';
import { BottomSheet, PlusIcon, PressableScale, Txt } from '@/components/ui';
import type { Profile, Role } from '@/lib/api';
import { createFamilyInvite, familyInviteText } from '@/lib/invites';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import { alpha, colors, motion } from '@/theme/tokens';

import { AddPhonelessSheet } from './AddPhonelessSheet';

export type AddFamilySheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Accepted and ignored: whoever opens the link picks their own role. */
  initialRole?: Role;
  /**
   * "Switch to Grandpa Joe" after adding someone without a phone. Default: cook as them, from
   * their home (the picker passes its own hand-off).
   */
  onSwitch?: (them: Profile) => void;
};

export function AddFamilySheet(props: AddFamilySheetProps) {
  // A fresh sheet (and so a fresh link) on every opening.
  const [opened, setOpened] = useState({ visible: props.visible, n: 0 });
  if (props.visible !== opened.visible) setOpened({ visible: props.visible, n: opened.n + (props.visible ? 1 : 0) });
  return <InviteSheet key={opened.n} {...props} />;
}

function InviteSheet({ visible, onClose, onSwitch }: AddFamilySheetProps) {
  const { me, profiles, family, deviceProfileId, deviceNeedsProfile, setMe, homeFor } = useSession();
  const { t } = useWords();
  // 'phoneless': this sheet slid away for "Add someone without a phone"; it opens once it's gone.
  const [step, setStep] = useState<'invite' | 'phoneless'>('invite');
  const [phonelessOpen, setPhonelessOpen] = useState(false);
  useEffect(() => {
    if (step !== 'phoneless') return;
    const t = setTimeout(() => setPhonelessOpen(true), motion.sheetCloseMs + 40);
    return () => clearTimeout(t);
  }, [step]);
  const switchTo = (them: Profile) => {
    onClose();
    if (onSwitch) return onSwitch(them);
    // No screen change under a closing Modal: go once the sheet is gone.
    setTimeout(() => {
      if (router.canDismiss()) router.dismissAll();
      setMe(them);
      router.replace(homeFor(them));
    }, motion.sheetCloseMs + 40);
  };

  // Who sends it: me, else whoever signed in on this phone, else the only person here. Never
  // someone only invited, or someone whose own phone isn't this one (the server refuses that).
  const joined = profiles.filter((p) => !p.invited && !p.locked);
  const from = me?.id ?? joined.find((p) => p.id === deviceProfileId)?.id ?? (joined.length === 1 ? joined[0].id : null);

  // The link for this opening: made on the first tap, shared by every tap after it. A failure
  // forgets it, so the next tap asks again.
  const link = useRef<Promise<string> | null>(null);
  const getUrl = useCallback(() => {
    if (!link.current) {
      const p = createFamilyInvite(from).then((i) => i.url);
      link.current = p;
      p.catch(() => {
        if (link.current === p) link.current = null;
      });
    }
    return link.current;
  }, [from]);

  const people = useMemo(() => cooksFirst(profiles), [profiles]);

  return (
    <>
      <BottomSheet visible={visible && step === 'invite'} onClose={onClose} accessibilityLabel={t('profiles.invite.label')} contentStyle={styles.sheetContent}>
        <View style={styles.bleed}>
          <View style={styles.cardWrap}>
            <InviteCard familyName={family?.name ?? null} people={people} />
          </View>
          <View style={styles.hairline} />
          <View style={styles.row}>
            <ExternalRow getUrl={getUrl} text={familyInviteText} title={t('profiles.invite.shareTitle')} sentLabel={t('profiles.invite.sent')} />
          </View>
          {deviceNeedsProfile ? null : (
            <>
              <View style={styles.hairline} />
              <PressableScale
                onPress={() => setStep('phoneless')}
                accessibilityRole="button"
                accessibilityLabel={t('profiles.invite.noPhone')}
                accessibilityHint={t('profiles.invite.noPhoneHint')}
                style={styles.phoneless}>
                <PlusIcon size={18} color={colors.greenDeep} />
                <Txt variant="label" weight={700} color={colors.greenDeep}>
                  {t('profiles.invite.noPhone')}
                </Txt>
              </PressableScale>
            </>
          )}
        </View>
      </BottomSheet>
      <AddPhonelessSheet visible={visible && phonelessOpen} onClose={onClose} onSwitch={switchTo} />
    </>
  );
}

const styles = StyleSheet.create({
  sheetContent: { paddingTop: 4 },
  // Full sheet width so the hairline and the app row can run edge to edge.
  bleed: { marginHorizontal: -24 },
  cardWrap: { paddingHorizontal: 24, paddingBottom: 18 },
  hairline: { height: 1, backgroundColor: alpha.hairline },
  row: { paddingTop: 12, paddingBottom: 8 },
  phoneless: { minHeight: 56, marginTop: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24 },
});
