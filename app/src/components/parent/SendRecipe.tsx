// "Send a recipe": the big green button on Your recipes. With what useSendable() returns (the
// screen calls it once and passes it in: my recipes, or, for a cook with none yet, the other family
// cooks' recipes) it opens the Spotify-style share sheet (lib/share.tsx), the same one as a
// recipe's share icon: one dish goes straight there; more ask "Which recipe?" first
// (SendRecipesSheet, one tap). No family dishes at all: no button.
import { useMemo, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { ActionButton, SendIcon } from '@/components/ui';
import { cookedBy } from '@/lib/familyLibrary';
import { recipesByCook, useLibrary } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import { useShare } from '@/lib/share';
import type { LibraryEntry } from '@/lib/types';
import { useWords } from '@/lib/words/useWords';
import { colors } from '@/theme/tokens';

import { SendRecipesSheet } from './SendRecipesSheet';

/** My recipes, else the family's (other cooks in this family). Never strangers' (YouTube, samples). */
export function useSendable(): { dishes: LibraryEntry[]; mine: boolean } {
  const { me, cooks } = useSession();
  const { entries } = useLibrary();
  const meId = me?.id;
  const meName = me?.name;
  return useMemo(() => {
    const own = meId ? recipesByCook(entries, { id: meId, name: meName ?? '' }) : [];
    if (own.length) return { dishes: own, mine: true };
    const others = cooks.filter((c) => c.id !== meId);
    const theirs = entries.filter((e) => others.some((c) => cookedBy(e, c)));
    const list = theirs.slice().sort((a, b) => a.cook_name.localeCompare(b.cook_name) || a.title.localeCompare(b.title));
    return { dishes: list, mine: false };
  }, [entries, meId, meName, cooks]);
}

export function SendRecipeButton({
  dishes,
  mine,
  style,
}: {
  dishes: LibraryEntry[];
  mine: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const share = useShare();
  const { t } = useWords();
  // A fresh key per open, so the list starts at the top.
  const [sheet, setSheet] = useState({ open: false, n: 0 });
  if (!dishes.length) return null;
  const start = () => {
    if (dishes.length === 1) share.open({ recipeId: dishes[0].id });
    else setSheet((s) => ({ open: true, n: s.n + 1 }));
  };
  return (
    <>
      <ActionButton
        label={t('parent.sendRecipe.button')}
        size="xl"
        icon={<SendIcon size={22} color={colors.ink} />}
        onPress={start}
        accessibilityHint={t(dishes.length === 1 ? 'parent.sendRecipe.hintOne' : 'parent.sendRecipe.hintMany')}
        style={style}
      />
      <SendRecipesSheet
        key={sheet.n}
        visible={sheet.open}
        onClose={() => setSheet((s) => ({ ...s, open: false }))}
        dishes={dishes}
        mine={mine}
        onPick={(dish) => {
          setSheet((s) => ({ ...s, open: false }));
          share.open({ recipeId: dish.id });
        }}
      />
    </>
  );
}
