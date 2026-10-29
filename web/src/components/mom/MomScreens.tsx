'use client';
// Mom's screens around the questions (the v2 mockups): M1 the kid's voice note, M2 the kid's guess,
// M4 her version filling in with her own words, M5 Sent with the SuccessBurst, M6 the film ask. The recipe
// card on M5 and in M6 opens her version as the locked recipe view (MomRecipe).
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { AppSheet, DishHero, TopBar, useAudio, Wave } from '@/components/dish/parts';
import { Rich, useLang, useRel } from '@/components/dish/lang';
import { Highlighter } from '@/components/primitives/Highlighter';
import { PotMascot } from '@/components/primitives/PotMascot';
import { IconBack, IconPause, IconPlay } from '@/components/recipe-web/icons';
import { appSchemeUrl, WEB_ORIGIN } from '@/lib/app-links';
import { cardTitle, clock, guessedBits, initialOf, plain } from '@/lib/dish/text';
import type { Ask, Ingredient, Line, Quote, QuestionId, Recipe } from '@/lib/dish/types';
import ui from '@/components/dish/ui.module.css';
import s from './mom.module.css';

type Toggle = { on: boolean; flip: () => void } | null;

/** "English" next to her language's text: shows the kid's words as they wrote them. */
function EnglishToggle({ toggle }: { toggle: Toggle }) {
  const { t } = useLang();
  if (!toggle) return null;
  return (
    <button type="button" className={`${ui.press} ${s.englishToggle}`} aria-pressed={toggle.on} aria-label={t('m2.showEnglish')} onClick={toggle.flip}>
      {t('m2.english')}
    </button>
  );
}

// ── M1 ────────────────────────────────────────────────────────────────────────────────────────

export function IntroScreen({ ask, kid, message, toggle, onNext }: { ask: Ask; kid: string; message: string; toggle: Toggle; onNext: () => void }) {
  const { t } = useLang();
  const audio = useAudio();
  const duration = ask.kidVoiceS;
  const url = ask.kidVoiceUrl;

  const playing = !!url && audio.playing === url;
  return (
    <>
      <TopBar />
      <div className={s.body}>
        <div className={s.avatar} aria-hidden="true">
          {initialOf(ask.kidName) || <PotMascot size={56} />}
        </div>
        <h1 className={`${s.h1} ${s.center}`}>
          <Rich text={t('m1.title', { kid, dish: ask.guess.dish || ask.dish })} />
        </h1>
        {url && (
          <div className={s.voice}>
            <button type="button" className={`${ui.press} ${s.bigPlay}`} aria-label={playing ? t('m1.pause', { kid }) : t('m1.play', { kid })} onClick={() => audio.play(url)}>
              {playing ? <IconPause size={22} /> : <IconPlay size={22} />}
            </button>
            <Wave progress={playing ? audio.progress : 0} bars={20} />
            {duration != null && <span className={s.voiceTime}>{clock(playing ? duration * (1 - audio.progress) : duration)}</span>}
          </div>
        )}
        {message && (
          <div className={s.bubble} dir="auto">
            {message}
          </div>
        )}
        <div>
          <EnglishToggle toggle={toggle} />
        </div>
        <div className={s.dock}>
          <button type="button" className={`${ui.press} ${ui.primary}`} onClick={onNext}>
            {t('m1.see', { kid })}
          </button>
        </div>
      </div>
    </>
  );
}

// ── M2 ────────────────────────────────────────────────────────────────────────────────────────

/** What the kid's guess lists: every ingredient, and the step lines a question points at. */
function guessRows(recipe: Recipe, asked: Set<QuestionId>): { key: string; ing: Ingredient | null; line: Line | null; asked: boolean }[] {
  const ings = recipe.ingredients.map((ing, i) => ({ key: `i${i}`, ing, line: null, asked: !!ing.ask && asked.has(ing.ask) }));
  const lines = recipe.steps
    .flatMap((st) => st.lines)
    .filter((l) => l.ask && asked.has(l.ask))
    .map((line, i) => ({ key: `l${i}`, ing: null, line, asked: true }));
  return [...ings, ...lines];
}

