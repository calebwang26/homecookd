'use client';
// The page language for /miss and /a: the phone's (navigator.languages) among the 13 the app speaks,
// else English, or what the reader picked in the switch (remembered). The server render is English;
// the client swaps in the phone's language after hydration.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { saveLang, savedLang } from '@/lib/dish/saved';
import { isLang, isRtl, LANGS, nativeName, phoneLang, rich, wordsFor, type Lang, type T } from '@/lib/dish/words';
import type { Relation } from '@/lib/relation';
import s from './dish.module.css';

type LangState = { lang: Lang; t: T; setLang: (l: Lang) => void; tags: readonly string[] };

const Ctx = createContext<LangState>({ lang: 'en', t: wordsFor('en'), setLang: () => {}, tags: [] });

export function DishLangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  const [tags, setTags] = useState<readonly string[]>([]);

  useEffect(() => {
    const phone = typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? []), navigator.language].filter(Boolean);
    const saved = savedLang();
    /* eslint-disable react-hooks/set-state-in-effect -- the phone's language is only readable on the client (static export) */
    setTags(phone);
    setLangState(isLang(saved) ? saved : phoneLang(phone));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    saveLang(l);
  }, []);

  const value = useMemo(() => ({ lang, t: wordsFor(lang), setLang, tags }), [lang, setLang, tags]);
  return (
    <Ctx.Provider value={value}>
      <div lang={lang} dir={isRtl(lang) ? 'rtl' : 'ltr'} className={s.langRoot}>
        {children}
      </div>
    </Ctx.Provider>
  );
}

export const useLang = () => useContext(Ctx);

/** "Mom", "Dad"… in the page language. */
export function useRel() {
  const { t } = useLang();
  return (rel: Relation) => t(`rel.${rel}`);
}

/** A line with *italic* runs. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {rich(text).map((r, i) => (r.em ? <em key={i}>{r.text}</em> : <span key={i}>{r.text}</span>))}
    </>
  );
}

/**
 * The globe pill in the top bar: a native select over it, so every phone shows its own picker. `compact`
 * drops the language's name (the select's label still says it) when the bar also holds "Your last dish".
 */
export function LangSwitch({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useLang();
  const name = nativeName(lang);
  return (
    <label className={s.langSwitch}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
      </svg>
      {!compact && <span aria-hidden="true">{name}</span>}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
      <select aria-label={t('lang.label', { name })} value={lang} onChange={(e) => isLang(e.target.value) && setLang(e.target.value)}>
        {LANGS.map(([code, native]) => (
          <option key={code} value={code}>
            {native}
          </option>
        ))}
      </select>
    </label>
  );
}
