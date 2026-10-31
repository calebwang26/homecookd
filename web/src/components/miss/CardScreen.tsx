'use client';
// K2, tonight's version (the v2 "K2-Tonight" mockup), and Mom's version once she answered: her amounts
// over his struck-through guesses, her own words with the English under them, and her clips. The dock
// saves (K4, the download ask) or asks her (K3). The recipe itself stays in English: it's data.
import { Fragment, useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { DishHero, Toast, useAudio, useToast } from '@/components/dish/parts';
import { useLang, useRel } from '@/components/dish/lang';
import { Logo } from '@/components/primitives/Logo';
import { IconBack, IconClose, IconPause, IconPlay } from '@/components/recipe-web/icons';
import { DishError, getCard, updateCard } from '@/lib/dish/api';
import { applyEdits, askItems, cleanPicked, EDIT_LIMITS, initialPicked, ingredientRef, lineRef, openCap, ownUnit, QUESTION_LIMITS, unitOf, unitText, withDefaults, withEdit } from '@/lib/dish/shape';
import { boldRuns, cardTitle, plain } from '@/lib/dish/text';
import type { Card, Edit, Ingredient, Line, PartRef, Quote, Recipe } from '@/lib/dish/types';
import { AskSheet } from './AskSheet';
import { WhoSheet } from './WhoSheet';
import { KidRecipe } from './KidRecipe';
import { SaveSheet } from './SaveSheet';
import ui from '@/components/dish/ui.module.css';
import s from './miss.module.css';

type Props = { token: string; initial: Card; onNewDish: (e?: MouseEvent) => void };

export function CardScreen({ token, initial, onNewDish }: Props) {
  const { t } = useLang();
  const rel = useRel();
  const [card, setCard] = useState(initial);
  const [asking, setAsking] = useState(false);
  const [who, setWho] = useState(false); // "Ask someone": who to ask, when the card has no one yet
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState<'recipe' | 'ingredients' | null>(null); // the locked recipe view over the card, and its first screen
  const { toast, show } = useToast();
  const audio = useAudio();

  // The kid shapes the guess until Mom has sent her answers: what to ask (picked) and what to fix (edits).
  const shaping = !card.finishedAt && !card.version;
  const [picked, setPicked] = useState<string[]>(() => initialPicked(initial));
  const [edits, setEdits] = useState<Edit[]>([]);
  const [capHit, setCapHit] = useState(false);
  const [adding, setAdding] = useState(false); // the plus square: a question in his own words
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null); // the step shown in full
  const guess = useMemo(() => applyEdits(card.guess, edits), [card.guess, edits]);

  // Her answers come in while the page is open: every 3 s while it's being written, every 15 s while asked.
  const waiting = card.merging || (card.status === 'asked' && !card.version);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') getCard(token).then(setCard, () => {});
    }, card.merging ? 3000 : 15000);
    return () => window.clearInterval(timer);
  }, [waiting, card.merging, token]);

  const recipe: Recipe = card.version ?? guess;
  const none = card.relation === 'none';
  const R = rel(card.relation);
  const askLabel = none ? t('card.askSomeone') : t('card.askTag', { R });
  const cap = openCap(card);
  const chosen = cleanPicked(card, guess, picked); // unique units: a question's id, or a part with none
  const full = chosen.length >= cap;
  const toSend = askItems(card, guess, withDefaults(card, chosen, cap)); // Mom always gets the full 3
  const clipUrl = (id: Ingredient['clip']) => (id ? (card.answers.find((a) => a.id === id)?.audioUrl ?? null) : null);

  const flashCap = () => {
    setCapHit(true);
    window.setTimeout(() => setCapHit(false), 2200);
  };
  const toggleUnit = (unit: string) => {
    if (chosen.includes(unit)) return setPicked(chosen.filter((x) => x !== unit));
    if (full) return flashCap();
    setPicked([...chosen, unit]);
  };
  const toggle = (ref: PartRef) => toggleUnit(unitOf(card, guess, ref));
  const isOn = (ref: PartRef) => chosen.includes(unitOf(card, guess, ref));
  /** Fixing a line: shown at once, sent to the server, whose guess replaces it (a 422 or 409 undoes it, with a toast). */
  const edit = (e: Edit) => {
    setEdits((all) => withEdit(all, e));
    setEditing(null);
    updateCard(token, { edits: [e] }).then(
      (c) => (setCard(c), setEdits((all) => all.filter((x) => x !== e))),
      (err: unknown) => {
        setEdits((all) => all.filter((x) => x !== e));
        const kind = err instanceof DishError ? err.kind : 'network';
        show(kind === 'words' ? t('k1.words') : kind === 'closed' ? t('edit.closed', { R }) : t('share.failed'), 'error');
        if (kind === 'closed') getCard(token).then(setCard, () => {});
      },
    );
  };

  const onSave = () => {
    show(t('saved.toast'));
    window.setTimeout(() => setSaving(true), 700);
  };
  const closeSave = useCallback(() => setSaving(false), []);
  const closeAsk = useCallback(() => setAsking(false), []);
  const closeWho = useCallback(() => setWho(false), []);
  const closeRecipe = useCallback(() => setLocked(null), []);
  const onAsk = () => (none ? setWho(true) : setAsking(true));
  const pickedWho = (c: Card) => {
    setCard(c);
    setWho(false);
    setAsking(true);
  };

  const steps = recipe.steps.length;
  const photo = card.photoUrls[0] ?? null;
  const title = cardTitle(card.relation, recipe.dish || card.dish);
  useEffect(() => {
    document.title = title;
  }, [title]);

  const back = (
    <a className={`${ui.press} ${ui.round} ${s.back}`} href="/miss" aria-label={t('card.newDish')} onClick={(e) => onNewDish(e)}>
      <IconBack size={22} />
    </a>
  );

  if (locked) return <KidRecipe card={card} token={token} version={recipe} start={locked} onClose={closeRecipe} />;

  const ingProps = (i: number) => ({
    part: ingredientRef(i),
    on: isOn(ingredientRef(i)),
    toggle,
    label: t('card.askToggle', { who: none ? t('card.someone') : R }),
    ask: askLabel,
    full,
  });

  return (
    <main className={s.card}>
      {/* A photo gets the hero. Without one, the dish name shows once, as the title (Caleb, Oct 30: the
          name-on-white hero above it was redundant), and Back sits in a plain top row. */}
      {photo ? (
        <DishHero photoUrl={photo} alt={t('card.dishPhoto', { dish: card.dish })} title={title}>
          {back}
        </DishHero>
      ) : (
        <div className={s.topRow}>{back}</div>
      )}
      <section className={s.sheet} data-flat={photo ? undefined : ''}>
        {/* The version is one tap: the button covers it and opens the recipe as the locked view. */}
        <div className={s.head}>
          {card.version && (
            <span className={s.pill} data-tone="peach">
              {t('card.theirVersion', { R })}
            </span>
          )}
          <h1 className={s.title}>{title}</h1>
          <div className={s.byline}>
            {card.version ? (
              <span className={s.avatar} aria-hidden="true">
                <Logo variant="mark" size={22} />
              </span>
            ) : (
              <span className={s.dashed} aria-hidden="true" />
            )}
            {card.version ? t('card.fromKitchen', { R }) : none ? t('card.ourGuessNone') : t('card.ourGuess', { R })}
          </div>
          <svg className={s.headChevron} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 5l7 7-7 7" />
          </svg>
          <button type="button" className={s.headHit} aria-label={`${t('lock.open')}: ${title}`} onClick={() => setLocked('recipe')} />
        </div>

        {card.merging ? (
          <p className={s.status} role="status">
            <Logo variant="mark" size={28} />
            {t('card.merging', { R })}
          </p>
        ) : card.status === 'asked' && !card.version ? (
          <p className={s.status} role="status">
            {t('card.waiting', { R })}
          </p>
        ) : null}

        <button type="button" className={`${ui.press} ${ui.primary} ${s.start}`} onClick={() => setLocked('ingredients')}>
          {t('lock.start')}
        </button>

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
        {card.version && <p className={s.sub}>{t('card.needMom', { R })}</p>}
        <ul className={s.list}>
          {recipe.ingredients.map((ing, i) =>
            shaping ? (
              <ShapeRow key={i} ing={ing} editing={editing === `i${i}`} onEdit={() => setEditing(`i${i}`)} onCancel={() => setEditing(null)} onSave={(e) => edit({ kind: 'ingredient', index: i, ...e })} {...ingProps(i)} />
            ) : (
              <IngredientRow key={i} ing={ing} clip={clipUrl(ing.clip)} audio={audio} hear={t('card.hear', { R })} stop={t('card.stop')} />
            ),
          )}
        </ul>

        {shaping && (
          <section className={s.knows} aria-labelledby="knows">
            <h2 id="knows" className={s.knowsTitle}>
              {none ? t('card.onlyNone') : t('card.only', { R })}
            </h2>
            {chosen.length > 0 && (
              <ul className={s.knowsList}>
                {chosen.map((unit) => (
                  <li key={unit}>
                    <span dir="auto">{unitText(card, guess, unit)}</span>
                    <button type="button" className={s.knowsX} aria-label={t('card.askRemove')} onClick={() => toggleUnit(unit)}>
                      <IconClose size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {adding ? (
              <OwnQuestion
                onCancel={() => setAdding(false)}
                onSave={(text) => {
                  setPicked([...chosen, ownUnit(text)]);
                  setAdding(false);
                }}
              />
            ) : (
              <button type="button" className={`${ui.press} ${s.knowsAdd}`} aria-label={t('card.askAdd')} aria-disabled={full || undefined} onClick={() => (full ? flashCap() : setAdding(true))}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            )}
            <p className={s.knowsCap} role="status" data-hit={capHit || undefined}>
              {t('ask.cap', { n: cap })}
            </p>
          </section>
        )}

        <div className={s.h2Row}>
          <h2 className={s.h2}>{t('card.how')}</h2>
          <span className={s.count}>{steps === 1 ? t('card.step') : t('card.steps', { n: steps })}</span>
        </div>
        <ol className={s.steps}>
          {recipe.steps.map((step, i) => {
            const hers = step.lines.filter((l) => l.status === 'mom');
            const clip = clipUrl(hers.find((l) => l.clip)?.clip ?? step.tip?.clip ?? null);
            const asked = step.lines.some((_, j) => isOn(lineRef(i, j)));
            const more = open === i;
            return (
              <li key={i} className={s.step} data-tone={!shaping && (hers.length || step.tip) ? 'sage' : undefined}>
                <span className={s.num}>{i + 1}</span>
                <span className={s.stepText} dir="auto">
                  {shaping ? (
                    more ? (
                      step.lines.map((l, j) => {
                        const ref = lineRef(i, j);
                        const k = `l${i}.${j}`;
                        return (
                          <StepLine
                            key={j}
                            line={l}
                            editing={editing === k}
                            on={isOn(ref)}
                            full={full}
                            label={t('card.askToggle', { who: none ? t('card.someone') : R })}
                            ask={askLabel}
                            onEdit={() => setEditing(k)}
                            onCancel={() => setEditing(null)}
                            onSave={(text) => edit({ kind: 'line', step: i, line: j, text })}
                            onToggle={() => toggle(ref)}
                          />
                        );
                      })
                    ) : (
                      <button type="button" className={s.stepHit} aria-expanded="false" aria-label={`${t('card.stepMore')}: ${step.lines.map((l) => plain(l.short || l.text)).join(' ')}`} onClick={() => setOpen(i)}>
                        {step.lines.map((l, j) => (
                          <Fragment key={j}>
                            {j > 0 && ' '}
                            <Bold text={l.short || l.text} />
                          </Fragment>
                        ))}
                        {asked && <span className={s.stepDot} aria-hidden="true" />}
                      </button>
                    )
                  ) : (
                    <>
                      {step.lines.map((l, j) => (
                        <Fragment key={j}>
                          {j > 0 && ' '}
                          <Bold text={l.text} />
                        </Fragment>
                      ))}
                      {hers.map((l, j) => l.quote && <QuoteLines key={`q${j}`} quote={l.quote} />)}
                      {step.tip && <QuoteLines quote={step.tip} />}
                    </>
                  )}
                </span>
                {shaping ? (
                  <button type="button" className={s.stepChevron} data-open={more || undefined} aria-label={more ? t('card.stepLess') : t('card.stepMore')} onClick={() => setOpen(more ? null : i)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
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
        <button type="button" className={`${ui.press} ${ui.primary}`} disabled={!toSend.length} onClick={onAsk}>
          {askLabel}
        </button>
      </div>

      <WhoSheet open={who} onClose={closeWho} token={token} onPicked={pickedWho} toast={show} />
      <AskSheet key={card.relation} open={asking} onClose={closeAsk} token={token} card={card} onCard={setCard} toast={show} items={toSend} />
      <SaveSheet open={saving} onClose={closeSave} photo={photo} relation={card.relation} token={token} title={title} />
      <Toast toast={toast} />
    </main>
  );
}

type Pair = { amount?: string; name?: string };

function IngredientEdit({ ing, onCancel, onSave }: { ing: Ingredient; onCancel: () => void; onSave: (e: Pair) => void }) {
  const { t } = useLang();
  const [amount, setAmount] = useState(ing.amount);
  const [name, setName] = useState(ing.name);
  const ok = name.trim().length >= 1 && name.trim().length <= EDIT_LIMITS.name && amount.trim().length <= EDIT_LIMITS.amount;
  const save = () => {
    if (!ok) return;
    const next: Pair = {};
    if (name.trim() !== ing.name) next.name = name.trim();
    if (amount.trim() !== ing.amount && amount.trim()) next.amount = amount.trim();
    if (next.name === undefined && next.amount === undefined) return onCancel();
    onSave(next);
  };
  return (
    <li className={s.row} data-editing="true">
      <form className={s.editForm} onSubmit={(e) => (e.preventDefault(), save())} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
        <input className={s.editAmount} aria-label={t('edit.amount')} value={amount} maxLength={EDIT_LIMITS.amount} autoFocus dir="auto" onChange={(e) => setAmount(e.target.value)} />
        <input className={s.editName} aria-label={t('edit.name')} value={name} maxLength={EDIT_LIMITS.name} dir="auto" onChange={(e) => setName(e.target.value)} />
        <EditButtons ok={ok} onCancel={onCancel} />
      </form>
    </li>
  );
}

/** A line of "What you need" the kid can shape: the pencil fixes it, the pill asks about it. */
function ShapeRow({ ing, part, on, toggle, label, ask, full, editing, onEdit, onCancel, onSave }: { ing: Ingredient; part: PartRef; on: boolean; toggle: (r: PartRef) => void; label: string; ask: string; full: boolean; editing: boolean; onEdit: () => void; onCancel: () => void; onSave: (e: Pair) => void }) {
  const { t } = useLang();
  const own = ing.status === 'stated';
  if (editing) return <IngredientEdit ing={ing} onCancel={onCancel} onSave={onSave} />;
  const amt = ing.amount.trim();
  return (
    <li className={s.row}>
      <span className={s.rowEdit}>
        <span className={s.rowText} dir="auto">
          {amt && <b className={s.amt}>{amt}</b>} {ing.name}
          {own && <small className={s.you}>{t('card.you')}</small>}
        </span>
      </span>
      <RowActions fix={`${t('edit.fix')}: ${amt} ${ing.name}`} onEdit={onEdit} on={on} full={full} label={label} ask={ask} onToggle={() => toggle(part)} />
    </li>
  );
}

function StepLine({ line, editing, on, full, label, ask, onEdit, onCancel, onSave, onToggle }: { line: Line; editing: boolean; on: boolean; full: boolean; label: string; ask: string; onEdit: () => void; onCancel: () => void; onSave: (text: string) => void; onToggle: () => void }) {
  const { t } = useLang();
  if (editing) return <LineEdit line={line} onCancel={onCancel} onSave={onSave} />;
  return (
    <span className={s.stepLine}>
      <span className={s.rowEdit} dir="auto">
        <Bold text={line.text} />
        {line.status === 'stated' && <small className={s.you}>{t('card.you')}</small>}
      </span>
      <RowActions fix={`${t('edit.fix')}: ${plain(line.text)}`} onEdit={onEdit} on={on} full={full} label={label} ask={ask} onToggle={onToggle} />
    </span>
  );
}

function OwnQuestion({ onCancel, onSave }: { onCancel: () => void; onSave: (text: string) => void }) {
  const { t } = useLang();
  const [text, setText] = useState('');
  const ok = text.trim().length >= QUESTION_LIMITS.min && text.trim().length <= QUESTION_LIMITS.max;
  return (
    <form className={`${s.editForm} ${s.knowsForm}`} onSubmit={(e) => (e.preventDefault(), ok && onSave(text))} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <input className={s.editName} aria-label={t('card.askAdd')} placeholder={t('card.askPlaceholder')} value={text} maxLength={QUESTION_LIMITS.max} autoFocus dir="auto" onChange={(e) => setText(e.target.value)} />
      <EditButtons ok={ok} onCancel={onCancel} />
    </form>
  );
}

function LineEdit({ line, onCancel, onSave }: { line: Line; onCancel: () => void; onSave: (text: string) => void }) {
  const { t } = useLang();
  const [text, setText] = useState(plain(line.text));
  const ok = text.trim().length >= 1 && text.trim().length <= EDIT_LIMITS.line;
  const save = () => {
    if (!ok) return;
    if (text.trim() === plain(line.text)) return onCancel();
    onSave(text.trim());
  };
  return (
    <span className={s.stepLine}>
      <form className={s.editForm} onSubmit={(e) => (e.preventDefault(), save())} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
        <input className={s.editName} aria-label={t('edit.line')} value={text} maxLength={EDIT_LIMITS.line} autoFocus dir="auto" onChange={(e) => setText(e.target.value)} />
        <EditButtons ok={ok} onCancel={onCancel} />
      </form>
    </span>
  );
}

function EditButtons({ ok, onCancel }: { ok: boolean; onCancel: () => void }) {
  const { t } = useLang();
  return (
    <>
      <button type="submit" className={`${ui.press} ${s.editOk}`} disabled={!ok} aria-label={t('edit.done')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </button>
      <button type="button" className={`${ui.press} ${s.editNo}`} aria-label={t('edit.cancel')} onClick={onCancel}>
        <IconClose size={16} />
      </button>
    </>
  );
}

/** A line's two buttons, each saying what it does (Caleb, Oct 30: the bare + read as "fix this"): the pencil edits, the pill adds it to what the kid asks. */
function RowActions({ fix, onEdit, on, full, label, ask, onToggle }: { fix: string; onEdit: () => void; on: boolean; full: boolean; label: string; ask: string; onToggle: () => void }) {
  const { t } = useLang();
  return (
    <span className={s.rowActions}>
      <button type="button" className={`${ui.press} ${s.pencil}`} aria-label={fix} onClick={onEdit}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 20l1-4L16 5l3 3L8 19z" />
        </svg>
      </button>
      <button type="button" className={`${ui.press} ${s.toggle}`} aria-pressed={on} aria-disabled={(!on && full) || undefined} aria-label={label} onClick={onToggle}>
        {on && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        )}
        {on ? t('card.asking') : ask}
      </button>
    </span>
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

function IngredientRow({ ing, clip, audio, hear, stop }: { ing: Ingredient; clip: string | null; audio: Audio; hear: string; stop: string }) {
  const hers = ing.status === 'mom';
  const amount = ing.amount.trim();
  return (
    <li className={s.row} data-tone={hers ? 'sage' : undefined}>
      <span className={s.rowText} dir="auto">
        {amount && <b>{amount}</b>} {ing.name}
        {hers && ing.was && <s className={s.was}>{ing.was}</s>}
        {hers && ing.quote && <QuoteLines quote={ing.quote} />}
      </span>
      {clip && <PlayButton url={clip} audio={audio} label={hear} stop={stop} />}
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
