// Everyone in the family, each with a "Message" pill that opens (or starts) a 1:1 chat. That includes
// people on their own phone (`locked`, FEEDBACK-OCT16c E1): the chat is with them, never as them.
//  mode 'members': tapped from the family circle's header ("Family" + faces); I'm listed last as "You".
//                  Looking after the family happens here too (docs/build/FEEDBACK-OCT16c.md B3):
//                  - someone invited the old way who hasn't joined has no pill: the family's join link is the
//                    only way in now (docs/build/JOIN-SIMPLE.md; "Invite family", AddFamilySheet);
//                  - nobody removes anyone else (Caleb, Oct 17): only my own row ("You") has a small
//                    red line. On my own phone it's "Leave the family", which asks first, in the
//                    sheet: "Leave the family?" / "You'll be signed out on this phone. Your messages
//                    stay." with Leave / Stay, then signs this phone out (back to the first screen).
//                    On a phone lent to someone without one (Grandma on Mom's phone) it's "Remove
//                    Grandma from the family" / "Remove Grandma?" with Remove / Keep; the phone stays
//                    in and goes back to its owner. POST /profiles/:id/remove; old messages keep
//                    their name and face.
//  mode 'new':     "New message" from an inbox; only the others ("Hasn't joined yet" still shows).
// Rows follow the inbox rows (52 avatar, 17/700 name, 14 muted line, #EFEFE6 hairlines); cooks first.
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ActionButton, type ActionState, Avatar, BottomSheet, ListCard, ListRow, PressableScale, Txt, useToast } from '@/components/ui';
import { api, errorMessage, type Profile } from '@/lib/api';
import { openChatWith } from '@/lib/messaging';
import { recipesByCook, useLibrary } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import { colors, motion } from '@/theme/tokens';

/** Others first (cooks, then everyone else, in family order). */
export function familyOrder(people: Profile[], meId: string | null | undefined): Profile[] {
  const others = people.filter((p) => p.id !== meId);
  return [...others.filter((p) => p.role === 'cook'), ...others.filter((p) => p.role !== 'cook')];
}

export function MembersSheet(props: {
  visible: boolean;
  onClose: () => void;
  mode?: 'members' | 'new';
  /** The circle's members (defaults to everyone in the family). */
  members?: Profile[];
}) {
  // Every open starts on the list (never on a confirm left over from last time).
  const [opened, setOpened] = useState({ visible: props.visible, n: 0 });
  if (props.visible !== opened.visible) setOpened({ visible: props.visible, n: opened.n + (props.visible ? 1 : 0) });
  return <Members key={opened.n} {...props} />;
}

