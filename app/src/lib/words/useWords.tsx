// Which language the app's own words read in, for whoever is on this phone (lib/words/words.ts):
//   a cook       her saved language (people.language), once she picked it on the language screen
//                (components/language/LanguageTiles) or anywhere else; until then the phone's language.
//                A dropped one reads as its stand-in (Marathi → Hindi, lib/languages activeLanguage), and
//                counts as picked, so she never sees the language screen again for it
//   a kid        English (the kid side stays English)
//   nobody yet   the phone's language (sign-in, an invite, "Before we start", "Who's in the kitchen?")
// Kept per person on this phone (kv `language.ui.<profileId>`), so her words come up at once on launch, before
// Convex answers; `language.chosen.<profileId>` marks that she picked, so English counts as a pick too.
//
//   const { t } = useWords();   <Txt>{t('parent.tab.home')}</Txt>
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { activeLanguage } from '@/lib/languages';
import { setLanguage, useMe } from '@/lib/live/convex';
import { useSession } from '@/lib/session';
import { kvGet, kvSet } from '@/lib/storage';

import { deviceUiLanguage } from './device';
import { RtlContext, TContext } from './context';
import { isRtl, wordsFor, type T } from './words';

const chosenKey = (profileId: string) => `language.chosen.${profileId}`;
const uiKey = (profileId: string) => `language.ui.${profileId}`;

type UiLanguage = {
  lang: string;
  t: T;
  rtl: boolean;
  /** A cook who hasn't picked her language yet: the language screen shows before her home. */
  needsChoice: boolean;
  /** Her pick (the language screen, the recording sheet, "Your language"): the app switches at once and Convex
   *  saves it (throws when it didn't; this phone keeps her pick either way). */
  choose: (code: string) => Promise<'saved' | 'stub' | undefined>;
};

const english = wordsFor('en');
const Ctx = createContext<UiLanguage>({ lang: 'en', t: english, rtl: false, needsChoice: false, choose: async () => undefined });

export function UiLanguageProvider({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const cook = me?.role === 'cook';
  const id = me?.id ?? null;
  const convexMe = useMe(cook);
  const [device] = useState(deviceUiLanguage);
  // This phone's memory of her: [profileId, chosen, last language] (null until read).
  const [local, setLocal] = useState<{ id: string; chosen: boolean; cached: string | null } | null>(null);
  // Her pick on this phone, with what Convex said then: it leads until Convex says anything new (her pick saved, or
  // a change from another screen or phone); if the save failed, it keeps leading for this launch.
  const [picked, setPicked] = useState<{ id: string; code: string; savedThen: string | null } | null>(null);

  useEffect(() => {
    if (!id || !cook) return;
    let live = true;
    void Promise.all([kvGet(chosenKey(id)), kvGet(uiKey(id))]).then(([chosen, cached]) => {
      if (live) setLocal({ id, chosen: !!chosen, cached });
    });
    return () => {
      live = false;
    };
  }, [id, cook]);

  const mine = local?.id === id ? local : null;
  const saved = convexMe?.language ?? null;
  const pick = picked && picked.id === id && picked.savedThen === saved ? picked.code : null;
  const chosen = !!mine?.chosen || (!!saved && saved !== 'en') || picked?.id === id;
  const lang = activeLanguage(
    !cook || !id
      ? (me ? 'en' : device)
      : pick
        ? pick
        : saved != null
          ? chosen ? saved : device
          : (mine?.cached ?? device),
  )!;

  // Remember her language on this phone for the next launch.
  useEffect(() => {
    if (cook && id && saved != null && chosen && !pick && mine?.cached !== saved) void kvSet(uiKey(id), saved);
  }, [cook, id, saved, chosen, pick, mine?.cached]);

  const choose = useCallback(
    async (code: string) => {
      if (!id) return undefined;
      setPicked({ id, code, savedThen: saved });
      setLocal({ id, chosen: true, cached: code });
      void kvSet(chosenKey(id), '1');
      void kvSet(uiKey(id), code);
      return setLanguage(code, id);
    },
    [id, saved],
  );

  const value = useMemo<UiLanguage>(
    () => ({ lang, t: wordsFor(lang), rtl: isRtl(lang), needsChoice: cook && !!mine && saved != null && !chosen, choose }),
    [lang, cook, mine, saved, chosen, choose],
  );
  return (
    <Ctx.Provider value={value}>
      <TContext.Provider value={value.t}>
        <RtlContext.Provider value={value.rtl}>{children}</RtlContext.Provider>
      </TContext.Provider>
    </Ctx.Provider>
  );
}

/** t() in the language of whoever is on this phone, plus that language and whether it reads right to left. */
export function useWords(): UiLanguage {
  return useContext(Ctx);
}
