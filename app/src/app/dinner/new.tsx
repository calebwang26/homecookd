// Host a Community dinner (dinners.create): the dish (one of the family's shared recipes, or another
// family's dish they said yes to cooking with us; none yet = ask the cook to share one first), the day
// and time, the kind of place (campus kitchen first, home
// last), its public name, the exact address (private: only guests the host says yes to see it) and
// the seats. Then it opens the new dinner's page. `?recipeId=` picks the dish to start with (a tap on
// "Host a dinner" from that dish's card on the map).
import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { ChipRow } from '@/components/community/ChipRow';
import { useFamilyRecipes, useNow } from '@/components/community/data';
import { goBack } from '@/components/community/DetailPage';
import { dayOptions, errorText, firstOpenDay, PLACE_KINDS, startsAt, TIMES } from '@/components/community/labels';
import { SignInField } from '@/components/signin';
import { ActionButton, BackPill, CheckIcon, Chip, IconButton, Pill, PlusIcon, PressableScale, ScreenWash, Skeleton, Txt, useToast } from '@/components/ui';
import { createDinner, useMySwaps, type PlaceKind } from '@/lib/live/community';
import { colors, radii, shadows, space } from '@/theme/tokens';

const DEFAULT_TIME = { hour: 19, minute: 0 };
const MIN_SEATS = 1;
const MAX_SEATS = 20;

const MinusIcon = ({ color }: { color: string }) => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round">
    <Path d="M5 12h14" />
  </Svg>
);

const timeKey = (t: { hour: number; minute: number }) => t.hour * 60 + t.minute;

