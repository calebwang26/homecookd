// What a tap on "You" opens under the map: the dinner you host or are in (the dark card, live, with
// "1 new request" for the host), and "Host a dinner". Kept off the map until asked for.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ActionButton, PlusIcon } from '@/components/ui';
import { colors } from '@/theme/tokens';

import { DinnerCard, type DinnerPick } from './DinnerCard';

export function YouCard({ next, now }: { next: DinnerPick | null; now: number }) {
  const id = next ? ('mine' in next ? next.mine.dinnerId : next.feed.dinnerId) : null;
  return (
    <View style={styles.wrap}>
      {next && id ? (
        <DinnerCard key={id} pick={next} now={now} onOpen={() => router.push({ pathname: '/dinner/[id]', params: { id } })} />
      ) : null}
      <ActionButton
        label="Host a dinner"
        variant="outline"
        size="sm"
        icon={<PlusIcon size={20} color={colors.ink} strokeWidth={2.2} />}
        onPress={() => router.push('/dinner/new')}
      />
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { gap: 12 } });
