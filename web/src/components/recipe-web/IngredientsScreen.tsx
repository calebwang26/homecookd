'use client';
// The app's ingredients screen (app/src/app/recipe/[id]/ingredients.tsx, bible Kid-Ingredients):
// back + dish name + "N of M", "Get these ready", a cream card of checkable rows (the cook's words
// big, the estimate small), and ONE collapsed "Not sure how much?" link-dropdown with the amounts
// the cook only hinted at and "Ask the family" (which needs the app). Ticks stay in this browser.
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { EggMascot } from '@/components/primitives/EggMascot';
import { Her, Was } from './DishBits';
import { useRW } from './context';
import { IconBack, IconBubble, IconCheck, IconChevronDown } from './icons';
import { estimateLine, ingredientLines, ingredientWords, unsureIngredients } from '@/lib/recipe-web/recipe';
import { readChecklist, writeChecklist } from '@/lib/recipe-web/progress';
import ui from './RecipeWeb.module.css';
import s from './IngredientsScreen.module.css';

export function IngredientsScreen() {
  const { recipe: r, go, lock, reduced, dish } = useRW();
  // A dish card's ingredient: the name big, her amount under it (her struck-through guess beside it, her own words below).
  const items = useMemo(
    () =>
      r.ingredients.map((i, k) => {
        const d = dish?.recipe.ingredients[k];
        return d ? { words: d.name, amount: d.amount.trim(), was: d.status === 'mom' ? d.was : null, quote: d.status === 'mom' ? d.quote : null } : { ...ingredientLines(i), was: null, quote: null };
      }),
    [r, dish],
  );
  // "Not sure how much?" leads to asking the family, which a dish card does on its own page.
  const unsure = useMemo(() => (dish ? [] : unsureIngredients(r)), [r, dish]);
  const [done, setDone] = useState<boolean[]>(() => items.map(() => false));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const saved = readChecklist(r.id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore once from storage
    setDone(items.map((_, i) => saved.includes(i)));
  }, [r.id, items]);

  const toggle = (i: number) => {
    setDone((d) => {
      const next = d.slice();
      next[i] = !next[i];
      writeChecklist(r.id, next.flatMap((v, k) => (v ? [k] : [])));
      return next;
    });
  };

  const count = done.filter(Boolean).length;

  return (
    <div className={s.wrap}>
      <div className={s.top}>
        <button type="button" className={`${ui.press} ${ui.roundBtn}`} aria-label={dish ? dish.t('common.back') : 'Back to the recipe'} onClick={() => go({ name: 'recipe' })}>
          <IconBack />
        </button>
        <span className={s.dish}>{r.title}</span>
        {items.length > 0 && (
          <span className={s.count} aria-live="polite" aria-label={dish ? dish.t('lock.count', { n: count, m: items.length }) : `${count} of ${items.length} set out`}>
            {dish ? dish.t('lock.count', { n: count, m: items.length }) : `${count} of ${items.length}`}
          </span>
        )}
      </div>

      <h1 className={s.h1}>{dish ? dish.t('lock.ready') : 'Get these ready'}</h1>

      {items.length === 0 ? (
        <div className={s.empty}>
          <span className={s.emptyDisc} aria-hidden="true">
            <EggMascot size={40} mood="sleepy" />
          </span>
          <p className={s.emptyTitle}>Nothing to set out</p>
        </div>
      ) : (
        <div className={s.card} role="group" aria-label="Ingredients">
          {items.map((it, i) => (
            <motion.button
              key={`${r.ingredients[i].name}-${i}`}
              type="button"
              role="checkbox"
              aria-checked={!!done[i]}
              aria-label={[it.words, it.amount].filter(Boolean).join(', ')}
              className={`${ui.press} ${s.item}`}
              onClick={() => toggle(i)}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduced ? 0.15 : 0.38, delay: reduced ? 0 : Math.min(i, 10) * 0.04, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className={s.tick} data-on={done[i] || undefined}>
                <IconCheck />
              </span>
              <span className={s.lines}>
                <span className={s.words}>{it.words}</span>
                {(it.amount || it.was) && (
                  <span className={s.amount}>
                    {it.amount}
                    {it.was && <Was text={it.was} />}
                  </span>
                )}
                {it.quote && <Her quote={it.quote} />}
              </span>
            </motion.button>
          ))}
        </div>
      )}

      {unsure.length > 0 && (
        <div className={s.drop}>
          <button type="button" className={`${ui.press} ${s.dropBtn}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            Not sure how much?
            <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.28 }} style={{ display: 'flex' }}>
              <IconChevronDown size={18} />
            </motion.span>
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                key="unsure"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: reduced ? 0.15 : 0.28, ease: [0.2, 0.8, 0.2, 1] }}
                style={{ overflow: 'hidden' }}
              >
                <div className={s.unsure}>
                  <div>
                    {unsure.map((x, i) => (
                      <div key={`${x.name}-${i}`} className={s.unsureRow}>
                        <span className={s.unsureName}>{ingredientWords(x)}</span>
                        <span className={s.unsureEst}>{estimateLine(x)}</span>
                      </div>
                    ))}
                  </div>
                  <button type="button" className={`${ui.press} ${s.ask}`} aria-label="Ask the family about the amounts" onClick={(e) => lock('askFamily', e.currentTarget)}>
                    <IconBubble width={18} height={18} />
                    Ask the family
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
