'use client';
// The family recipe box (brief 8.4 "FolderGrid"): a folder panel with the app's family-table chips
// as tabs and a 3×2 grid of the six BOX recipes. motion owns this layer (FLIP filtering); the film
// timeline never animates it, it only swaps it in over its own decorative copy (<FolderShell>).
//
//   <FolderGrid labelledBy="recipe-box-h2" live={boxOn} onHiddenFocus={() => jumpToBox()} className={s.folder} />
//   <FolderShell className={s.folder} />      // decorative copy (aria-hidden) the film folds the deck into
//
// The folder: one rounded cream panel. Its header is the app library's own title, "Our *family*
// table", on the left and a "+ Add a recipe" pill on the right; the tabs and the grid sit under it.
// Tiles are photo + short title + "by {cook}" (+ the cook's words on large tiles); the full name,
// time and ~estimate stay in each tile's screen-reader text.
// Tabs: Everyone (black pill, active) · Auntie Lin · Dad · Grandma; "+ Add a recipe" is a link
// (#see-it-work by default, `addHref`) in the folder's header, outside the tablist. Each recipe tile
// links to the app tour, #see-it-work, on both pages (QA B25: they looked tappable and did nothing),
// so a tap shows the real app. Arrow keys / Home / End move focus,
// Enter or Space selects (manual activation). Filtering matches the app: Dad → chili, fish;
// Grandma → noodle soup, pork belly, dumplings; Auntie Lin → pancakes.
import { AnimatePresence, LazyMotion, MotionConfig, domMax, m } from 'motion/react';
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { copy } from '@/content/copy';
import { BOX, getRecipe } from '@/content/recipes';
import type { Recipe } from '@/content/types';
import { RecipeCard, possessive } from '@/components/primitives/RecipeCard';
import { PlusIcon } from '@/components/icons/Icons';
import { EASE } from '@/lib/motion/tokens';
import styles from './FolderGrid.module.css';

export const BOX_RECIPES: Recipe[] = BOX.map(getRecipe);
// The folder mirrors the app's own family-table screen (its title, tabs and add button), so these
// words are the same in both versions and come straight from copy.ts.
const TABS = copy.recipeBox.tabs;
const { folderTitle: FOLDER_TITLE, folderAccent: FOLDER_ACCENT } = copy.recipeBox; // the app-library screen's own title
const [TITLE_BEFORE, TITLE_AFTER] = FOLDER_TITLE.split(FOLDER_ACCENT);

// "+ Add a recipe": on the narrowest phones the pill reads "+ Add" (the rest stays in the
// accessible name) so it keeps its place beside the title instead of wrapping under it.
const [ADD_VERB, ...ADD_REST] = copy.recipeBox.addTab.replace(/^\+\s*/, '').split(' ');
function AddLabel() {
  return (
    <>
      <PlusIcon size="1.05em" stroke={2.2} /> {ADD_VERB}
      <span className={styles.addMore}> {ADD_REST.join(' ')}</span>
    </>
  );
}

/** Short dish names for the tiles, so every title fits without an ellipsis. */
const SHORT_DISH: Record<string, string> = {
  'grandma-noodle-soup': 'Noodle Soup',
  'grandma-pork-belly': 'Braised Pork Belly',
  'dad-fish': 'Ginger-Scallion Fish',
};
const tile = (r: Recipe): Recipe => (SHORT_DISH[r.id] ? { ...r, dish: SHORT_DISH[r.id] } : r);
type Tab = (typeof TABS)[number];

const matches = (r: Recipe, tab: Tab) => tab === TABS[0] || r.cook === tab;

/** Grid card sizes for next/image (desktop tiles are max(150px, ≤ 13.2vw); phones show 2 columns). */
export const BOX_CARD_SIZES = '(min-width: 1024px) 15vw, (min-width: 768px) 30vw, 45vw';

interface ShellProps {
  className?: string;
  style?: CSSProperties;
  /** decorative copy for the film deck */
  decorative?: boolean;
  tabs: ReactNode;
  add: ReactNode;
  children?: ReactNode;
  [data: `data-${string}`]: unknown;
}

function Shell({ className, style, decorative, tabs, add, children, ...rest }: ShellProps) {
  return (
    <div className={[styles.folder, className].filter(Boolean).join(' ')} style={style} aria-hidden={decorative ? true : undefined} {...rest}>
      <div className={styles.panel} data-fold-panel="">
        <div className={styles.head}>
          <span className={styles.title} data-fold-title="" aria-hidden="true">
            {TITLE_BEFORE}
            <em>{FOLDER_ACCENT}</em>
            {TITLE_AFTER}
          </span>
          <div className={styles.addWrap} data-fold-add="">
            {add}
          </div>
        </div>
        <div className={styles.tabsRow} data-fold-tabs="">
          {tabs}
        </div>
        {children}
      </div>
    </div>
  );
}