function Members({
  visible,
  onClose,
  mode = 'members',
  members,
}: {
  visible: boolean;
  onClose: () => void;
  mode?: 'members' | 'new';
  members?: Profile[];
}) {
  const { me, profiles, deviceProfileId, refresh, setMe, leaveFamily } = useSession();
  const { entries } = useLibrary();
  const toast = useToast();
  const { t } = useWords();
  const { height: winH } = useWindowDimensions();
  const [opening, setOpening] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Profile | null>(null);
  const [removeBtn, setRemoveBtn] = useState<ActionState>('idle');
  const [removeError, setRemoveError] = useState<string | null>(null);
  // The confirm holds the list's height, so the sheet doesn't jump.
  const [listH, setListH] = useState(0);

  // The circle's members can be a moment behind the family (someone just removed): the family wins.
  const inFamily = (p: Profile) => p.id === me?.id || !profiles.length || profiles.some((q) => q.id === p.id);
  const all = (members?.length ? members : profiles).filter(inFamily);
  const people = familyOrder(all, me?.id);
  const self = mode === 'members' && me && all.some((p) => p.id === me.id) ? me : null;
  // Inviting and leaving are done as someone (the server needs x-profile-id).
  const manage = mode === 'members' && !!me;
  // Me on my own phone (leaving signs it out), or someone phone-less this phone is lent to. Locked
  // faces are never me, so a phone that's theirs (`has_phone`) is this one.
  const ownPhone = !!me && (me.id === deviceProfileId || !!profiles.find((q) => q.id === me.id)?.has_phone);
  // The circle's member list may not carry `invited`; the family's does.
  const isInvited = (p: Profile) => !!(profiles.find((q) => q.id === p.id) ?? p).invited;

  const message = async (p: Profile) => {
    if (opening) return;
    setOpening(p.id);
    try {
      const id = await openChatWith(p.id);
      onClose();
      router.push({ pathname: '/chat/[id]', params: { id } });
    } catch (e) {
      toast.show(errorMessage(e, t('messages.openFailed')), { tone: 'error' });
    } finally {
      setTimeout(() => setOpening(null), 300);
    }
  };


  const askLeave = () => {
    setRemoveError(null);
    setRemoveBtn('idle');
    setConfirm(me);
  };

  const leave = async () => {
    const p = confirm;
    if (!p || !me || p.id !== me.id || removeBtn !== 'idle') return;
    setRemoveError(null);
    setRemoveBtn('loading');
    const started = Date.now();
    let error: string | null = null;
    try {
      await api.removeProfile(p.id, { profileId: me.id });
    } catch (e) {
      error = errorMessage(e, t('messages.members.leaveFailed'));
    }
    const wait = motion.loadingMinMs - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (error) {
      setRemoveError(error);
      setRemoveBtn('error');
      setTimeout(() => setRemoveBtn((b) => (b === 'error' ? 'idle' : b)), 1800);
      return;
    }
    onClose();
    if (ownPhone) {
      // This phone was signed out with them: back to the first screen (the session gate).
      await leaveFamily();
      return;
    }
    // Lent: the phone stays in. The family reloads without them and nobody is picked, so "/"
    // hands the phone back to its owner (or asks who's cooking on a shared phone).
    toast.show(t('messages.members.left', { name: p.name }));
    await refresh();
    setMe(null);
  };

  const line = (p: Profile) => {
    const n = p.role === 'cook' ? recipesByCook(entries, p.name).length : 0;
    const rel = (p.relation ?? '').trim();
    const recipes = n === 1 ? t('messages.members.recipe', { n }) : t('messages.members.recipes', { n });
    const parts = [rel && rel.toLowerCase() !== p.name.trim().toLowerCase() ? rel : null, n ? recipes : null];
    return parts.filter(Boolean).join(' · ');
  };

  // The words for leaving: my own phone signs out; a lent phone stays in.
  const leaveLink = ownPhone ? t('messages.members.leave') : t('messages.members.removeFrom', { name: me?.name ?? '' });
  const confirmTitle = ownPhone ? t('messages.members.leaveTitle') : t('messages.members.removeTitle', { name: confirm?.name ?? '' });
  const confirmLine = ownPhone ? t('messages.members.leaveLine') : t('messages.members.removeLine');

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={mode === 'members' ? t('messages.family') : t('messages.inbox.newMessage')}
      accessibilityLabel={mode === 'members' ? t('messages.members.label') : t('messages.inbox.newMessage')}>
      {confirm ? (
        <Animated.View entering={FadeIn.duration(180)} style={[styles.confirm, { minHeight: listH }]}>
          <Avatar profile={confirm} size={72} />
          <View style={styles.confirmText}>
            <Txt variant="display" size={26} align="center" accessibilityRole="header">
              {confirmTitle}
            </Txt>
            <Txt variant="body" align="center">
              {confirmLine}
            </Txt>
            {removeError ? (
              <Txt variant="meta" color={colors.danger} align="center">
                {removeError}
              </Txt>
            ) : null}
          </View>
          <View style={styles.choices}>
            <ActionButton
              label={ownPhone ? t('messages.members.leaveButton') : t('messages.members.removeButton')}
              variant="outline"
              size="md"
              fg={colors.danger}
              borderColor={colors.danger}
              labelWeight={700}
              haptics
              state={removeBtn}
              onPress={() => void leave()}
              accessibilityLabel={ownPhone ? t('messages.members.leave') : t('messages.members.removeLabel', { name: confirm.name })}
              accessibilityHint={ownPhone ? t('messages.members.leaveHint') : t('messages.members.removeHint')}
              style={styles.choice}
            />
            <ActionButton
              label={ownPhone ? t('messages.members.stay') : t('messages.members.keep')}
              size="md"
              disabled={removeBtn === 'loading'}
              onPress={() => setConfirm(null)}
              accessibilityLabel={ownPhone ? t('messages.members.stayLabel') : t('messages.members.keepLabel', { name: confirm.name })}
              style={styles.choice}
            />
          </View>
        </Animated.View>
      ) : (
        <ScrollView
          onLayout={(e) => setListH(e.nativeEvent.layout.height)}
          style={[styles.scroll, { maxHeight: Math.max(320, winH * 0.92 - 160) }]}
          contentContainerStyle={styles.pad}
          showsVerticalScrollIndicator={false}>
          {people.length ? (
            <ListCard padH={12}>
              {people.map((p, i) => {
                const sub = line(p);
                const invited = isInvited(p);
                return (
                  <ListRow key={p.id} padV={12} last={!self && i === people.length - 1}>
                    <Avatar profile={p} size={52} />
                    <View style={styles.text}>
                      <Txt variant="title" numberOfLines={1}>
                        {p.name}
                      </Txt>
                      {sub ? (
                        <Txt variant="meta" numberOfLines={1}>
                          {sub}
                        </Txt>
                      ) : null}
                    </View>
                    {invited ? null : (
                      <ActionButton
                        label={t('messages.members.message')}
                        variant="outline"
                        size="sm"
                        padH={16}
                        fg={colors.greenDeep}
                        labelWeight={700}
                        haptics
                        state={opening === p.id ? 'loading' : 'idle'}
                        disabled={!!opening && opening !== p.id}
                        onPress={() => void message(p)}
                        accessibilityLabel={t('messages.chat.message', { name: p.name })}
                      />
                    )}
                  </ListRow>
                );
              })}
              {self ? (
                <ListRow padV={12} last>
                  <Avatar profile={self} size={52} />
                  <View style={styles.text}>
                    <Txt variant="title" numberOfLines={1}>
                      {self.name}
                    </Txt>
                    <Txt variant="meta">{t('messages.members.you')}</Txt>
                    {manage ? (
                      <PressableScale
                        onPress={askLeave}
                        accessibilityRole="button"
                        accessibilityLabel={leaveLink}
                        accessibilityHint={t('messages.members.asksFirst')}
                        hitSlop={{ top: 4, bottom: 4, left: 12, right: 24 }}
                        style={styles.remove}>
                        <Txt variant="meta" weight={600} color={colors.danger}>
                          {leaveLink}
                        </Txt>
                      </PressableScale>
                    ) : null}
                  </View>
                </ListRow>
              ) : null}
            </ListCard>
          ) : (
            <Txt variant="body" align="center" style={styles.empty}>
              {t('messages.members.empty')}
            </Txt>
          )}
        </ScrollView>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { marginHorizontal: -4 },
  pad: { paddingHorizontal: 4, paddingBottom: 12, paddingTop: 2 },
  text: { flex: 1, minWidth: 0, gap: 2, justifyContent: 'center' },
  // A 40 pt row plus 4 pt of slop each way: a 48 pt target that doesn't push the row apart.
  remove: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center' },
  empty: { paddingVertical: 24 },
  confirm: { alignItems: 'center', justifyContent: 'center', gap: 18, paddingVertical: 12 },
  confirmText: { alignItems: 'center', gap: 8, maxWidth: 320 },
  choices: { flexDirection: 'row', gap: 12, alignSelf: 'stretch' },
  choice: { flex: 1 },
});
