// A face on "Who's in the kitchen?" that this phone can't come in as (docs/build/FEEDBACK-OCT16c.md
// E1, B3). A small sheet: their face, one sentence, at most one button.
//   locked   They use their own phone (only that phone can be them): "Dad uses their own phone."
//            Then up to 3 of their dishes ("Dad's recipes", QA B03), then Message Dad. Both stay as
//            whoever is in now (the one who opened "Who's in the kitchen?", e.g. Leo on Mom's phone
//            or on a shared family-code phone), else this phone's own person, and land on top of
//            their home, so Back goes home: a dish opens where that person's dishes open
//            (lib/navigation openRecipe), Message opens (or starts) the 1:1 chat with Dad
//            (lib/messaging openChatWith). Nobody in yet and no person of its own (a cold start on a
//            shared phone, or one that came in through a family invite and hasn't added itself):
//            nobody to come in as, so no dishes, no button.
//   invited  Invited the old way (one named person) and not joined yet: "Dad hasn't joined yet." (no button:
//            the family's join link is the only way in now, docs/build/JOIN-SIMPLE.md)
//            as this phone's person, else whoever was picked last. Nobody to send as: no button.
//
//   <PersonSheet visible person={dad} onClose={...} />
//
// It starts fresh on every open, and keeps showing `person` while it slides away.
import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ErrorLine } from '@/components/signin/SignInScreen';
import { ActionButton, type ActionState, ArrowRightIcon, Avatar, BottomSheet, ChatIcon, NoPhoto, PressableScale, Txt } from '@/components/ui';
import { errorMessage, type Profile } from '@/lib/api';
import { openChatWith } from '@/lib/messaging';
import { openRecipe } from '@/lib/navigation';
import { recipesByCook, useLibrary, type LibraryEntry } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import { colors, motion, radii } from '@/theme/tokens';

/** The chat (or dish) opens on top of their home once it shows, so Back lands there (as _layout's after-pick). */
const CHAT_AFTER_HOME_MS = 350;
/** Dishes on a locked cook's sheet. */
const MAX_DISHES = 3;

/** The sheet slides away first (no screen change under a closing Modal), then home, then `next`. */
function homeThen(home: Href, next: () => void) {
  setTimeout(() => {
    if (router.canDismiss()) router.dismissAll();
    router.replace(home);
    setTimeout(next, CHAT_AFTER_HOME_MS);
  }, motion.sheetCloseMs + 20);
}

export type PersonSheetProps = {
  visible: boolean;
  /** Someone locked to their own phone, or invited and not joined yet. */
  person: Profile | null;
  onClose: () => void;
};

export function PersonSheet(props: PersonSheetProps) {
  const [opened, setOpened] = useState({ visible: props.visible, n: 0 });
  if (props.visible !== opened.visible) setOpened({ visible: props.visible, n: opened.n + (props.visible ? 1 : 0) });
  return <Person key={opened.n} {...props} />;
}