export function GuessScreen({ ask, kid, guess, toggle, onBack, onNext }: { ask: Ask; kid: string; guess: Recipe; toggle: Toggle; onBack: () => void; onNext: () => void }) {
  const { t } = useLang();
  const ids = ask.questions.map((q) => q.id);
  const bits = guessedBits(guess, ids);
  const [before, after = ''] = t('m2.title', { kid, bits: '\u0000' }).split('\u0000');
  const n = ask.questions.length;
  return (
    <>
      <DishHero photoUrl={ask.photoUrls[0] ?? null} alt={t('m2.photo', { kid })} height={200}>
        <button type="button" className={`${ui.press} ${ui.round} ${s.back}`} aria-label={t('common.back')} onClick={onBack}>
          <IconBack size={22} />
        </button>
      </DishHero>
      <div className={s.sheet}>
        <span className={s.pill}>{t('m2.pill', { kid })}</span>
        <h1 className={s.h1} style={{ marginTop: 14, fontSize: 30 }}>
          {bits.length ? (
            <>
              {before}
              {bits.map((b, i) => (
                <span key={i}>
                  {i > 0 && t('m2.and')}
                  <Highlighter>{b}</Highlighter>
                </span>
              ))}
              {after}
            </>
          ) : (
            t('m2.titlePlain', { kid })
          )}
        </h1>
        {toggle && (
          <div className={s.listHead}>
            <EnglishToggle toggle={toggle} />
          </div>
        )}
        <ul className={s.list}>
          {guessRows(guess, new Set(ids)).map((r) => (
            <li key={r.key} className={s.row} data-tone={r.asked ? 'butter' : undefined}>
              <span className={s.rowText} dir="auto">
                {r.ing ? (
                  <>
                    {r.ing.amount && <b>{r.ing.amount}</b>} {r.ing.name}
                  </>
                ) : (
                  plain(r.line!.text)
                )}
              </span>
              {r.asked && (
                <span className={s.unsure} role="img" aria-label={t('m2.notSure')}>
                  ?
                </span>
              )}
            </li>
          ))}
        </ul>
        <div className={s.dock}>
          <button type="button" className={`${ui.press} ${ui.primary}`} onClick={onNext}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
            {t('m2.fix')}
          </button>
          <p className={s.under}>{n === 1 ? t('m2.quick1') : t('m2.quick', { n })}</p>
        </div>
      </div>
    </>
  );
}

// ── M4 ────────────────────────────────────────────────────────────────────────────────────────

const FILL_STEP_MS = 1500;

/** Her words, one word at a time from ghost to ink (ANIMATIONS.md: 550 ms ease-out-quart, 70 ms apart). */
function Words({ text, className }: { text: string; className: string }) {
  const words = text.split(/(\s+)/);
  let i = 0;
  return (
    <span className={className} dir="auto">
      “
      {words.map((w, k) =>
        /^\s+$/.test(w) ? (
          w
        ) : (
          <span key={k} className={s.word} style={{ '--i': i++ } as CSSProperties}>
            {w}
          </span>
        ),
      )}
      ”
    </span>
  );
}

function HerQuote({ quote }: { quote: Quote }) {
  return (
    <>
      <Words text={quote.words} className={quote.english ? s.quoteOwn : s.quote} />
      {quote.english && <Words text={quote.english} className={s.english} />}
    </>
  );
}

/** A row of M4: what it shows before her words land (`before`: the kid's guess), and after. */
type FillRow = {
  key: string;
  text: string;
  amount: string;
  was: string | null;
  quote: Quote | null;
  clip: QuestionId | null;
  target: boolean;
  before: { amount: string; text: string };
};

function fillRows(recipe: Recipe, answered: Set<QuestionId>, merged: boolean): FillRow[] {
  const ings: FillRow[] = recipe.ingredients.map((ing, i) => {
    const target = merged ? ing.status === 'mom' : !!ing.ask && answered.has(ing.ask);
    return {
      key: `i${i}`,
      text: ing.name,
      amount: ing.amount,
      was: ing.was,
      quote: ing.quote,
      clip: ing.clip,
      target,
      before: { amount: merged && target ? (ing.was ?? '') : ing.amount, text: ing.name },
    };
  });
  const lines: FillRow[] = recipe.steps
    .flatMap((st) => st.lines)
    .filter((l) => (merged ? l.status === 'mom' : !!l.ask && answered.has(l.ask)))
    .map((l, i) => ({
      key: `l${i}`,
      text: plain(l.text),
      amount: '',
      was: l.was ? plain(l.was) : null,
      quote: l.quote,
      clip: l.clip,
      target: true,
      before: { amount: '', text: plain(l.was ?? l.text) },
    }));
  return [...ings, ...lines];
}

