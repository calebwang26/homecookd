// The family's dishes as a pickable list, shared by the Ask sheet and the chat composer's "+".
//  - DishList: Browse-style rows in a ListCard (64 thumb radius 18, 16/700 title, 14 muted "by Dad",
//    "Your recipe" for the cook's own); extra rows (the Ask sheet's "Something else") go after it.
//  - RecipePickerSheet: bottom sheet "Attach a recipe". A small search field shows once the family
//    has more than a handful of dishes; the dish already attached carries a green check. Picking one
//    calls onPick (the caller closes the sheet and puts the dish in the composer).
//  - AttachButton: the composer's round "+" (accessibilityLabel "Attach a recipe", haptic on press).
import { Image } from 'expo-image';
import { useEffect, useState, type ReactNode } from 'react';
import { Keyboard, Platform, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import {
  BottomSheet,
  CheckIcon,
  ChevronRightIcon,
  IconButton,
  ListCard,
  ListRow,
  PlusIcon,
  SearchIcon,
  Txt,
  type IconButtonTone,
} from '@/components/ui';
import { useSession } from '@/lib/session';
import type { LibraryEntry } from '@/lib/types';
import { useWords } from '@/lib/words/useWords';
import { colors, fonts } from '@/theme/tokens';

import { useDishLookup } from './dishes';
import { dishName, isCookOf } from './helpers';

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
/** The search field shows once there are more dishes than this. */
const SEARCH_AFTER = 6;

/**
 * The family's own dishes (by cooks in this family, mine first), else everything in the library.
 * Sorted by cook, then title.
 */
export function useFamilyDishes(): LibraryEntry[] {
  const { cooks, me } = useSession();
  const { entries } = useDishLookup();
  const family = new Set(cooks.map((c) => norm(c.name)));
  const own = entries.filter((e) => family.has(norm(e.cook_name)));
  return (own.length ? own : entries)
    .slice()
    .sort(
      (a, b) =>
        Number(isCookOf(b, me)) - Number(isCookOf(a, me)) || a.cook_name.localeCompare(b.cook_name) || a.title.localeCompare(b.title),
    );
}

/** The dishes as rows. `children` (more rows) go after the last dish, inside the same card. */
export function DishList({
  dishes,
  onPick,
  rowLabel,
  chevron = true,
  selectedId,
  children,
}: {
  dishes: LibraryEntry[];
  onPick: (entry: LibraryEntry) => void;
  rowLabel: (entry: LibraryEntry) => string;
  chevron?: boolean;
  selectedId?: string | null;
  children?: ReactNode;
}) {
  const { me } = useSession();
  return (
    <ListCard padH={12}>
      {dishes.map((d, i) => (
        <DishRow
          key={d.id}
          entry={d}
          mine={isCookOf(d, me)}
          label={rowLabel(d)}
          chevron={chevron}
          selected={!!selectedId && d.id === selectedId}
          last={!children && i === dishes.length - 1}
          onPress={() => onPick(d)}
        />
      ))}
      {children}
    </ListCard>
  );
}

function DishRow({
  entry,
  mine,
  label,
  chevron,
  selected,
  last,
  onPress,
}: {
  entry: LibraryEntry;
  mine: boolean;
  label: string;
  chevron: boolean;
  selected: boolean;
  last: boolean;
  onPress: () => void;
}) {
  const { t } = useWords();
  return (
    <ListRow padV={8} last={last} onPress={onPress} accessibilityLabel={selected ? t('messages.picker.attached', { dish: dishName(entry) }) : label}>
      {entry.poster_url ? (
        <Image source={{ uri: entry.poster_url }} style={styles.thumb} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]} />
      )}
      <View style={styles.rowText}>
        <Txt variant="rowTitle" numberOfLines={2}>
          {dishName(entry)}
        </Txt>
        <Txt variant="meta">{mine ? t('messages.bubble.yourRecipe') : t('messages.bubble.byCook', { name: entry.cook_name })}</Txt>
      </View>
      {selected ? (
        <CheckIcon size={22} color={colors.green} strokeWidth={2.4} />
      ) : chevron ? (
        <ChevronRightIcon size={22} color={colors.muted} strokeWidth={2.2} />
      ) : null}
    </ListRow>
  );
}

/** "Attach a recipe": the family's dishes; picking one hands it to `onPick`. */
export function RecipePickerSheet({
  visible,
  onClose,
  onPick,
  selectedId,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (entry: LibraryEntry) => void;
  selectedId?: string | null;
}) {
  const dishes = useFamilyDishes();
  const { t } = useWords();
  const { height: winH } = useWindowDimensions();
  const kb = useKeyboardHeight(visible);
  const [query, setQuery] = useState('');
  // Every open starts with an empty search.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setQuery('');
  }
  const searchable = dishes.length > SEARCH_AFTER;
  const q = norm(query);
  const shown = q ? dishes.filter((d) => norm(d.title).includes(q) || norm(d.cook_name).includes(q)) : dishes;
  // Room for the title and search above, and the keyboard below while searching.
  const listMax = Math.max(160, winH * 0.92 - (searchable ? 290 : 230) - kb);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('messages.picker.title')} accessibilityLabel={t('messages.picker.title')}>
      {searchable ? (
        <View style={styles.search}>
          <SearchIcon size={18} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('messages.picker.search')}
            placeholderTextColor={colors.muted}
            accessibilityLabel={t('messages.picker.searchLabel')}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            selectionColor={colors.yolkDeep}
            style={styles.searchInput}
          />
        </View>
      ) : null}
      <ScrollView
        style={[styles.scroll, { maxHeight: listMax }]}
        contentContainerStyle={styles.scrollPad}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {shown.length ? (
          <DishList dishes={shown} onPick={onPick} rowLabel={(d) => t('messages.picker.attach', { dish: dishName(d) })} chevron={false} selectedId={selectedId} />
        ) : (
          <Txt variant="body" size={15} align="center" style={styles.empty}>
            {dishes.length ? t('messages.picker.noMatch', { query: query.trim() }) : t('messages.picker.none')}
          </Txt>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

/** The composer's round "+": opens the recipe picker. */
export function AttachButton({
  onPress,
  tone = 'cream',
  size = 48,
}: {
  onPress: () => void;
  tone?: IconButtonTone;
  size?: number;
}) {
  const { t } = useWords();
  return (
    <IconButton
      icon={(c) => <PlusIcon size={size >= 56 ? 26 : 24} color={c} strokeWidth={2.2} />}
      tone={tone}
      size={size}
      haptic
      accessibilityLabel={t('messages.picker.title')}
      onPress={() => {
        Keyboard.dismiss();
        onPress();
      }}
    />
  );
}

/** The keyboard's height while `active` (0 when it's down), so the list never hides behind it. */
function useKeyboardHeight(active: boolean): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    if (!active) return;
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setH(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setH(0));
    return () => {
      show.remove();
      hide.remove();
      setH(0);
    };
  }, [active]);
  return h;
}

const styles = StyleSheet.create({
  scroll: { marginHorizontal: -4 },
  scrollPad: { paddingHorizontal: 4, paddingBottom: 12, paddingTop: 2 },
  thumb: { width: 64, height: 64, borderRadius: 18, backgroundColor: colors.well },
  thumbEmpty: { backgroundColor: colors.well },
  rowText: { flex: 1, minWidth: 0, gap: 3, justifyContent: 'center' },
  search: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: colors.well,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    padding: 0,
    fontFamily: fonts.sans,
    fontSize: 16,
    color: colors.ink,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  empty: { paddingVertical: 24 },
});