function Person({ visible, person, onClose }: PersonSheetProps) {
  const { me, profiles, deviceProfileId, setMe, homeFor } = useSession();
  const { entries } = useLibrary();
  const { t } = useWords();
  const [btn, setBtn] = useState<ActionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  // A dish was tapped and the sheet is on its way out: further taps (a dish or Message) do nothing.
  const leaving = useRef(false);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  useEffect(() => {
    if (btn !== 'error') return;
    const t = setTimeout(() => setBtn((b) => (b === 'error' ? 'idle' : b)), 1800);
    return () => clearTimeout(t);
  }, [btn]);

  // Someone this phone can be (never someone only invited or locked).
  const usable = (id: string | null | undefined) => (id ? (profiles.find((p) => p.id === id && !p.invited && !p.locked) ?? null) : null);
  const own = usable(deviceProfileId);
  if (!person) return null;
  const dishes = recipesByCook(entries, person.name).slice(0, MAX_DISHES);
  const invited = !!person.invited && !person.locked;
  // Dishes & Message stay as whoever is in (a kid on a lent or shared phone stays the kid, kid QA
  // Oct 21), as the Home's table faces do; an old-style invite goes from this phone's own person first.
  const sender = invited ? (own ?? usable(me?.id)) : (usable(me?.id) ?? own);
  const name = person.name.trim();

  const settle = async (started: number) => {
    const wait = motion.loadingMinMs - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  };

  async function message() {
    if (!sender || !person || btn !== 'idle' || leaving.current) return;
    setError(null);
    setBtn('loading');
    const started = Date.now();
    setMe(sender);
    let threadId: string;
    try {
      threadId = await openChatWith(person.id);
    } catch (e) {
      await settle(started);
      if (!alive.current) return;
      setError(errorMessage(e, t('profiles.person.didntOpen')));
      setBtn('error');
      return;
    }
    onClose();
    homeThen(homeFor(sender), () => router.push({ pathname: '/chat/[id]', params: { id: threadId } }));
  }

  // One of their dishes: in as this phone's person, home, then the dish on top.
  function openDish(d: LibraryEntry) {
    if (!sender || btn !== 'idle' || leaving.current) return;
    leaving.current = true;
    setMe(sender);
    onClose();
    homeThen(homeFor(sender), () => openRecipe(router, d.id));
  }

  // A no-break space keeps the last two words together (never a lone "phone." on its own line).
  const title = invited ? t('profiles.person.invitedTitle', { name }) : t('profiles.person.lockedTitle', { name });

  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={title}>
      <View style={styles.body}>
        <Avatar profile={person} size={88} />
        <Txt variant="display" size={28} leading={1.15} align="center" accessibilityRole="header" style={styles.title}>
          {title}
        </Txt>
        {sender && !invited && dishes.length ? (
          <View style={styles.dishes} accessibilityLabel={t('profiles.person.recipes', { name })}>
            <Txt variant="heading" accessibilityRole="header">
              {t('profiles.person.recipes', { name })}
            </Txt>
            {dishes.map((d) => (
              <DishRow key={d.id} dish={d} onOpen={openDish} />
            ))}
          </View>
        ) : null}
        {sender ? (
          <View style={styles.actions}>
            {invited ? null : (
              <ActionButton
                label={t('profiles.person.message', { name })}
                size="xl"
                icon={<ChatIcon size={22} color={colors.ink} />}
                state={btn}
                onPress={() => void message()}
                accessibilityHint={t('profiles.person.messageHint', { name })}
              />
            )}
            <ErrorLine error={error} align="center" />
          </View>
        ) : null}
      </View>
    </BottomSheet>
  );
}

/** A dish row, as in "Which recipe?" (SendRecipesSheet): thumb, title, arrow. */
function DishRow({ dish, onOpen }: { dish: LibraryEntry; onOpen: (d: LibraryEntry) => void }) {
  const { t } = useWords();
  return (
    <PressableScale haptic scaleTo={0.98} onPress={() => onOpen(dish)} accessibilityRole="link" accessibilityLabel={t('profiles.person.openDish', { title: dish.title })} style={styles.row}>
      <View style={styles.thumb}>
        {dish.poster_url ? (
          <Image source={{ uri: dish.poster_url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} recyclingKey={dish.id} />
        ) : (
          <NoPhoto title={dish.title} size={56} />
        )}
      </View>
      <Txt variant="rowTitle" size={17} numberOfLines={2} style={styles.rowText}>
        {dish.title}
      </Txt>
      <ArrowRightIcon size={20} color={colors.ink} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', gap: 18, paddingTop: 8, paddingBottom: 4 },
  dishes: { alignSelf: 'stretch', marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8, minHeight: 64 },
  rowText: { flex: 1, minWidth: 0 },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: radii.tile,
    overflow: 'hidden',
    backgroundColor: colors.well,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Clear of the sheet's round close button on both sides, so it stays centred.
  title: { paddingHorizontal: 36 },
  actions: { alignSelf: 'stretch', gap: 10, marginTop: 6 },
});