/** `guess` and `version` in the page's language when they are translated (inLang); her quotes stay as she said them. */
export function FillScreen({ ask, guess, version, onDone }: { ask: Ask; guess: Recipe; version: Recipe | null; onDone: () => void }) {
  const { t } = useLang();
  const rel = useRel();
  const audio = useAudio();
  const answered = new Set(ask.answered);
  const recipe = version ?? guess;
  const merged = !!version;
  const rows = fillRows(recipe, answered, merged);
  const targets = rows.filter((r) => r.target);
  const [filled, setFilled] = useState(0);

  useEffect(() => {
    if (!merged) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const step = reduced ? 500 : FILL_STEP_MS;
    let n = 0;
    const timer = window.setInterval(() => {
      n += 1;
      setFilled(n);
      if (n >= targets.length) {
        window.clearInterval(timer);
        window.setTimeout(onDone, reduced ? 800 : 1800);
      }
    }, step);
    return () => window.clearInterval(timer);
  }, [merged, targets.length, onDone]);

  const clipUrl = (id: QuestionId | null) => (id ? (ask.clips.find((c) => c.id === id)?.audioUrl ?? null) : null);
  const total = merged ? targets.length : ask.answered.length;
  let seen = 0;
  return (
    <>
      <TopBar />
      <div className={s.body}>
        <span className={s.writing} role="status">
          <PotMascot size={24} />
          {t('m4.writing')}
        </span>
        <h1 className={s.title}>{cardTitle(ask.relation, ask.guess.dish || ask.dish)}</h1>
        <div className={s.kitchen}>
          <span className={s.potDot} aria-hidden="true">
            <PotMascot size={20} />
          </span>
          {t('m4.fromKitchen', { R: rel(ask.relation) })}
        </div>
        <ul className={s.list} style={{ marginTop: 18 }}>
          {rows.map((r) => {
            const order = r.target ? seen++ : -1;
            const isIn = merged && r.target && order < filled;
            const clip = clipUrl(r.clip);
            return (
              <li key={r.key} className={s.row} data-tone={r.target ? (isIn ? 'sage' : 'butter') : undefined}>
                <span className={s.rowText} dir="auto">
                  {isIn ? (
                    <>
                      {r.amount && <b className={s.amount}>{r.amount}</b>} {r.text}
                      {r.was && <s className={s.was}>{r.was}</s>}
                      {r.quote && <HerQuote quote={r.quote} />}
                    </>
                  ) : (
                    <>
                      {r.before.amount && <b>{r.before.amount}</b>} {r.before.text}
                    </>
                  )}
                </span>
                {isIn && clip ? (
                  <button type="button" className={`${ui.press} ${s.play}`} aria-label={t('m4.hear')} onClick={() => audio.play(clip)}>
                    {audio.playing === clip ? <IconPause size={16} /> : <IconPlay size={16} />}
                  </button>
                ) : (
                  r.target && (
                    <span className={s.dots} role="img" aria-label={t('m4.next')}>
                      <span />
                      <span />
                      <span />
                    </span>
                  )
                )}
              </li>
            );
          })}
        </ul>
        <p className={s.counter} aria-live="polite">
          {t('m4.count', { i: Math.min(filled, total), n: total })}
        </p>
      </div>
    </>
  );
}

// ── M5 and M6 ─────────────────────────────────────────────────────────────────────────────────

const CONFETTI = ['#5B6F00', '#FEBE29', '#F2A98F', '#8E80AE', '#5B6F00', '#FEBE29', '#F2A98F', '#8E80AE', '#5B6F00', '#FEBE29'];

