'use client';
// K2, tonight's version (the v2 "K2-Tonight" mockup), and Mom's version once she answered: her amounts
// over his struck-through guesses, her own words with the English under them, and her clips. The dock
// saves (K4, the download ask) or asks her (K3). The recipe itself stays in English: it's data.
import { Fragment, useCallback, useEffect, useState, type MouseEvent } from 'react';
import { AppSheet, DishHero, Toast, useAudio, useToast } from '@/components/dish/parts';
import { useLang, useRel } from '@/components/dish/lang';
import { PotMascot } from '@/components/primitives/PotMascot';
import { IconBack, IconPause, IconPlay } from '@/components/recipe-web/icons';
import { appSchemeUrl, WEB_ORIGIN } from '@/lib/app-links';
import { getCard } from '@/lib/dish/api';
import { boldRuns, cardTitle, pronounOf } from '@/lib/dish/text';
import type { Card, Ingredient, Line, Quote, QuestionId, Recipe } from '@/lib/dish/types';
import { AskSheet } from './AskSheet';
import ui from '@/components/dish/ui.module.css';
import s from './miss.module.css';

type Props = { token: string; initial: Card; onNewDish: (e?: MouseEvent) => void };

export function CardScreen({ token, initial, onNewDish }: Props) {
  const { t } = useLang();
  const rel = useRel();
  const [card, setCard] = useState(initial);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast, show } = useToast();
  const audio = useAudio();

  // Her answers come in while the page is open: every 3 s while it's being written, every 15 s while asked.
  const waiting = card.merging || (card.status === 'asked' && !card.version);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') getCard(token).then(setCard, () => {});
    }, card.merging ? 3000 : 15000);
    return () => window.clearInterval(timer);
  }, [waiting, card.merging, token]);

  useEffect(() => {
    document.title = cardTitle(card.relation, card.dish);
  }, [card.relation, card.dish]);

  const recipe: Recipe = card.version ?? card.guess;
  const R = rel(card.relation);
  const answered = new Set(card.answers.map((a) => a.id));
  const askable = new Set(card.guess.questions.map((q) => q.id));
  const tagFor = (id: QuestionId | null) => !!id && askable.has(id) && !answered.has(id);
  const clipUrl = (id: QuestionId | null) => (id ? (card.answers.find((a) => a.id === id)?.audioUrl ?? null) : null);

  const onSave = () => {
    show(t('saved.toast'));
    window.setTimeout(() => setSaving(true), 700);
  };
  const closeSave = useCallback(() => setSaving(false), []);
  const closeAsk = useCallback(() => setAsking(false), []);

  const steps = recipe.steps.length;
  const pronoun = pronounOf(card.relation);
  const photo = card.photoUrls[0] ?? null;

  return (
    <main className={s.card}>
      <DishHero photoUrl={photo} alt={t('card.dishPhoto', { dish: card.dish })}>
        <a className={`${ui.press} ${ui.round} ${s.back}`} href="/miss" aria-label={t('card.newDish')} onClick={(e) => onNewDish(e)}>
          <IconBack size={22} />
        </a>
      </DishHero>
      <section className={s.sheet}>
        <span className={s.pill} data-tone={card.version ? 'peach' : undefined}>
          {card.version ? t('card.theirVersion', { R }) : t('card.tonight')}
        </span>
        <h1 className={s.title}>{cardTitle(card.relation, recipe.dish || card.dish)}</h1>
        <div className={s.byline}>
          {card.version ? (
            <span className={s.avatar} aria-hidden="true">
              <PotMascot size={22} />
            </span>
          ) : (
            <span className={s.dashed} aria-hidden="true" />
          )}
          {card.version ? t('card.fromKitchen', { R }) : t('card.bestGuess')}
        </div>

        {card.merging ? (
          <p className={s.status} role="status">
            <PotMascot size={28} mood="happy" />
            {t('card.merging', { R })}
          </p>
        ) : card.status === 'asked' && !card.version ? (
          <p className={s.status} role="status">
            {t('card.waiting', { R })}
          </p>
        ) : null}

        <Facts recipe={recipe} />

        {card.status === 'answered' && !card.version && card.answers.length > 0 && (
          <>
            <h2 className={s.h2}>{t('card.clips', { R })}</h2>
            <ul className={s.list}>
              {card.answers.map((a, i) => (
                <li key={a.id} className={s.row}>
                  <span className={s.rowText}>{t('card.answer', { n: i + 1 })}</span>
                  {a.audioUrl && <PlayButton url={a.audioUrl} audio={audio} label={t('card.hear', { R })} stop={t('card.stop')} />}
                </li>
              ))}
            </ul>
          </>
        )}

        <h2 className={s.h2}>{t('card.need')}</h2>
        <p className={s.sub}>{card.version ? t('card.needMom', { R }) : t('card.needGuess', { R })}</p>
        <ul className={s.list}>
          {recipe.ingredients.map((ing, i) => (
            <IngredientRow
              key={i}
              ing={ing}
              ask={tagFor(ing.ask) ? () => setAsking(true) : null}
              askLabel={t('card.askTag', { R })}
              clip={clipUrl(ing.clip)}
              audio={audio}
              hear={t('card.hear', { R })}
              stop={t('card.stop')}
            />
          ))}
        </ul>

        <div className={s.h2Row}>
          <h2 className={s.h2}>{t('card.how')}</h2>
          <span className={s.count}>{steps === 1 ? t('card.step') : t('card.steps', { n: steps })}</span>
        </div>
        <ol className={s.steps}>
          {recipe.steps.map((step, i) => {
            const asked = step.lines.find((l) => tagFor(l.ask));
            const hers = step.lines.filter((l) => l.status === 'mom');
            const tone = asked ? 'butter' : hers.length || step.tip ? 'sage' : undefined;
            const clip = clipUrl(hers.find((l) => l.clip)?.clip ?? step.tip?.clip ?? null);
            return (
              <li key={i} className={s.step} data-tone={tone}>
                <span className={s.num}>{i + 1}</span>
                <span className={s.stepText} dir="auto">
                  {step.lines.map((l, j) => (
                    <Fragment key={j}>
                      {j > 0 && ' '}
                      <Bold text={l.text} />
                    </Fragment>
                  ))}
                  {hers.map((l, j) => l.quote && <QuoteLines key={`q${j}`} quote={l.quote} />)}
                  {step.tip && <QuoteLines quote={step.tip} />}
                </span>
                {asked ? (
                  <button type="button" className={`${ui.press} ${s.tag}`} onClick={() => setAsking(true)}>
                    {t('card.askTag', { R })}
                  </button>
                ) : (
                  clip && <PlayButton url={clip} audio={audio} label={t('card.hear', { R })} stop={t('card.stop')} />
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <div className={s.dock}>
        <button type="button" className={`${ui.press} ${ui.secondary}`} onClick={onSave}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 4h12v17l-6-4-6 4z" />
          </svg>
          {t('card.save')}
        </button>
        <button type="button" className={`${ui.press} ${ui.primary}`} onClick={() => setAsking(true)}>
          {t('ask.title', { R })}
        </button>
      </div>

      <AskSheet open={asking} onClose={closeAsk} token={token} card={card} onCard={setCard} toast={show} />
      <AppSheet
        open={saving}
        onClose={closeSave}
        visual={<SavedFan photo={photo} />}
        title={t('get.title')}
        reasons={[
          { icon: 'bookmark', tone: 'sage', title: t('get.keep'), text: t('get.keepLine') },
          { icon: 'bell', tone: 'butter', title: t('get.know', { R }), text: t(pronoun === 'he' ? 'get.knowLineHe' : 'get.knowLineShe') },
        ]}
        copyLink={`${WEB_ORIGIN}/miss?k=${token}`}
        schemeLink={appSchemeUrl('miss', { k: token })}
      />
      <Toast toast={toast} />
    </main>
  );
}

function Facts({ recipe }: { recipe: Recipe }) {
  const { t } = useLang();
  const items = [
    recipe.time && { icon: <ClockIcon />, text: recipe.time },
    recipe.servings && { icon: <BowlIcon />, text: t('card.serves', { n: recipe.servings }) },
    recipe.cost && { icon: <CoinIcon />, text: recipe.cost },
  ].filter(Boolean) as { icon: React.ReactNode; text: string }[];
  if (!items.length) return null;
  return (
    <div className={s.facts}>
      {items.map((f) => (
        <div key={f.text} className={s.fact}>
          {f.icon}
          <span>{f.text}</span>
        </div>
      ))}
    </div>
  );
}

type Audio = ReturnType<typeof useAudio>;

function IngredientRow({ ing, ask, askLabel, clip, audio, hear, stop }: { ing: Ingredient; ask: (() => void) | null; askLabel: string; clip: string | null; audio: Audio; hear: string; stop: string }) {
  const hers = ing.status === 'mom';
  const amount = ing.amount.trim();
  return (
    <li className={s.row} data-tone={ask ? 'butter' : hers ? 'sage' : undefined}>
      <span className={s.rowText} dir="auto">
        {amount && <b>{amount}</b>} {ing.name}
        {hers && ing.was && <s className={s.was}>{ing.was}</s>}
        {hers && ing.quote && <QuoteLines quote={ing.quote} />}
      </span>
      {ask ? (
        <button type="button" className={`${ui.press} ${s.tag}`} onClick={ask}>
          {askLabel}
        </button>
      ) : (
        clip && <PlayButton url={clip} audio={audio} label={hear} stop={stop} />
      )}
    </li>
  );
}

/** Her words as she said them; the English under them when she spoke another language. */
export function QuoteLines({ quote }: { quote: Quote }) {
  return (
    <>
      <span className={quote.english ? s.quoteOwn : s.quote} dir="auto">
        “{quote.words}”
      </span>
      {quote.english && <span className={s.english}>“{quote.english}”</span>}
    </>
  );
}

export function PlayButton({ url, audio, label, stop }: { url: string; audio: Audio; label: string; stop: string }) {
  const on = audio.playing === url;
  return (
    <button type="button" className={`${ui.press} ${s.play}`} aria-label={on ? stop : label} aria-pressed={on} onClick={() => audio.play(url)}>
      {on ? <IconPause size={16} /> : <IconPlay size={16} />}
    </button>
  );
}

function Bold({ text }: { text: Line['text'] }) {
  return (
    <>
      {boldRuns(text).map((r, i) => (r.bold ? <b key={i}>{r.text}</b> : <Fragment key={i}>{r.text}</Fragment>))}
    </>
  );
}

function SavedFan({ photo }: { photo: string | null }) {
  return (
    <div className={s.fan} aria-hidden="true">
      <span className={s.fanCard} />
      <span className={s.fanCard} />
      <div className={s.fanWrap}>
        <div className={s.fanFront}>
          <DishHero photoUrl={photo} alt="" height={134} />
        </div>
        <span className={s.badge}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M6 4h12v17l-6-4-6 4z" />
          </svg>
        </span>
      </div>
    </div>
  );
}

const ClockIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const BowlIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M3 11h18a9 9 0 0 1-18 0z" />
    <path d="M8 21h8" />
  </svg>
);
const CoinIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M14.5 9.5c-.5-1-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.1 0-2-.5-2.5-1.5M12 6.5V8M12 16v1.5" />
  </svg>
);