export default function NewDinner() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const now = useNow();
  const rows = useFamilyRecipes();
  const swaps = useMySwaps();
  // Our shared dishes, then the ones another family said yes to cooking with us.
  const ours = (rows ?? []).filter((r) => r.status === 'ready' && !!r.sharedAt).map((r) => ({ _id: r._id, title: r.title }));
  const together = swaps.flatMap((s) =>
    s.kind === 'cook' && s.status === 'accepted' && !s.incoming && s.theirDish ? [{ _id: s.theirDish.recipeId, title: s.theirDish.dish }] : [],
  );
  const shared = [...ours, ...together.filter((t) => !ours.some((r) => r._id === t._id))];

  const params = useLocalSearchParams<{ recipeId?: string }>();
  const [recipeId, setRecipeId] = useState<string | null>(typeof params.recipeId === 'string' ? params.recipeId : null);
  const dish = shared.find((r) => r._id === recipeId) ?? shared[0] ?? null;

  // Only days and times still ahead; a choice that just passed falls to the next one.
  const [picked, setPicked] = useState(() => ({ day: firstOpenDay(Date.now(), DEFAULT_TIME.hour, DEFAULT_TIME.minute), time: timeKey(DEFAULT_TIME) }));
  const ahead = (offset: number, t: { hour: number; minute: number }) => startsAt(now, offset, t.hour, t.minute) > now;
  const days = dayOptions(now).filter((d) => TIMES.some((t) => ahead(d.offset, t)));
  const day = days.find((d) => d.offset === picked.day) ?? days[0];
  const times = TIMES.filter((t) => ahead(day.offset, t));
  const time = times.find((t) => timeKey(t) === picked.time) ?? times[0];

  const [placeKind, setPlaceKind] = useState<PlaceKind>('campus_kitchen');
  const [placeName, setPlaceName] = useState('');
  const [address, setAddress] = useState('');
  const [seats, setSeats] = useState(6);
  const ready = !!dish && !!placeName.trim() && !!address.trim();

  const host = async () => {
    if (!dish) return;
    try {
      const id = await createDinner({
        recipeId: dish._id,
        startsAt: startsAt(now, day.offset, time.hour, time.minute),
        placeKind,
        placeName: placeName.trim(),
        address: address.trim(),
        seats,
      });
      router.replace({ pathname: '/dinner/[id]', params: { id } });
    } catch (e) {
      toast.show(errorText(e), { tone: 'error' });
      throw e;
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingTop: Math.max(space.topDetail, insets.top + 9), paddingBottom: Math.max(40, insets.bottom + 24) }]}>
        <ScreenWash tone="kid" height={300} />
        <BackPill onPress={() => goBack()} />
        <Txt variant="display" size={32} accessibilityRole="header">
          Host a dinner
        </Txt>

        <Section title="Dish">
          {rows === null ? (
            <Skeleton width="60%" height={40} radius={radii.pill} />
          ) : shared.length ? (
            <View style={styles.dishes} accessibilityRole="radiogroup" accessibilityLabel="Dish">
              {shared.map((r) => {
                const on = r._id === dish?._id;
                return (
                  <PressableScale
                    key={r._id}
                    haptic
                    scaleTo={0.98}
                    onPress={() => setRecipeId(r._id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={r.title}
                    style={[styles.dish, on ? styles.dishOn : null]}>
                    <Txt variant="rowTitle" size={17} color={on ? colors.card : colors.ink} numberOfLines={2} style={styles.flex}>
                      {r.title}
                    </Txt>
                    {on ? <CheckIcon size={18} color={colors.card} /> : null}
                  </PressableScale>
                );
              })}
            </View>
          ) : (
            <View style={styles.share}>
              <Txt variant="title" color={colors.lavenderInk}>
                Share a recipe first
              </Txt>
              <Txt variant="body" leading={1.4} color={colors.lavenderInk}>
                Your family’s cook turns on “Share with people nearby” on one of their recipes.
              </Txt>
            </View>
          )}
        </Section>

        <Section title="When">
          <ChipRow
            accessibilityLabel="Day"
            items={days.map((d) => ({ key: d.offset, label: d.label }))}
            selected={day.offset}
            onSelect={(offset) => setPicked((p) => ({ ...p, day: offset }))}
          />
          <ChipRow
            accessibilityLabel="Time"
            items={times.map((t) => ({ key: timeKey(t), label: t.label }))}
            selected={timeKey(time)}
            onSelect={(key) => setPicked((p) => ({ ...p, time: key }))}
          />
        </Section>

        <Section title="Where">
          <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Kind of place">
            {PLACE_KINDS.map((p) => (
              <Chip key={p.key} label={p.label} selectedTone="ink" selected={p.key === placeKind} onPress={() => setPlaceKind(p.key)} />
            ))}
          </View>
          <Txt variant="label" size={16} style={styles.label}>
            Place name
          </Txt>
          <SignInField
            value={placeName}
            onChangeText={setPlaceName}
            placeholder="Baker House kitchen"
            accessibilityLabel="Place name"
            autoCapitalize="words"
            maxLength={200}
            returnKeyType="next"
          />
          <View style={styles.private}>
            <Txt variant="label" size={16}>
              Exact address
            </Txt>
            <Pill tone="butter" size="xs" label="Private" />
          </View>
          <SignInField
            value={address}
            onChangeText={setAddress}
            placeholder="Street, building, room"
            accessibilityLabel="Exact address, private"
            accessibilityHint="Only guests you say yes to see it"
            maxLength={200}
            returnKeyType="done"
          />
          <Txt variant="caption">Only guests you say yes to see it.</Txt>
        </Section>

        <Section title="Seats">
          <View style={styles.stepper}>
            <View style={seats <= MIN_SEATS ? styles.dim : null}>
              <IconButton
                accessibilityLabel="One seat fewer"
                icon={(c) => <MinusIcon color={c} />}
                disabled={seats <= MIN_SEATS}
                onPress={() => setSeats((n) => Math.max(MIN_SEATS, n - 1))}
              />
            </View>
            <Txt variant="display" size={32} style={styles.seats} accessibilityLabel={`${seats} seats`} accessibilityLiveRegion="polite">
              {seats}
            </Txt>
            <View style={seats >= MAX_SEATS ? styles.dim : null}>
              <IconButton
                accessibilityLabel="One seat more"
                icon={(c) => <PlusIcon size={22} strokeWidth={2.2} color={c} />}
                disabled={seats >= MAX_SEATS}
                onPress={() => setSeats((n) => Math.min(MAX_SEATS, n + 1))}
              />
            </View>
          </View>
        </Section>

        <ActionButton label="Host this dinner" disabled={!ready} onPress={host} loadingLabel="Hosting…" style={styles.go} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Txt variant="heading" accessibilityRole="header">
        {title}
      </Txt>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: space.gutter, gap: 28 },
  section: { gap: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  dishes: { gap: space.sm },
  dish: {
    minHeight: 60,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: radii.quote,
    backgroundColor: colors.card,
    boxShadow: shadows.person,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dishOn: { backgroundColor: colors.ink },
  flex: { flex: 1, minWidth: 0 },
  share: { gap: 6, padding: 20, borderRadius: radii.card, backgroundColor: colors.lavender },
  label: { marginTop: 4 },
  private: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  seats: { minWidth: 44, textAlign: 'center' },
  dim: { opacity: 0.4 },
  go: { marginTop: 4 },
});