/** The dish card ("Mom's sweet tomato egg"). With `onOpen` the whole card is one tap that opens her recipe. */
function RecipeCard({ ask, compact, onOpen }: { ask: Ask; compact?: boolean; onOpen: (() => void) | null }) {
  const { t } = useLang();
  const n = ask.answered.length;
  const title = cardTitle(ask.relation, ask.guess.dish || ask.dish);
  return (
    <div className={s.miniCard} data-compact={compact || undefined}>
      <span className={s.miniThumb}>
        <DishHero photoUrl={ask.photoUrls[0] ?? null} alt="" height={60} />
      </span>
      <span className={s.miniText}>
        <span className={s.miniTitle}>{title}</span>
        <span className={s.miniLine}>{n === 1 ? t('m5.answers1') : t('m5.answers', { n })}</span>
      </span>
      {onOpen && (
        <>
          <svg className={s.miniChevron} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 5l7 7-7 7" />
          </svg>
          <button type="button" className={s.miniHit} aria-label={`${t('lock.open')}: ${title}`} onClick={onOpen} />
        </>
      )}
    </div>
  );
}

/** M6: the film ask. Also the sheet the locked recipe view's "Get the app" opens (Mom's wording, her link). */
export function FilmSheet({ open, onClose, kid, token, extra }: { open: boolean; onClose: () => void; kid: string; token: string; extra?: ReactNode }) {
  const { t } = useLang();
  return (
    <AppSheet
      open={open}
      onClose={onClose}
      visual={
        <div className={s.frame} aria-hidden="true">
          <span className={s.rec}>REC 0:12</span>
          <span className={`${s.corner} ${s.cornerTR}`} />
          <span className={`${s.corner} ${s.cornerBL}`} />
          <span className={`${s.corner} ${s.cornerBR}`} />
          <PotMascot size={110} mood="happy" steam />
        </div>
      }
      title={t('m6.title', { kid })}
      sub={t('m6.misses', { kid })}
      reasons={[
        { icon: 'bookmark', tone: 'sage', text: t('m6.save') },
        { icon: 'heart', tone: 'peach', text: t('m6.keep', { kid }) },
      ]}
      extra={extra}
      copyLink={`${WEB_ORIGIN}/a?t=${token}`}
      schemeLink={appSchemeUrl('a', { t: token })}
    />
  );
}

/**
 * `canOpen`: her version is written, so the card opens it. `filmFirst`: the film ask rises by itself, once
 * (coming back from her recipe it doesn't rise again).
 */
export function SentScreen({
  ask,
  kid,
  token,
  canOpen,
  filmFirst,
  onFilmShown,
  onOpenRecipe,
}: {
  ask: Ask;
  kid: string;
  token: string;
  canOpen: boolean;
  filmFirst: boolean;
  onFilmShown: () => void;
  onOpenRecipe: () => void;
}) {
  const { t } = useLang();
  const [film, setFilm] = useState(false);
  useEffect(() => {
    if (!filmFirst) return;
    const timer = window.setTimeout(() => {
      setFilm(true);
      onFilmShown();
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [filmFirst, onFilmShown]);
  const open = canOpen
    ? () => {
        setFilm(false);
        onOpenRecipe();
      }
    : null;
  return (
    <>
      <TopBar />
      <div className={s.body}>
        <div className={s.burst} aria-hidden="true">
          <span className={s.ring} />
          {CONFETTI.map((c, i) => (
            <span key={i} className={s.confetti} style={{ background: c, '--a': `${i * 36}deg`, '--d': `${28 + (i % 3) * 8}px` } as CSSProperties} />
          ))}
          <span className={s.disc}>
            <svg className={s.check} viewBox="0 0 24 24">
              <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={20} />
            </svg>
          </span>
        </div>
        <div className={s.rise}>
          <h1 className={s.sentTitle}>{t('m5.sent', { kid })}</h1>
          <p className={s.sentLine}>{t('m5.line', { kid })}</p>
          <RecipeCard ask={ask} onOpen={open} />
        </div>
      </div>
      <FilmSheet open={film} onClose={() => setFilm(false)} kid={kid} token={token} extra={open && <RecipeCard ask={ask} compact onOpen={open} />} />
    </>
  );
}

