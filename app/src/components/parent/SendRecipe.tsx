// "Send a recipe": the big green button on Your recipes. With what useSendable() returns (the
// screen calls it once and passes it in: my recipes, or, for a cook with none yet, the other family
// cooks' recipes) it opens the Spotify-style share sheet (lib/share.tsx), the same one as a
// recipe's share icon: one dish goes straight there; more ask "Which recipe?" first
// (SendRecipesSheet, one tap). No family dishes at all: no button.
import { useMemo, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { ActionButton, SendIcon } from '@/components/ui';
import { recipesByCook, useLibrary } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import { useShare } from '@/lib/share';
import type { LibraryEntry } from '@/lib/types';
import { useWords } from '@/lib/words/useWords';
import { colors } from '@/theme/tokens';

import { SendRecipesSheet } from './SendRecipesSheet';

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** My recipes, else the family's (other cooks in this family). Never strangers' (YouTube, samples). */
export function useSendable(): { dishes: LibraryEntry[]; mine: boolean } {
  const { me, cooks } = useSession();
  const { entries } = useLibrary();
  return useMemo(() => {
    const own = recipesByCook(entries, me?.name);
    if (own.length) return { dishes: own, mine: true };
    const family = new Set(cooks.filter((c) => c.id !== me?.id).map((c) => norm(c.name)));
    const theirs = entries.filter((e) => family.has(norm(e.cook_name)));
    const list = theirs.slice().sort((a, b) => a.cook_name.localeCompare(b.cook_name) || a.title.localeCompare(b.title));
    return { dishes: list, mine: false };
  }, [entries, me?.id, me?.name, cooks]);
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
        icon={<SendIcon size={22} color={colors.card} />}
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