/** The decorative folder the film deck folds into (identical geometry to FolderGrid). */
export function FolderShell({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <Shell
      decorative
      className={className}
      style={style}
      data-shell=""
      tabs={
        <span className={styles.tabs}>
          {TABS.map((t, i) => (
            <span key={t} className={[styles.tab, i === 0 ? styles.active : ''].join(' ')}>
              {t}
            </span>
          ))}
        </span>
      }
      add={
        <span className={styles.add}>
          <AddLabel />
        </span>
      }
    >
      {/* empty cells so the copy is exactly as tall as the real grid */}
      <span className={styles.grid} data-folder-grid-copy="">
        {BOX.map((id) => (
          <span key={id} className={styles.cell} />
        ))}
      </span>
    </Shell>
  );
}

export interface FolderGridProps {
  /** id of the heading that names this recipe box */
  labelledBy: string;
  /** film mode only: false while the deck copy is showing; turning false resets the filter */
  live?: boolean;
  /** film mode: a tab got keyboard focus while the grid is still hidden behind the deck */
  onHiddenFocus?: () => void;
  /** where "+ Add a recipe" goes (default: the app demo, #see-it-work) */
  addHref?: string;
  className?: string;
  style?: CSSProperties;
}

/** where a recipe tile goes on every page: the app tour (QA B25), even where "+ Add" goes elsewhere */
const TOUR_HREF = '#see-it-work';

export function FolderGrid({ labelledBy, live = true, onHiddenFocus, addHref = TOUR_HREF, className, style }: FolderGridProps) {
  const [tab, setTab] = useState<Tab>(TABS[0]);
  const [focusIdx, setFocusIdx] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const uid = useId().replace(/:/g, '');
  const tabId = (i: number) => `${uid}-tab-${i}`;
  const panelId = `${uid}-panel`;

  // Back behind the deck → back to "Everyone", so the next swap lines up with the deck card for card.
  // (State adjusted during render when the prop changes, per the React docs.)
  const [prevLive, setPrevLive] = useState(live);
  if (live !== prevLive) {
    setPrevLive(live);
    if (!live) {
      setTab(TABS[0]);
      setFocusIdx(0);
    }
  }

  const shown = BOX_RECIPES.filter((r) => matches(r, tab));
  const activeIdx = TABS.indexOf(tab);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const n = TABS.length;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (focusIdx + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (focusIdx - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    setFocusIdx(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user">
        <Shell
          className={className}
          style={style}
          data-live={live ? '' : undefined}
          tabs={
            <div className={styles.tabs} role="tablist" aria-label={copy.recipeBox.tablistLabel} aria-orientation="horizontal">
              {TABS.map((t, i) => (
                <button
                  key={t}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  id={tabId(i)}
                  type="button"
                  role="tab"
                  className={[styles.tab, styles.tabBtn, t === tab ? styles.active : ''].join(' ')}
                  aria-selected={t === tab}
                  aria-controls={panelId}
                  tabIndex={i === focusIdx ? 0 : -1}
                  onKeyDown={onKeyDown}
                  onFocus={() => {
                    setFocusIdx(i);
                    if (!live) onHiddenFocus?.();
                  }}
                  onClick={() => {
                    setFocusIdx(i);
                    setTab(t);
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          }
          add={
            <a href={addHref} className={[styles.add, styles.addLink].join(' ')} onFocus={() => !live && onHiddenFocus?.()}>
              <AddLabel />
            </a>
          }
        >
          <ul className={styles.grid} role="tabpanel" id={panelId} aria-labelledby={`${tabId(activeIdx)} ${labelledBy}`} data-folder-grid="">
            <AnimatePresence mode="popLayout" initial={false}>
              {shown.map((r) => (
                <m.li
                  key={r.id}
                  layout
                  className={styles.cell}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.4, ease: EASE.soft }}
                >
                  <a className={styles.cardLink} href={TOUR_HREF} onFocus={() => !live && onHiddenFocus?.()}>
                    <BoxCardText recipe={r} />
                    <RecipeCard
                      recipe={tile(r)}
                      imageSizes={BOX_CARD_SIZES}
                      className={styles.card}
                      style={{ width: '100%', height: '100%', aspectRatio: 'auto' }}
                    />
                  </a>
                </m.li>
              ))}
            </AnimatePresence>
          </ul>
        </Shell>
      </MotionConfig>
    </LazyMotion>
  );
}

/** What each card says, for screen readers (the visual card is decorative and scales below 16px). */
function BoxCardText({ recipe: r }: { recipe: Recipe }) {
  return (
    <div className="sr-only">
      <h3>{possessive(r)}</h3>
      <p>
        By {r.cook}, {r.time.replace(/^~/, 'about ')}. In {r.cook}&apos;s words: “{r.feelQuote}” (
        {r.estimate.startsWith('~') ? `about ${r.estimate.slice(1)}` : r.estimate}).
      </p>
    </div>
  );
}

/** Same card, for the deck copy (decorative). */
export function BoxCard({ recipe, className, style }: { recipe: Recipe; className?: string; style?: CSSProperties }) {
  return (
    <RecipeCard
      recipe={tile(recipe)}
      imageSizes={BOX_CARD_SIZES}
      className={[styles.card, className].filter(Boolean).join(' ')}
      style={{ width: '100%', height: '100%', aspectRatio: 'auto', ...style }}
    />
  );
}
